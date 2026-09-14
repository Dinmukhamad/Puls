"""
Еженедельный расчёт: баллы -> места -> номинации -> коины.

Реализует шаги 3-7 схемы потока данных (п. 7 ТЗ). Расчёт разделён на две фазы:

* :func:`calculate_week` - пересчёт баллов, мест и номинаций. Идемпотентен,
  коины не начисляются, результат можно посмотреть до закрытия недели.
* :func:`close_week` - закрытие недели и начисление коинов. Защищено ключами
  идемпотентности, поэтому повторный запуск не удваивает начисления.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.db.base import utcnow
from app.models.coin import CoinTransaction
from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    NominationDefinition,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import (
    MetricDirection,
    MetricKind,
    Role,
    TxType,
    WeekStatus,
)
from app.models.settings import GamificationSettings
from app.models.user import User
from app.services import badges as badges_service
from app.services import coins as coins_service
from app.services.rules import get_rules
from app.services.scoring import points_to_coins, score_week

#: Служебный код номинации «Лучший прогресс недели»: сравнивает итоговые баллы
#: с предыдущей неделей вместо обычного показателя.
PROGRESS_METRIC = "__progress__"


@dataclass(slots=True)
class WeekCloseReport:
    """Сводка по закрытию недели - возвращается администратору и планировщику."""

    week_id: int
    week_label: str
    participants: int
    coins_awarded: int
    nominations_awarded: int
    badges_awarded: int
    already_closed: bool = False


# --------------------------------------------------------------------------- #
# Работа с неделями
# --------------------------------------------------------------------------- #


def week_bounds(any_day: date) -> tuple[date, date]:
    """Границы ISO-недели (понедельник - воскресенье), содержащей указанную дату."""
    monday = any_day - timedelta(days=any_day.weekday())
    return monday, monday + timedelta(days=6)


async def get_or_create_week(
    session: AsyncSession, any_day: date, *, title: str | None = None
) -> ContestWeek:
    """Находит или заводит неделю, в которую попадает указанная дата."""
    iso_year, iso_week, _ = any_day.isocalendar()
    week = await session.scalar(
        select(ContestWeek).where(
            ContestWeek.iso_year == iso_year, ContestWeek.iso_week == iso_week
        )
    )
    if week is not None:
        return week

    starts_on, ends_on = week_bounds(any_day)
    week = ContestWeek(
        iso_year=iso_year,
        iso_week=iso_week,
        starts_on=starts_on,
        ends_on=ends_on,
        **({"title": title} if title else {}),
    )
    session.add(week)
    await session.flush()
    return week


async def get_week(session: AsyncSession, week_id: int, *, lock: bool = False) -> ContestWeek:
    stmt = select(ContestWeek).where(ContestWeek.id == week_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    week = await session.scalar(stmt)
    if week is None:
        raise NotFoundError(f"Неделя id={week_id} не найдена")
    return week


async def latest_week(
    session: AsyncSession, *, only_closed: bool = False
) -> ContestWeek | None:
    """Последняя неделя по календарю; при ``only_closed`` - последняя закрытая."""
    stmt = select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(1)
    if only_closed:
        stmt = stmt.where(ContestWeek.status == WeekStatus.CLOSED)
    return await session.scalar(stmt)


async def latest_ranked_week(session: AsyncSession) -> ContestWeek | None:
    """Последняя неделя, по которой уже есть рассчитанные результаты."""
    return await session.scalar(
        select(ContestWeek)
        .join(OperatorWeekResult, OperatorWeekResult.week_id == ContestWeek.id)
        .order_by(ContestWeek.starts_on.desc())
        .limit(1)
    )


async def resolve_week(
    session: AsyncSession, week_id: int | None, *, prefer_ranked: bool = False
) -> ContestWeek | None:
    """
    Неделя по идентификатору либо неделя по умолчанию, если он не задан.

    ``prefer_ranked=True`` выбирает последнюю рассчитанную неделю: рейтинг и
    админ-таблица не должны по умолчанию открываться на текущей неделе, по
    которой итогов ещё нет.
    """
    if week_id is not None:
        return await get_week(session, week_id)
    if prefer_ranked:
        ranked = await latest_ranked_week(session)
        if ranked is not None:
            return ranked
    return await latest_week(session)


async def previous_week(session: AsyncSession, week: ContestWeek) -> ContestWeek | None:
    return await session.scalar(
        select(ContestWeek)
        .where(ContestWeek.starts_on < week.starts_on)
        .order_by(ContestWeek.starts_on.desc())
        .limit(1)
    )


# --------------------------------------------------------------------------- #
# Расчёт
# --------------------------------------------------------------------------- #


async def _load_metric_values(
    session: AsyncSession, week_id: int
) -> dict[int, dict[str, float]]:
    """Показатели недели, сгруппированные по операторам."""
    rows = await session.execute(
        select(
            OperatorWeekMetric.user_id,
            OperatorWeekMetric.metric_code,
            OperatorWeekMetric.value,
        ).where(OperatorWeekMetric.week_id == week_id)
    )
    grouped: dict[int, dict[str, float]] = {}
    for user_id, code, value in rows:
        grouped.setdefault(user_id, {})[code] = float(value)
    return grouped


async def active_metric_definitions(session: AsyncSession) -> list[MetricDefinition]:
    rows = await session.scalars(
        select(MetricDefinition)
        .where(MetricDefinition.is_active.is_(True))
        .order_by(MetricDefinition.sort_order, MetricDefinition.id)
    )
    return list(rows)


def _assign_ranks(results: list[OperatorWeekResult]) -> None:
    """
    Расставляет места по убыванию итогового балла.

    Используется стандартное спортивное ранжирование: при равенстве баллов
    операторы делят место, следующее место пропускается (1, 2, 2, 4).
    """
    ordered = sorted(
        results,
        key=lambda r: (-r.final_points, r.penalty_points, r.user_id),
    )
    previous_points: float | None = None
    previous_rank = 0
    for index, result in enumerate(ordered, start=1):
        if previous_points is not None and abs(result.final_points - previous_points) < 1e-9:
            result.rank = previous_rank
        else:
            result.rank = index
            previous_rank = index
        previous_points = result.final_points


async def calculate_week(
    session: AsyncSession, week: ContestWeek
) -> list[OperatorWeekResult]:
    """
    Пересчитывает баллы, места и номинации недели.

    Коины не начисляются. Метод идемпотентен: прежние результаты и номинации
    удаляются и создаются заново, поэтому его можно вызывать после каждой
    правки показателей.

    :raises ConflictError: если неделя уже закрыта - закрытые недели неизменны.
    """
    if week.status == WeekStatus.CLOSED:
        raise ConflictError(
            f"Неделя {week.label} уже закрыта, пересчёт запрещён", code="week_closed"
        )

    rules = await get_rules(session)
    definitions = await active_metric_definitions(session)
    values_by_user = await _load_metric_values(session, week.id)

    if not values_by_user:
        await _reset_week_results(session, week.id)
        week.status = WeekStatus.CALCULATED
        week.calculated_at = utcnow()
        await session.flush()
        return []

    participants = await session.scalars(
        select(User).where(
            User.id.in_(values_by_user.keys()),
            User.role == Role.OPERATOR,
        )
    )
    participants = list(participants)

    prev = await previous_week(session, week)
    previous_ranks: dict[int, int] = {}
    if prev is not None:
        rows = await session.execute(
            select(OperatorWeekResult.user_id, OperatorWeekResult.rank).where(
                OperatorWeekResult.week_id == prev.id
            )
        )
        previous_ranks = {uid: rank for uid, rank in rows if rank is not None}
        previous_points = await session.execute(
            select(OperatorWeekResult.user_id, OperatorWeekResult.final_points).where(
                OperatorWeekResult.week_id == prev.id
            )
        )
        previous_points_map = dict(previous_points.all())
    else:
        previous_points_map = {}

    await _reset_week_results(session, week.id)

    lateness_code = rules.lateness_metric_code
    sites_code = rules.forbidden_sites_metric_code

    results: list[OperatorWeekResult] = []
    for user in participants:
        raw = values_by_user.get(user.id, {})
        score = score_week(definitions, raw)
        result = OperatorWeekResult(
            week_id=week.id,
            user_id=user.id,
            base_points=score.base_points,
            penalty_points=score.penalty_points,
            final_points=score.final_points,
            previous_rank=previous_ranks.get(user.id),
            lateness_count=float(raw.get(lateness_code, 0.0)),
            forbidden_sites_count=float(raw.get(sites_code, 0.0)),
            breakdown={
                "metrics": [m.as_dict() for m in score.metrics],
                "reported_codes": sorted(raw.keys()),
                "previous_final_points": previous_points_map.get(user.id),
            },
        )
        results.append(result)

    _assign_ranks(results)

    for result in results:
        if result.previous_rank is not None and result.rank is not None:
            # Положительная дельта = подъём: место с большим номером сменилось меньшим.
            result.rank_delta = result.previous_rank - result.rank
        _apply_coin_preview(result, rules, values_by_user.get(result.user_id, {}))
        session.add(result)

    await session.flush()

    nomination_bonus = await _award_nominations(session, week, results, rules)
    for result in results:
        result.coins_nomination_bonus = nomination_bonus.get(result.user_id, 0)
        result.coins_total = (
            result.coins_from_points
            + result.coins_rank_bonus
            + result.coins_discipline_bonus
            + result.coins_nomination_bonus
        )

    week.status = WeekStatus.CALCULATED
    week.calculated_at = utcnow()
    await session.flush()
    return results


async def invalidate_calculation(session: AsyncSession, week: ContestWeek) -> None:
    """Metric edits invalidate the shared ranking before a new calculation."""
    if week.status == WeekStatus.CLOSED:
        raise ConflictError("Закрытая неделя неизменна", code="week_closed")
    await _reset_week_results(session, week.id)
    week.status = WeekStatus.OPEN
    week.calculated_at = None
    await session.flush()


async def _reset_week_results(session: AsyncSession, week_id: int) -> None:
    await session.execute(
        delete(NominationWinner).where(NominationWinner.week_id == week_id)
    )
    await session.execute(
        delete(OperatorWeekResult).where(OperatorWeekResult.week_id == week_id)
    )
    await session.flush()


def discipline_bonuses(
    result: OperatorWeekResult,
    rules: GamificationSettings,
    reported_codes: set[str],
) -> tuple[int, int]:
    """
    Дисциплинарные бонусы недели: (без опозданий, без посторонних сайтов).

    Если ``discipline_requires_reported`` включён, бонус даётся только когда
    антипоказатель действительно выгружен: отсутствие строки в выгрузке
    означает «данных нет», а не «нарушений не было».
    """
    require = rules.discipline_requires_reported
    lateness = (
        rules.no_lateness_bonus
        if result.lateness_count == 0
        and (not require or rules.lateness_metric_code in reported_codes)
        else 0
    )
    sites = (
        rules.no_forbidden_sites_bonus
        if result.forbidden_sites_count == 0
        and (not require or rules.forbidden_sites_metric_code in reported_codes)
        else 0
    )
    return lateness, sites


def _apply_coin_preview(
    result: OperatorWeekResult,
    rules: GamificationSettings,
    raw_values: dict[str, float],
) -> None:
    """Заполняет расчётные поля коинов без проведения операций (шаги 4-5 п. 7)."""
    result.coins_from_points = points_to_coins(result.final_points, rules.points_per_coin)
    result.coins_rank_bonus = rules.rank_bonus(result.rank)

    lateness, sites = discipline_bonuses(result, rules, set(raw_values))
    result.coins_discipline_bonus = lateness + sites
    result.coins_total = (
        result.coins_from_points + result.coins_rank_bonus + result.coins_discipline_bonus
    )


# --------------------------------------------------------------------------- #
# Номинации
# --------------------------------------------------------------------------- #


async def _award_nominations(
    session: AsyncSession,
    week: ContestWeek,
    results: list[OperatorWeekResult],
    rules: GamificationSettings,
) -> dict[int, int]:
    """
    Определяет победителей номинаций недели (п. 4.2.3).

    Возвращает суммарный бонус за номинации по операторам. При слишком малом
    числе участников номинации не присуждаются - иначе победителем становится
    единственный участник.
    """
    if len(results) < rules.nomination_min_participants:
        return {}

    nominations = await session.scalars(
        select(NominationDefinition)
        .where(NominationDefinition.is_active.is_(True))
        .order_by(NominationDefinition.sort_order, NominationDefinition.id)
    )

    by_user = {r.user_id: r for r in results}
    bonus_by_user: dict[int, int] = {}

    for nomination in nominations:
        candidate = _pick_nomination_winner(nomination, results, by_user)
        if candidate is None:
            continue
        result, value = candidate
        reward = nomination.coins_reward or rules.nomination_bonus_default
        session.add(
            NominationWinner(
                week_id=week.id,
                nomination_id=nomination.id,
                user_id=result.user_id,
                value=value,
                coins_awarded=reward,
            )
        )
        bonus_by_user[result.user_id] = bonus_by_user.get(result.user_id, 0) + reward

    await session.flush()
    return bonus_by_user


def _nomination_value(
    nomination: NominationDefinition, result: OperatorWeekResult
) -> float | None:
    """Значение критерия номинации для оператора; ``None`` - критерий неприменим."""
    if nomination.metric_code == PROGRESS_METRIC:
        previous = (result.breakdown or {}).get("previous_final_points")
        if previous is None:
            return None
        return result.final_points - float(previous)

    for metric in (result.breakdown or {}).get("metrics", []):
        if metric.get("code") == nomination.metric_code:
            reported = (result.breakdown or {}).get("reported_codes")
            if reported is not None and nomination.metric_code not in reported:
                return None
            value = metric.get("value")
            return float(value) if value is not None else None
    return None


def _pick_nomination_winner(
    nomination: NominationDefinition,
    results: list[OperatorWeekResult],
    by_user: dict[int, OperatorWeekResult],
) -> tuple[OperatorWeekResult, float] | None:
    candidates: list[tuple[OperatorWeekResult, float]] = []
    for result in results:
        value = _nomination_value(nomination, result)
        if value is None:
            continue
        if nomination.require_zero and value != 0:
            continue
        if nomination.min_value is not None and value < nomination.min_value:
            continue
        candidates.append((result, value))

    if not candidates:
        return None

    if nomination.require_zero:
        # Среди «чистых» побеждает лучший по итоговым баллам недели.
        return max(candidates, key=lambda pair: (pair[0].final_points, -pair[0].user_id))

    reverse = nomination.direction == MetricDirection.HIGHER_IS_BETTER
    return max(
        candidates,
        key=lambda pair: (
            pair[1] if reverse else -pair[1],
            pair[0].final_points,
            -pair[0].user_id,
        ),
    )


# --------------------------------------------------------------------------- #
# Закрытие недели и начисление коинов
# --------------------------------------------------------------------------- #


async def close_week(
    session: AsyncSession,
    week: ContestWeek,
    *,
    actor_id: int | None = None,
    recalculate: bool = True,
) -> WeekCloseReport:
    """
    Закрывает неделю и зачисляет коины на балансы (шаги 6-7 п. 7).

    Повторный вызов для уже закрытой недели ничего не начисляет и возвращает
    отчёт с ``already_closed=True``.
    """
    if week.status == WeekStatus.CLOSED:
        participants = await session.scalar(
            select(func.count(OperatorWeekResult.id)).where(
                OperatorWeekResult.week_id == week.id
            )
        )
        nominations = await session.scalar(
            select(func.count(NominationWinner.id)).where(
                NominationWinner.week_id == week.id
            )
        )
        return WeekCloseReport(
            week_id=week.id,
            week_label=week.label,
            participants=int(participants or 0),
            coins_awarded=0,
            nominations_awarded=int(nominations or 0),
            badges_awarded=0,
            already_closed=True,
        )

    if recalculate:
        results = await calculate_week(session, week)
    else:
        results = list(
            await session.scalars(
                select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
            )
        )

    rules = await get_rules(session)
    winners = list(
        await session.scalars(
            select(NominationWinner).where(NominationWinner.week_id == week.id)
        )
    )
    winners_by_user: dict[int, list[NominationWinner]] = {}
    for winner in winners:
        winners_by_user.setdefault(winner.user_id, []).append(winner)

    nomination_titles = {
        n.id: n.title
        for n in await session.scalars(select(NominationDefinition))
    }

    awarded = 0
    for result in results:
        awarded += await _post_week_transactions(
            session, week, result, rules, winners_by_user, nomination_titles, actor_id
        )

    week.status = WeekStatus.CLOSED
    week.closed_at = utcnow()
    week.closed_by_id = actor_id
    week.rules_snapshot = rules.as_snapshot()
    await session.flush()

    bonus_query = (
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.week_id == week.id,
            CoinTransaction.tx_type == TxType.ACHIEVEMENT_REWARD,
        )
    )
    bonus_before = int(await session.scalar(bonus_query) or 0)
    badges_awarded = await badges_service.evaluate_for_week(session, week)
    awarded += int(await session.scalar(bonus_query) or 0) - bonus_before

    return WeekCloseReport(
        week_id=week.id,
        week_label=week.label,
        participants=len(results),
        coins_awarded=awarded,
        nominations_awarded=len(winners),
        badges_awarded=badges_awarded,
    )


async def _post_week_transactions(
    session: AsyncSession,
    week: ContestWeek,
    result: OperatorWeekResult,
    rules: GamificationSettings,
    winners_by_user: dict[int, list[NominationWinner]],
    nomination_titles: dict[int, str],
    actor_id: int | None,
) -> int:
    """
    Проводит все автоматические начисления оператора за неделю.

    Каждое начисление - отдельная строка истории с собственным ключом
    идемпотентности, чтобы оператор видел, из чего сложилась сумма (п. 4.1.3).
    """
    prefix = f"week:{week.id}:user:{result.user_id}"
    total = 0

    async def post(amount: int, tx_type: TxType, reason: str, key: str) -> None:
        nonlocal total
        if amount <= 0:
            return
        tx = await coins_service.post_transaction(
            session,
            user_id=result.user_id,
            amount=amount,
            tx_type=tx_type,
            reason=reason,
            week_id=week.id,
            created_by_id=actor_id,
            idempotency_key=f"{prefix}:{key}",
            meta={"week": week.label},
            evaluate_achievements=False,
        )
        if tx is not None:
            total += amount

    await post(
        result.coins_from_points,
        TxType.WEEKLY_POINTS,
        (
            f"Итог недели {week.label}: {result.final_points:g} балла(ов) "
            f"по курсу {rules.points_per_coin:g} балла = 1 коин"
        ),
        "points",
    )

    if result.coins_rank_bonus:
        await post(
            result.coins_rank_bonus,
            TxType.RANK_BONUS,
            f"Место {result.rank} в рейтинге недели {week.label}",
            "rank",
        )

    reported = set((result.breakdown or {}).get("reported_codes", []))
    lateness_bonus, sites_bonus = discipline_bonuses(result, rules, reported)

    await post(
        lateness_bonus,
        TxType.NO_LATENESS_BONUS,
        f"Неделя {week.label} без опозданий",
        "no_lateness",
    )
    await post(
        sites_bonus,
        TxType.NO_SITES_BONUS,
        f"Неделя {week.label} без посторонних сайтов",
        "no_sites",
    )

    for winner in winners_by_user.get(result.user_id, []):
        title = nomination_titles.get(winner.nomination_id, "Номинация недели")
        await post(
            winner.coins_awarded,
            TxType.NOMINATION_BONUS,
            f"Номинация «{title}» за неделю {week.label}",
            f"nomination:{winner.nomination_id}",
        )

    return total


async def unreported_metrics(
    session: AsyncSession, week_id: int
) -> dict[str, list[str]]:
    """
    Показатели, не выгруженные ни по одному оператору за неделю.

    Помогает супервайзеру заметить незалитые данные до закрытия недели.
    """
    definitions = await active_metric_definitions(session)
    reported = set(
        await session.scalars(
            select(OperatorWeekMetric.metric_code)
            .where(OperatorWeekMetric.week_id == week_id)
            .distinct()
        )
    )
    missing = [d.code for d in definitions if d.code not in reported]
    anti = [d.code for d in definitions if d.kind == MetricKind.ANTI and d.code not in reported]
    return {"missing": missing, "missing_anti": anti}
