"""Сборка данных личного кабинета оператора (п. 4.1)."""
from __future__ import annotations

from datetime import UTC, date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import (
    ContestWeek,
    NominationDefinition,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import ShopRequestStatus, WeekStatus
from app.models.shop import ShopRequest
from app.models.user import User
from app.schemas.cabinet import (
    BalanceBlock,
    MetricProgress,
    NominationBrief,
    WeekMetricsBlock,
)
from app.services import badges as badges_service
from app.services import coins as coins_service
from app.services import weekly as weekly_service
from app.services.rules import get_rules
from app.services.scoring import points_to_coins, score_week


def _week_datetime_bounds(week: ContestWeek) -> tuple[datetime, datetime]:
    start = datetime.combine(week.starts_on, time.min, tzinfo=UTC)
    end = datetime.combine(week.ends_on, time.max, tzinfo=UTC)
    return start, end


async def current_week(session: AsyncSession) -> ContestWeek | None:
    """
    Неделя, показываемая оператору по умолчанию.

    Это неделя, в которую попадает сегодняшний день; если она ещё не заведена,
    берётся последняя доступная.
    """
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()
    week = await session.scalar(
        select(ContestWeek).where(
            ContestWeek.iso_year == iso_year, ContestWeek.iso_week == iso_week
        )
    )
    if week is not None:
        return week
    return await weekly_service.latest_week(session)


async def week_block(
    session: AsyncSession, *, user_id: int, week: ContestWeek | None
) -> WeekMetricsBlock:
    """
    Блок «Показатели недели» (п. 4.1.2).

    Для закрытой недели показываются сохранённые итоги. Для идущей недели баллы
    и ожидаемые коины считаются на лету из уже выгруженных показателей, чтобы
    оператор видел прогресс, не дожидаясь пятницы.
    """
    if week is None:
        return WeekMetricsBlock()

    block = WeekMetricsBlock(
        week_id=week.id,
        week_label=week.label,
        week_status=str(week.status),
        starts_on=week.starts_on,
        ends_on=week.ends_on,
        is_final=week.status == WeekStatus.CLOSED,
    )

    result = await session.scalar(
        select(OperatorWeekResult).where(
            OperatorWeekResult.week_id == week.id,
            OperatorWeekResult.user_id == user_id,
        )
    )

    if result is not None:
        block.base_points = result.base_points
        block.penalty_points = result.penalty_points
        block.final_points = result.final_points
        block.coins_from_points = result.coins_from_points
        block.coins_rank_bonus = result.coins_rank_bonus
        block.coins_discipline_bonus = result.coins_discipline_bonus
        block.coins_nomination_bonus = result.coins_nomination_bonus
        block.coins_total = result.coins_total
        # Старые снимки содержали 0 для отсутствующих показателей. Если есть
        # список фактически загруженных кодов, восстанавливаем отсутствие в UI,
        # не меняя сохранённых итогов закрытой недели.
        snapshot = result.breakdown or {}
        reported = snapshot.get("reported_codes")
        block.metrics = []
        for metric in snapshot.get("metrics", []):
            item = dict(metric)
            if reported is not None and item.get("code") not in reported:
                item.update(value=None, completion=None)
            block.metrics.append(MetricProgress(**item))
        return block

    # Неделя ещё не рассчитывалась - считаем предварительно.
    definitions = await weekly_service.active_metric_definitions(session)
    rows = await session.execute(
        select(OperatorWeekMetric.metric_code, OperatorWeekMetric.value).where(
            OperatorWeekMetric.week_id == week.id, OperatorWeekMetric.user_id == user_id
        )
    )
    values = {code: float(value) for code, value in rows}
    score = score_week(definitions, values)
    rules = await get_rules(session)

    block.base_points = score.base_points
    block.penalty_points = score.penalty_points
    block.final_points = score.final_points
    block.metrics = [MetricProgress(**m.as_dict()) for m in score.metrics]
    block.coins_from_points = points_to_coins(score.final_points, rules.points_per_coin)
    block.coins_total = block.coins_from_points
    return block


async def _last_known_result(
    session: AsyncSession, user_id: int
) -> OperatorWeekResult | None:
    """Последний рассчитанный итог оператора по любой неделе."""
    return await session.scalar(
        select(OperatorWeekResult)
        .join(ContestWeek, ContestWeek.id == OperatorWeekResult.week_id)
        .where(OperatorWeekResult.user_id == user_id)
        .order_by(ContestWeek.starts_on.desc())
        .limit(1)
    )


async def balance_block(
    session: AsyncSession, *, user: User, week: ContestWeek | None
) -> BalanceBlock:
    """Блок «Мой баланс» (п. 4.1.1)."""
    account = await coins_service.get_account(session, user.id)

    earned = 0
    rank = previous_rank = rank_delta = None
    participants = 0

    if week is not None:
        start, end = _week_datetime_bounds(week)
        earned = await coins_service.earned_between(session, user.id, start, end)

        result = await session.scalar(
            select(OperatorWeekResult).where(
                OperatorWeekResult.week_id == week.id,
                OperatorWeekResult.user_id == user.id,
            )
        )
        if result is None:
            # Текущая неделя ещё не рассчитана - показываем последнее известное
            # место, иначе в середине недели кабинет выглядел бы пустым.
            result = await _last_known_result(session, user.id)

        if result is not None:
            rank = result.rank
            previous_rank = result.previous_rank
            rank_delta = result.rank_delta
            participants = int(
                await session.scalar(
                    select(func.count(OperatorWeekResult.id)).where(
                        OperatorWeekResult.week_id == result.week_id
                    )
                )
                or 0
            )

    return BalanceBlock(
        balance=account.balance,
        reserved=account.reserved,
        available=account.available,
        earned_this_week=earned,
        total_earned=account.total_earned,
        total_spent=account.total_spent,
        rank=rank,
        participants=participants,
        previous_rank=previous_rank,
        rank_delta=rank_delta,
    )


async def my_nominations(
    session: AsyncSession, *, user_id: int, week: ContestWeek | None
) -> list[NominationBrief]:
    if week is None:
        return []
    rows = await session.execute(
        select(
            NominationDefinition.code,
            NominationDefinition.title,
            NominationWinner.coins_awarded,
        )
        .join(NominationWinner, NominationWinner.nomination_id == NominationDefinition.id)
        .where(NominationWinner.week_id == week.id, NominationWinner.user_id == user_id)
    )
    return [
        NominationBrief(code=code, title=title, coins_awarded=coins)
        for code, title, coins in rows
    ]


async def badge_counters(session: AsyncSession, user_id: int) -> tuple[int, int]:
    board = await badges_service.user_badge_board(session, user_id)
    unlocked = sum(1 for progress, _ in board if progress.unlocked)
    return unlocked, len(board)


async def pending_requests_count(session: AsyncSession, user_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count(ShopRequest.id)).where(
                ShopRequest.user_id == user_id,
                ShopRequest.status == ShopRequestStatus.NEW,
            )
        )
        or 0
    )
