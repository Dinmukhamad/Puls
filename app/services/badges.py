"""
Бейджи и достижения (п. 4.1.4).

Правила описаны данными, а не кодом: каждый бейдж - это ``rule_type`` плюс
параметры. Один и тот же расчёт используется и для выдачи бейджа, и для
подсказки «сколько осталось» по заблокированным бейджам.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeDefinition, UserBadge
from app.models.contest import (
    ContestWeek,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import BadgeRule, TxType, WeekStatus
from app.models.learning import LearningAward
from app.models.progress import ProgressLevel
from app.services.coins import earned_total


@dataclass(slots=True)
class BadgeProgress:
    """Состояние одного бейджа у оператора."""

    badge: BadgeDefinition
    unlocked: bool
    current: float
    target: float
    hint: str
    coins_awarded: int = 0

    @property
    def percent(self) -> float:
        if self.target <= 0:
            return 100.0 if self.unlocked else 0.0
        return round(min(100.0, self.current / self.target * 100), 1)


async def _closed_weeks(session: AsyncSession, limit: int | None = None) -> list[ContestWeek]:
    """Закрытые недели от свежей к старой."""
    stmt = (
        select(ContestWeek)
        .where(ContestWeek.status == WeekStatus.CLOSED)
        .order_by(ContestWeek.starts_on.desc())
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(await session.scalars(stmt))


async def _metric_by_week(
    session: AsyncSession, user_id: int, metric_code: str, week_ids: list[int]
) -> dict[int, float]:
    if not week_ids:
        return {}
    rows = await session.execute(
        select(OperatorWeekMetric.week_id, OperatorWeekMetric.value).where(
            OperatorWeekMetric.user_id == user_id,
            OperatorWeekMetric.metric_code == metric_code,
            OperatorWeekMetric.week_id.in_(week_ids),
        )
    )
    return {week_id: float(value) for week_id, value in rows}


async def _streak_length(
    session: AsyncSession,
    user_id: int,
    metric_code: str,
    *,
    predicate,
    max_weeks: int,
) -> int:
    """
    Длина текущей серии закрытых недель, где показатель удовлетворяет условию.

    Неделя без выгруженного показателя обрывает серию: подтвердить дисциплину
    можно только фактическими данными.
    """
    weeks = await _closed_weeks(session, limit=max_weeks)
    if not weeks:
        return 0
    values = await _metric_by_week(session, user_id, metric_code, [w.id for w in weeks])
    streak = 0
    for week in weeks:
        value = values.get(week.id)
        if value is None or not predicate(value):
            break
        streak += 1
    return streak


async def _best_rank_reached(session: AsyncSession, user_id: int, max_rank: int) -> bool:
    best = await session.scalar(
        select(func.min(OperatorWeekResult.rank))
        .join(ContestWeek, ContestWeek.id == OperatorWeekResult.week_id)
        .where(
            OperatorWeekResult.user_id == user_id,
            ContestWeek.status == WeekStatus.CLOSED,
            OperatorWeekResult.rank.is_not(None),
        )
    )
    return best is not None and best <= max_rank


async def evaluate_badge(
    session: AsyncSession, badge: BadgeDefinition, user_id: int, *, coin_total: int | None = None
) -> BadgeProgress:
    """Считает прогресс оператора по одному бейджу."""
    params = badge.rule_params or {}
    rule = BadgeRule(badge.rule_type)

    if rule == BadgeRule.TOP_RANK:
        max_rank = int(params.get("max_rank", 3))
        unlocked = await _best_rank_reached(session, user_id, max_rank)
        return BadgeProgress(
            badge=badge,
            unlocked=unlocked,
            current=1.0 if unlocked else 0.0,
            target=1.0,
            hint=("Получен" if unlocked else f"Займите место не ниже {max_rank} в рейтинге недели"),
        )

    if rule == BadgeRule.ZERO_METRIC_STREAK:
        metric = str(params.get("metric", "lateness"))
        need = int(params.get("weeks", 3))
        streak = await _streak_length(
            session, user_id, metric, predicate=lambda v: v == 0, max_weeks=need
        )
        return BadgeProgress(
            badge=badge,
            unlocked=streak >= need,
            current=float(streak),
            target=float(need),
            hint=(
                "Получен"
                if streak >= need
                else f"Серия {streak} из {need} недель, осталось {need - streak}"
            ),
        )

    if rule == BadgeRule.METRIC_THRESHOLD_STREAK:
        metric = str(params.get("metric", "quality"))
        threshold = float(params.get("gte", 0))
        need = int(params.get("weeks", 1))
        streak = await _streak_length(
            session, user_id, metric, predicate=lambda v: v >= threshold, max_weeks=need
        )
        return BadgeProgress(
            badge=badge,
            unlocked=streak >= need,
            current=float(streak),
            target=float(need),
            hint=(
                "Получен"
                if streak >= need
                else f"Нужно {need} нед. подряд со значением не ниже {threshold:g}"
            ),
        )

    if rule == BadgeRule.METRIC_TOTAL:
        metric = str(params.get("metric", "driver_gratitudes"))
        target = float(params.get("gte", 1))
        total = await session.scalar(
            select(func.coalesce(func.sum(OperatorWeekMetric.value), 0.0))
            .join(ContestWeek, ContestWeek.id == OperatorWeekMetric.week_id)
            .where(
                OperatorWeekMetric.user_id == user_id,
                OperatorWeekMetric.metric_code == metric,
                ContestWeek.status == WeekStatus.CLOSED,
            )
        )
        total = float(total or 0.0)
        return BadgeProgress(
            badge=badge,
            unlocked=total >= target,
            current=total,
            target=target,
            hint=("Получен" if total >= target else f"Накоплено {total:g} из {target:g}"),
        )

    if rule == BadgeRule.TOTAL_EARNED:
        target = float(params.get("gte", 100))
        earned = await earned_total(session, user_id) if coin_total is None else coin_total
        earned = float(earned or 0)
        return BadgeProgress(
            badge=badge,
            unlocked=earned >= target,
            current=earned,
            target=target,
            hint=(
                "Получен" if earned >= target else f"Заработайте ещё {int(target - earned)} коинов"
            ),
        )

    if rule == BadgeRule.LEARNING_COUNT:
        target = int(params.get("gte", 3))
        count = int(
            await session.scalar(
                select(func.count(LearningAward.id)).where(LearningAward.user_id == user_id)
            )
            or 0
        )
        return BadgeProgress(
            badge=badge,
            unlocked=count >= target,
            current=float(count),
            target=float(target),
            hint="Получен" if count >= target else f"Пройдено разных заданий: {count} из {target}",
        )

    if rule == BadgeRule.NOMINATION_COUNT:
        target = float(params.get("gte", 1))
        count = await session.scalar(
            select(func.count(NominationWinner.id))
            .join(ContestWeek, ContestWeek.id == NominationWinner.week_id)
            .where(NominationWinner.user_id == user_id, ContestWeek.status == WeekStatus.CLOSED)
        )
        count = float(count or 0)
        return BadgeProgress(
            badge=badge,
            unlocked=count >= target,
            current=count,
            target=target,
            hint=(
                "Получен"
                if count >= target
                else f"Выиграно номинаций: {int(count)} из {int(target)}"
            ),
        )

    return BadgeProgress(badge=badge, unlocked=False, current=0.0, target=1.0, hint="")


async def user_badge_board(
    session: AsyncSession,
    user_id: int,
    *,
    coin_total: int | None = None,
    levels: list[ProgressLevel] | None = None,
) -> list[tuple[BadgeProgress, UserBadge | None]]:
    """
    Доска достижений оператора: полученные и заблокированные бейджи с подсказками.
    """
    total = await earned_total(session, user_id) if coin_total is None else coin_total
    definitions = list(
        await session.scalars(
            select(BadgeDefinition)
            .where(BadgeDefinition.is_active.is_(True))
            .order_by(BadgeDefinition.sort_order, BadgeDefinition.id)
        )
    )
    awards = list(await session.scalars(select(UserBadge).where(UserBadge.user_id == user_id)))
    latest_award: dict[int, UserBadge] = {}
    bonuses: dict[int, int] = {}
    for award in awards:
        bonuses[award.badge_id] = bonuses.get(award.badge_id, 0) + award.coins_awarded
        current = latest_award.get(award.badge_id)
        if current is None or award.awarded_at > current.awarded_at:
            latest_award[award.badge_id] = award

    board: list[tuple[BadgeProgress, UserBadge | None]] = []
    for definition in definitions:
        progress = await evaluate_badge(session, definition, user_id, coin_total=total)
        award = latest_award.get(definition.id)
        if award is not None:
            progress.unlocked = True
            progress.hint = "Получен"
        progress.coins_awarded = bonuses.get(definition.id, 0)
        board.append((progress, award))
    if levels is None:
        levels = list(
            await session.scalars(
                select(ProgressLevel)
                .where(ProgressLevel.is_active.is_(True))
                .order_by(ProgressLevel.min_coins)
            )
        )
    for level in levels:
        if level.min_coins <= 0:
            continue
        definition = BadgeDefinition(
            code=f"level_{level.id}",
            title=f"{level.min_coins:,} коинов заработано".replace(",", " "),
            description=f"Достигнут уровень «{level.title}»",
            icon="medal",
            rule_type=BadgeRule.TOTAL_EARNED,
            coins_reward=0,
        )
        board.append(
            (
                BadgeProgress(
                    badge=definition,
                    unlocked=total >= level.min_coins,
                    current=float(total),
                    target=float(level.min_coins),
                    hint="Получен"
                    if total >= level.min_coins
                    else f"Заработайте ещё {level.min_coins - total} коинов",
                ),
                None,
            )
        )
    return board


def badge_output(progress, award):
    from app.schemas.cabinet import BadgeOut

    badge = progress.badge
    milestone = badge.code.startswith("level_")
    return BadgeOut(
        code=badge.code,
        title=badge.title,
        description=badge.description,
        icon=badge.icon,
        unlocked=progress.unlocked,
        awarded_at=award.awarded_at if award else None,
        progress_current=progress.current,
        progress_target=progress.target,
        progress_percent=100 if progress.unlocked else progress.percent,
        hint=progress.hint,
        coins_reward=badge.coins_reward or 0,
        coins_awarded=progress.coins_awarded,
        category="level" if milestone else "work",
        action_url="/training"
        if badge.rule_type == BadgeRule.LEARNING_COUNT
        else "/progress"
        if badge.rule_type == BadgeRule.TOTAL_EARNED
        else "/cabinet",
    )


async def award_achievements(session, user_id, week_id=None, *, pay_bonus=True, definition_id=None):
    """Award facts and the first bonus atomically; a repeated event never pays twice."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    from app.services.coins import get_account, post_transaction

    await get_account(session, user_id, lock=True)
    query = select(BadgeDefinition).where(BadgeDefinition.is_active.is_(True))
    if definition_id is not None:
        query = query.where(BadgeDefinition.id == definition_id)
    definitions = list(
        await session.scalars(query.order_by(BadgeDefinition.sort_order, BadgeDefinition.id))
    )
    existing = list(await session.scalars(select(UserBadge).where(UserBadge.user_id == user_id)))
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    count = 0
    for definition in definitions:
        prior = [item for item in existing if item.badge_id == definition.id]
        if prior and (not definition.is_repeatable or week_id is None):
            continue
        if definition.is_repeatable and any(item.week_id == week_id for item in prior):
            continue
        progress = await evaluate_badge(session, definition, user_id)
        if not progress.unlocked:
            continue
        key = f"badge:{user_id}:{definition.id}:" + (
            str(week_id) if definition.is_repeatable and week_id is not None else "once"
        )
        # Lifetime milestones and rank/nomination badges already have their own coin awards.
        bonus = (
            (definition.coins_reward or 0)
            if pay_bonus
            and not prior
            and definition.rule_type
            not in (
                BadgeRule.TOTAL_EARNED,
                BadgeRule.TOP_RANK,
                BadgeRule.NOMINATION_COUNT,
            )
            else 0
        )
        awarded_id = await session.scalar(
            insert(UserBadge)
            .values(
                user_id=user_id,
                badge_id=definition.id,
                week_id=week_id,
                award_key=key,
                coins_awarded=bonus,
            )
            .on_conflict_do_nothing()
            .returning(UserBadge.id)
        )
        if awarded_id is None:
            continue
        if bonus:
            await post_transaction(
                session,
                user_id=user_id,
                amount=bonus,
                tx_type=TxType.ACHIEVEMENT_REWARD,
                reason=f"Достижение: {definition.title}",
                idempotency_key=key,
                week_id=week_id,
                evaluate_achievements=False,
            )
        count += 1
    await session.flush()
    return count


async def latest_result_week(session, user_id):
    return await session.scalar(
        select(ContestWeek.id)
        .join(OperatorWeekResult, OperatorWeekResult.week_id == ContestWeek.id)
        .where(OperatorWeekResult.user_id == user_id, ContestWeek.status == WeekStatus.CLOSED)
        .order_by(ContestWeek.starts_on.desc())
        .limit(1)
    )


async def reconcile_badge_definition(session, definition):
    """Apply a saved rule to confirmed results, without paying previous awards again."""
    from app.models.enums import Role
    from app.models.user import User

    if not definition.is_active:
        return
    users = await session.scalars(
        select(User.id)
        .where(User.is_active.is_(True), User.role == Role.OPERATOR)
        .order_by(User.id)
    )
    for user_id in users:
        week_id = await latest_result_week(session, user_id) if definition.is_repeatable else None
        await award_achievements(session, user_id, week_id, definition_id=definition.id)


async def evaluate_for_week(session: AsyncSession, week: ContestWeek) -> int:
    """
    Выдаёт бейджи участникам закрытой недели. Возвращает количество новых наград.

    Вызывается после закрытия недели; повторный вызов не создаёт дубликатов
    благодаря уникальному ограничению (user, badge, week).
    """
    participants = list(
        await session.scalars(
            select(OperatorWeekResult.user_id).where(OperatorWeekResult.week_id == week.id)
        )
    )
    awarded = 0
    for user_id in participants:
        awarded += await award_achievements(session, user_id, week.id)
    return awarded
