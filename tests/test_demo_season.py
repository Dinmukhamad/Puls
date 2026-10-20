"""Демо-данные для показа: места и баллы есть, коинов нет, удаление возвращает недели как были."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.coin import CoinTransaction
from app.models.contest import (
    DEMO_SOURCE,
    ContestMonth,
    ContestWeek,
    OperatorDayMetric,
    OperatorMonthResult,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import WeekStatus
from app.models.progress import Notification
from app.services import months as months_service
from app.services import weekly as weekly_service
from scripts.seed_demo_season import fill, remove
from tests.conftest import make_user

TODAY = date(2026, 10, 20)


async def _count(session: AsyncSession, column, *where) -> int:
    return int(await session.scalar(select(func.count(column)).where(*where)) or 0)


async def test_demo_season_fills_places_without_coins_and_removes_cleanly(
    session: AsyncSession, operator
) -> None:
    second = await make_user(session, login="demo2")
    # Как в рабочей базе: недели сентября закрыты пустыми, у оператора есть настоящие дни.
    closed = await weekly_service.get_or_create_week(session, date(2026, 9, 14))
    closed.status = WeekStatus.CLOSED
    closed.closed_at = datetime(2026, 9, 21, tzinfo=UTC)
    session.add(
        OperatorDayMetric(
            user_id=operator.id,
            day=date(2026, 9, 15),
            metric_code="quality",
            value=97.0,
            source="report",
        )
    )
    await session.commit()

    await fill(session, TODAY)
    await session.commit()

    assert await _count(session, CoinTransaction.id) == 0
    assert await _count(session, Notification.id) == 0
    week = await session.get(ContestWeek, closed.id)
    assert week.status == WeekStatus.CLOSED
    results = list(
        await session.scalars(
            select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
        )
    )
    assert {r.user_id for r in results} == {operator.id, second.id}
    assert all(r.rank is not None and r.coins_total == 0 for r in results)
    # The real day stays real, and the week's value comes from it.
    real = await session.scalar(
        select(OperatorDayMetric).where(
            OperatorDayMetric.user_id == operator.id, OperatorDayMetric.day == date(2026, 9, 15)
        )
    )
    assert real.source == "report"
    quality = await session.scalar(
        select(OperatorWeekMetric).where(
            OperatorWeekMetric.week_id == week.id,
            OperatorWeekMetric.user_id == operator.id,
            OperatorWeekMetric.metric_code == "quality",
        )
    )
    assert quality.value == 97.0 and quality.source == DEMO_SOURCE
    october = await session.scalar(
        select(ContestMonth).where(ContestMonth.year == 2026, ContestMonth.month == 10)
    )
    months = list(
        await session.scalars(
            select(OperatorMonthResult).where(OperatorMonthResult.month_id == october.id)
        )
    )
    assert months and all(r.coins_rank_bonus == 0 and r.coins_nomination_bonus == 0 for r in months)

    # Closing a week or a month with demo values would pay real coins: refused.
    current = await session.scalar(
        select(ContestWeek).where(ContestWeek.starts_on == date(2026, 10, 19))
    )
    with pytest.raises(ConflictError):
        await weekly_service.close_week(session, current)
    await session.rollback()
    september = await session.scalar(
        select(ContestMonth).where(ContestMonth.year == 2026, ContestMonth.month == 9)
    )
    for item in await session.scalars(select(ContestWeek)):
        item.status = WeekStatus.CLOSED
    with pytest.raises(ConflictError):
        await months_service.close(session, september)
    await session.rollback()

    await fill(session, TODAY)  # a second run adds nothing and keeps how the weeks were
    await session.commit()
    await remove(session)
    await session.commit()

    assert (
        await _count(session, OperatorWeekMetric.id, OperatorWeekMetric.source == DEMO_SOURCE) == 0
    )
    assert await _count(session, OperatorDayMetric.id, OperatorDayMetric.source == DEMO_SOURCE) == 0
    assert await _count(session, OperatorDayMetric.id) == 1
    assert await _count(session, OperatorWeekResult.id) == 0
    assert await _count(session, OperatorMonthResult.id) == 0
    week = await session.get(ContestWeek, closed.id)
    assert week.status == WeekStatus.CLOSED
    # Weeks the demo created are gone; weeks that were there stay.
    assert (
        await session.scalar(select(ContestWeek).where(ContestWeek.starts_on == date(2026, 10, 19)))
        is None
    )
    assert await _count(session, CoinTransaction.id) == 0
