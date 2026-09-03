"""Еженедельный расчёт: баллы, места, бонусы, идемпотентность (п. 3, п. 7)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.coin import CoinTransaction
from app.models.contest import NominationWinner, OperatorWeekMetric, OperatorWeekResult
from app.models.enums import TxType, WeekStatus
from app.services import coins as coins_service
from app.services import weekly as weekly_service
from app.services.rules import get_rules
from tests.conftest import make_user

METRICS_STRONG = {
    "hours_worked": 40,
    "overtime": 8,
    "quality": 100,
    "efficiency": 100,
    "calls_per_hour": 12,
    "driver_gratitudes": 5,
    "lateness": 0,
    "forbidden_sites": 0,
}
METRICS_WEAK = {
    "hours_worked": 20,
    "overtime": 0,
    "quality": 60,
    "efficiency": 50,
    "calls_per_hour": 6,
    "driver_gratitudes": 0,
    "lateness": 2,
    "forbidden_sites": 1,
}


async def _add_metrics(
    session: AsyncSession, week_id: int, user_id: int, values: dict[str, float]
) -> None:
    for code, value in values.items():
        session.add(
            OperatorWeekMetric(
                week_id=week_id, user_id=user_id, metric_code=code, value=float(value)
            )
        )
    await session.flush()


async def _setup_week(session: AsyncSession, day: date | None = None):
    week = await weekly_service.get_or_create_week(session, day or date(2026, 6, 1))
    best = await make_user(session, login="best", full_name="Лидер Недели")
    middle = await make_user(session, login="middle", full_name="Середняк Обычный")
    worst = await make_user(session, login="worst", full_name="Отстающий Оператор")

    await _add_metrics(session, week.id, best.id, METRICS_STRONG)
    await _add_metrics(
        session, week.id, middle.id, {**METRICS_STRONG, "quality": 80, "efficiency": 75}
    )
    await _add_metrics(session, week.id, worst.id, METRICS_WEAK)
    await session.commit()
    return week, best, middle, worst


async def test_ranks_are_assigned_by_final_points(session: AsyncSession) -> None:
    week, best, middle, worst = await _setup_week(session)
    results = await weekly_service.calculate_week(session, week)
    await session.commit()

    by_user = {r.user_id: r for r in results}
    assert by_user[best.id].rank == 1
    assert by_user[middle.id].rank == 2
    assert by_user[worst.id].rank == 3
    assert by_user[best.id].final_points > by_user[worst.id].final_points


async def test_antimetrics_reduce_points_before_conversion(session: AsyncSession) -> None:
    week, _, _, worst = await _setup_week(session)
    results = await weekly_service.calculate_week(session, week)
    await session.commit()

    weak = next(r for r in results if r.user_id == worst.id)
    # 2 опоздания по 5 баллов + 1 сайт за 3 балла.
    assert weak.penalty_points == pytest.approx(13.0)
    assert weak.final_points == pytest.approx(weak.base_points - 13.0)


async def test_close_week_awards_coins_by_rate(session: AsyncSession) -> None:
    week, best, _, _ = await _setup_week(session)
    rules = await get_rules(session)

    report = await weekly_service.close_week(session, week)
    await session.commit()

    result = await session.scalar(
        select(OperatorWeekResult).where(
            OperatorWeekResult.week_id == week.id, OperatorWeekResult.user_id == best.id
        )
    )
    assert result.coins_from_points == int(result.final_points // rules.points_per_coin)
    # Первое место, ноль опозданий и ноль посторонних сайтов.
    assert result.coins_rank_bonus == rules.rank1_bonus
    assert result.coins_discipline_bonus == (
        rules.no_lateness_bonus + rules.no_forbidden_sites_bonus
    )

    account = await coins_service.get_account(session, best.id)
    assert account.balance == result.coins_total
    assert account.total_earned == result.coins_total
    assert report.coins_awarded > 0
    assert week.status == WeekStatus.CLOSED


async def test_each_bonus_is_a_separate_history_line(session: AsyncSession) -> None:
    week, best, _, _ = await _setup_week(session)
    await weekly_service.close_week(session, week)
    await session.commit()

    types = set(
        await session.scalars(
            select(CoinTransaction.tx_type).where(CoinTransaction.user_id == best.id)
        )
    )
    assert TxType.WEEKLY_POINTS in types
    assert TxType.RANK_BONUS in types
    assert TxType.NO_LATENESS_BONUS in types
    assert TxType.NO_SITES_BONUS in types


async def test_closing_twice_does_not_double_coins(session: AsyncSession) -> None:
    week, best, _, _ = await _setup_week(session)
    await weekly_service.close_week(session, week)
    await session.commit()
    balance_after_first = (await coins_service.get_account(session, best.id)).balance

    second = await weekly_service.close_week(session, week)
    await session.commit()

    assert second.already_closed is True
    assert second.coins_awarded == 0
    assert (await coins_service.get_account(session, best.id)).balance == balance_after_first


async def test_closed_week_cannot_be_recalculated(session: AsyncSession) -> None:
    week, *_ = await _setup_week(session)
    await weekly_service.close_week(session, week)
    await session.commit()

    with pytest.raises(ConflictError):
        await weekly_service.calculate_week(session, week)


async def test_discipline_bonus_requires_reported_metric(session: AsyncSession) -> None:
    """Отсутствие выгрузки антипоказателя не считается «нарушений не было»."""
    week = await weekly_service.get_or_create_week(session, date(2026, 6, 1))
    user = await make_user(session, login="silent", full_name="Без Данных")
    metrics = {k: v for k, v in METRICS_STRONG.items() if k != "lateness"}
    await _add_metrics(session, week.id, user.id, metrics)
    await session.commit()

    await weekly_service.close_week(session, week)
    await session.commit()

    rules = await get_rules(session)
    result = await session.scalar(
        select(OperatorWeekResult).where(OperatorWeekResult.user_id == user.id)
    )
    assert result.coins_discipline_bonus == rules.no_forbidden_sites_bonus


async def test_rank_delta_compares_with_previous_week(session: AsyncSession) -> None:
    first_week, best, middle, worst = await _setup_week(session, date(2026, 6, 1))
    await weekly_service.close_week(session, first_week)
    await session.commit()

    second = await weekly_service.get_or_create_week(session, date(2026, 6, 8))
    await _add_metrics(session, second.id, best.id, METRICS_WEAK)
    await _add_metrics(session, second.id, middle.id, METRICS_STRONG)
    await _add_metrics(session, second.id, worst.id, METRICS_STRONG)
    await session.commit()

    results = await weekly_service.calculate_week(session, second)
    await session.commit()

    by_user = {r.user_id: r for r in results}
    assert by_user[best.id].previous_rank == 1
    assert by_user[best.id].rank_delta < 0  # опустился
    assert by_user[worst.id].rank_delta > 0  # поднялся


async def test_nominations_pick_winners(session: AsyncSession) -> None:
    week, best, _, _ = await _setup_week(session)
    await weekly_service.close_week(session, week)
    await session.commit()

    winners = list(
        await session.scalars(
            select(NominationWinner).where(NominationWinner.week_id == week.id)
        )
    )
    assert winners, "должна быть присуждена хотя бы одна номинация"
    assert all(w.coins_awarded > 0 for w in winners)


async def test_week_bounds_are_monday_to_sunday() -> None:
    start, end = weekly_service.week_bounds(date(2026, 6, 3))  # среда
    assert start == date(2026, 6, 1)
    assert end == date(2026, 6, 7)
    assert (end - start) == timedelta(days=6)
