"""Тестовая неделя для аналитики: видна в отчётах, но не даёт баллов, мест, значков и коинов."""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeDefinition, UserBadge
from app.models.coin import CoinTransaction
from app.models.contest import (
    TEST_SOURCE,
    MetricDefinition,
    OperatorDayMetric,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import BadgeRule, Role
from app.services import analytics as analytics_service
from app.services import weekly as weekly_service
from app.services.analytics import at_target
from app.services.progress import progress_summary
from scripts.seed_test_week import fill, operator_week, remove
from tests.conftest import auth, login, make_user

MONDAY = date(2026, 10, 5)


async def _metrics(session: AsyncSession) -> list[MetricDefinition]:
    return list(
        await session.scalars(select(MetricDefinition).where(MetricDefinition.is_active.is_(True)))
    )


async def test_operator_week_is_stable_and_plausible(session: AsyncSession) -> None:
    metrics = await _metrics(session)
    days = [date(2026, 10, 5 + offset) for offset in range(7)]
    first, again = (
        operator_week(metrics, days, "2026-W41:7"),
        operator_week(metrics, days, "2026-W41:7"),
    )
    assert first == again, "a rerun must write the same numbers"
    assert operator_week(metrics, days, "2026-W41:8") != first
    worked = {day for day, _ in first.daily}
    assert len(worked) == 5, "two days off a week"
    assert set(first.weekly) == {metric.code for metric in metrics}
    for (_, code), value in first.daily.items():
        assert value >= 0, code
        if code in ("quality", "efficiency"):
            assert value <= 100, code
    assert first.weekly["hours_worked"] == sum(
        value for (_, code), value in first.daily.items() if code == "hours_worked"
    )
    # The team shows every state in analytics: a quarter meets all goals, the rest miss some.
    weeks = [
        operator_week(metrics, days, f"2026-W41:{number}", achiever=number % 4 == 0)
        for number in range(40)
    ]
    meets_all = [all(at_target(week.weekly[m.code], m) for m in metrics) for week in weeks]
    assert all(meets_all[::4]), "every achiever meets all goals"
    assert meets_all.count(True) < len(weeks) / 2, meets_all


async def test_week_fills_every_active_operator_and_keeps_real_values(
    session: AsyncSession,
) -> None:
    first = await make_user(session, login="op-a")
    second = await make_user(session, login="op-b")
    retired = await make_user(session, login="op-old")
    retired.is_active = False
    supervisor = await make_user(session, login="sv-a", role=Role.SUPERVISOR)
    week = await weekly_service.get_or_create_week(session, MONDAY)
    session.add(
        OperatorWeekMetric(
            week_id=week.id, user_id=second.id, metric_code="quality", value=97, source="report"
        )
    )
    session.add(
        OperatorDayMetric(
            user_id=second.id, day=MONDAY, metric_code="quality", value=99, source="report"
        )
    )
    await session.commit()

    week, operators, days, weekly = await fill(session, date(2026, 10, 10))
    await session.commit()
    metrics = await _metrics(session)
    assert (week.starts_on, operators) == (MONDAY, 2)
    assert weekly.created == 2 * len(metrics) - 1 and weekly.kept_real == 1
    users = set(await session.scalars(select(OperatorWeekMetric.user_id).distinct()))
    assert users == {first.id, second.id}, "only active operators, never staff"
    assert retired.id not in users and supervisor.id not in users
    real = await session.scalar(
        select(OperatorWeekMetric).where(
            OperatorWeekMetric.user_id == second.id, OperatorWeekMetric.metric_code == "quality"
        )
    )
    assert (real.value, real.source) == (97, "report")
    if days.kept_real:
        kept = await session.scalar(
            select(OperatorDayMetric).where(
                OperatorDayMetric.user_id == second.id,
                OperatorDayMetric.day == MONDAY,
                OperatorDayMetric.metric_code == "quality",
            )
        )
        assert (kept.value, kept.source) == (99, "report")

    # A rerun updates its own rows instead of adding new ones.
    _, _, days_again, weekly_again = await fill(session, MONDAY)
    await session.commit()
    assert days_again.created == weekly_again.created == 0
    assert weekly_again.updated == weekly.created


async def test_test_values_show_in_analytics_but_never_earn_anything(
    session: AsyncSession,
) -> None:
    operator = await make_user(session, login="op-a")
    head = await make_user(session, login="head-a", role=Role.HEAD)
    week, _, _, _ = await fill(session, MONDAY)
    await session.commit()

    weekly = await analytics_service.report(session, head, week_id=week.id)
    # By days the selected period is the last one, so end on a day the operator worked.
    worked = await session.scalar(
        select(func.max(OperatorDayMetric.day)).where(OperatorDayMetric.user_id == operator.id)
    )
    daily = await analytics_service.report(
        session, head, grain="day", date_from=MONDAY, date_to=worked
    )
    assert weekly.operators_with_data == daily.operators_with_data == 1
    assert (await weekly_service.unreported_metrics(session, week.id))[
        "missing"
    ], "test rows must not hide that real data is still missing"

    closed = await weekly_service.close_week(session, week)
    await session.commit()
    assert (closed.participants, closed.coins_awarded, closed.nominations_awarded) == (0, 0, 0)
    assert await session.scalar(select(func.count(OperatorWeekResult.id))) == 0
    assert (
        await session.scalar(
            select(func.count(CoinTransaction.id)).where(CoinTransaction.week_id == week.id)
        )
        == 0
    )
    assert (
        await session.scalar(
            select(func.count(UserBadge.id)).where(UserBadge.user_id == operator.id)
        )
        == 0
    )


async def test_remove_deletes_only_test_rows_and_a_real_upload_replaces_them(
    session: AsyncSession, client: AsyncClient
) -> None:
    operator = await make_user(session, login="op-a")
    await make_user(session, login="head-a", role=Role.HEAD)
    week, _, _, _ = await fill(session, MONDAY)
    await session.commit()
    headers = auth(await login(client, "head-a"))

    uploaded = await client.post(
        f"/api/v1/admin/weeks/{week.id}/metrics",
        headers=headers,
        json={"values": [{"user_id": operator.id, "metric_code": "quality", "value": 91}]},
    )
    assert uploaded.status_code == 200, uploaded.text
    reserved = await client.post(
        "/api/v1/admin/day-metrics",
        headers=headers,
        json={
            "source": "test",
            "values": [
                {"user_id": operator.id, "day": "2026-10-05", "metric_code": "quality", "value": 90}
            ],
        },
    )
    assert reserved.status_code == 422, "only the seeding script may mark values as test"

    removed_days, removed_week = await remove(session, MONDAY)
    await session.commit()
    assert removed_days > 0 and removed_week > 0
    left = list(await session.scalars(select(OperatorWeekMetric)))
    assert [(row.metric_code, row.value, row.source) for row in left] == [("quality", 91, "import")]
    assert (
        await session.scalar(
            select(func.count(OperatorDayMetric.id)).where(OperatorDayMetric.source == TEST_SOURCE)
        )
        == 0
    )


async def test_test_weeks_do_not_build_badge_streaks(session: AsyncSession) -> None:
    operator = await make_user(session, login="op-a")
    session.add(
        BadgeDefinition(
            code="one-clean-week",
            title="Неделя без опозданий",
            rule_type=BadgeRule.ZERO_METRIC_STREAK,
            rule_params={"metric": "lateness", "weeks": 1},
            coins_reward=50,
        )
    )
    week, _, _, _ = await fill(session, MONDAY)
    await session.commit()
    await weekly_service.close_week(session, week)
    await session.commit()

    data = await progress_summary(session, operator.id)
    badge = next(item for item in data["achievements"] if item.code == "one-clean-week")
    assert not badge.unlocked, "a test week is no proof of discipline"
