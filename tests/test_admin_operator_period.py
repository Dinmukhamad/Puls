"""Custom reporting ranges preserve weekly snapshots and exact coin dates."""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.access import AccessRule
from app.models.coin import CoinTransaction
from app.models.contest import ContestWeek, OperatorWeekResult
from app.models.enums import Role, TxType, WeekStatus
from app.models.user import CoinAccount, User
from app.services import staff
from app.services.weekly import get_or_create_week
from tests.conftest import auth, login, make_group, make_user


async def _week(
    session: AsyncSession, day: int, status: WeekStatus = WeekStatus.CLOSED
) -> ContestWeek:
    week = await get_or_create_week(session, date(2026, 10, day))
    week.status = status
    await session.flush()
    return week


def _result(week: ContestWeek, user: User, points: float, *, rank: int = 1):
    return OperatorWeekResult(
        week_id=week.id, user_id=user.id, final_points=points, rank=rank,
        lateness_count=1, forbidden_sites_count=2, coins_total=999,
    )


def _transaction(user: User, amount: int, timestamp: datetime) -> CoinTransaction:
    return CoinTransaction(
        user_id=user.id, amount=amount, created_at=timestamp, balance_after=400,
        tx_type=TxType.MANUAL_CREDIT if amount > 0 else TxType.MANUAL_DEBIT,
        reason="Проверка периода",
    )


@pytest.mark.parametrize("endpoint", ["summary", "operators", "operators/export"])
async def test_period_parameters_reject_incomplete_reversed_and_mixed_ranges(
    client: AsyncClient, head: User, endpoint: str
) -> None:
    headers = auth(await login(client, head.login))
    invalid_ranges = [
        {"date_from": "2026-10-05"},
        {"date_to": "2026-10-05"},
        {"date_from": "2026-10-14", "date_to": "2026-10-05"},
        {"date_from": "2026-10-05", "date_to": "2026-10-14", "week_id": 1},
        {"date_from": "0001-01-01", "date_to": "2026-10-14"},
        {"date_from": "2026-10-05", "date_to": "9999-12-31"},
    ]
    for params in invalid_ranges:
        response = await client.get(f"/api/v1/admin/{endpoint}", headers=headers, params=params)
        assert response.status_code == 400, response.text
        assert response.json()["code"] == "invalid_period"
    bad_date = await client.get(
        f"/api/v1/admin/{endpoint}", headers=headers,
        params={"date_from": "bad-date", "date_to": "2026-10-14"},
    )
    assert bad_date.status_code == 422


async def test_ten_day_range_uses_local_midnights_and_never_mutates_wallet(
    client: AsyncClient, session: AsyncSession, operator: User, head: User, monkeypatch
) -> None:
    monkeypatch.setattr(get_settings(), "TIMEZONE", "Asia/Qyzylorda")
    first = await _week(session, 5)
    partial = await _week(session, 12)
    session.add_all([
        _result(first, operator, 75), _result(partial, operator, 800),
        _transaction(operator, 1, datetime(2026, 10, 4, 18, 59, 59, tzinfo=UTC)),
        _transaction(operator, 10, datetime(2026, 10, 4, 19, tzinfo=UTC)),
        _transaction(operator, 20, datetime(2026, 10, 14, 18, 59, 59, tzinfo=UTC)),
        _transaction(operator, 100, datetime(2026, 10, 14, 19, tzinfo=UTC)),
        _transaction(operator, -5, datetime(2026, 10, 10, 12, tzinfo=UTC)),
    ])
    await session.commit()
    before = await session.scalar(select(CoinAccount).where(CoinAccount.user_id == operator.id))
    assert before is not None
    snapshot = (before.balance, before.reserved, before.total_earned, before.total_spent)

    headers = auth(await login(client, head.login))
    params = {"date_from": "2026-10-05", "date_to": "2026-10-14"}
    response = await client.get("/api/v1/admin/operators", headers=headers, params=params)
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["coins_week"] == 30
    assert item["points"] == 75
    assert item["lateness"] == 1
    assert item["forbidden_sites"] == 2
    assert item["metrics_available"] is True
    assert item["scored_weeks_count"] == 1
    assert (
        item["balance"], item["reserved"], item["total_earned"], item["total_spent"]
    ) == snapshot

    summary = (await client.get(
        "/api/v1/admin/summary", headers=headers, params=params
    )).json()
    assert summary["coins_awarded_in_period"] == 30
    assert summary["coins_awarded_this_week"] == 30
    assert summary["date_from"] == params["date_from"]
    assert summary["date_to"] == params["date_to"]
    assert summary["week_label"] is None and summary["week_status"] is None
    assert summary["scored_weeks_count"] == 1
    assert summary["metrics_available"] is True
    await session.refresh(before)
    assert (before.balance, before.reserved, before.total_earned, before.total_spent) == snapshot


async def test_three_day_range_exposes_unavailable_scores_instead_of_prorating(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    week = await _week(session, 5)
    session.add_all([
        _result(week, operator, 700),
        _transaction(operator, 7, datetime(2026, 10, 6, 12, tzinfo=UTC)),
    ])
    await session.commit()
    headers = auth(await login(client, head.login))
    params = {"date_from": "2026-10-05", "date_to": "2026-10-07"}
    item = (await client.get(
        "/api/v1/admin/operators", headers=headers, params=params
    )).json()["items"][0]
    assert item["metrics_available"] is False
    assert item["scored_weeks_count"] == 0
    assert item["rank"] is None
    assert item["coins_week"] == 7
    summary = (await client.get(
        "/api/v1/admin/summary", headers=headers, params=params
    )).json()
    assert summary["average_rank"] is None
    assert summary["scored_weeks_count"] == 0
    exported = await client.get("/api/v1/admin/operators/export", headers=headers, params=params)
    csv_rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))
    assert csv_rows[0][0] == "Период"
    assert csv_rows[0][6] == "Начислено коинов за период"
    assert csv_rows[1][0] == "05.10.2026–07.10.2026"
    assert csv_rows[1][4:7] == ["", "", "7"]
    assert csv_rows[1][11:13] == ["", ""]
    assert "operators_2026-10-05_2026-10-07.csv" in exported.headers["content-disposition"]


async def test_month_aggregates_complete_scored_weeks_and_keeps_search_rank_and_export_parity(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    beta = await make_user(session, login="beta", full_name="Бета Второй")
    gamma = await make_user(session, login="gamma", full_name="Гамма Третий")
    unscored = await make_user(session, login="unscored", full_name="Без показателей")
    first = await _week(session, 5)
    second = await _week(session, 12)
    unfinalized = await _week(session, 19, WeekStatus.CALCULATED)
    crossing = await _week(session, 26)  # Ends in November, outside selected month.
    session.add_all([
        _result(first, operator, 40), _result(second, operator, 60),
        _result(first, beta, 70), _result(second, beta, 80),
        _result(first, gamma, 100), _result(second, gamma, 50),
        _result(unfinalized, operator, 10000), _result(crossing, operator, 10000),
    ])
    await session.commit()
    headers = auth(await login(client, head.login))
    params = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
    response = await client.get("/api/v1/admin/operators", headers=headers, params=params)
    assert response.status_code == 200, response.text
    items = {row["user_id"]: row for row in response.json()["items"]}
    assert items[operator.id]["points"] == 100
    assert items[operator.id]["rank"] == 3
    assert items[operator.id]["lateness"] == 2
    assert items[operator.id]["forbidden_sites"] == 4
    assert items[operator.id]["scored_weeks_count"] == 2
    assert items[beta.id]["rank"] == items[gamma.id]["rank"] == 1
    assert items[unscored.id]["rank"] is None
    assert items[unscored.id]["metrics_available"] is False
    searched = await client.get(
        "/api/v1/admin/operators", headers=headers,
        params={**params, "search": operator.full_name, "size": 1},
    )
    assert searched.json()["total"] == 1
    assert searched.json()["items"][0]["rank"] == 3
    page = await client.get(
        "/api/v1/admin/operators", headers=headers, params={**params, "size": 1, "page": 3}
    )
    assert page.json()["items"][0]["user_id"] == operator.id
    assert page.json()["total"] == 4
    exported = await client.get(
        "/api/v1/admin/operators/export", headers=headers,
        params={**params, "search": operator.full_name},
    )
    csv_rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))
    assert len(csv_rows) == 2
    assert csv_rows[1][1] == operator.full_name
    assert csv_rows[1][4:6] == ["3", "100"]
    summary = (await client.get(
        "/api/v1/admin/summary", headers=headers, params=params
    )).json()
    assert summary["scored_weeks_count"] == 2
    assert summary["average_rank"] == 1.67


async def test_period_service_respects_visibility_before_ranking_and_counts(
    session: AsyncSession, operator: User
) -> None:
    outsider = await make_user(session, login="outsider", full_name="Чужой оператор")
    week = await _week(session, 5)
    session.add_all([
        _result(week, operator, 50), _result(week, outsider, 500),
        _transaction(outsider, 500, datetime(2026, 10, 6, 12, tzinfo=UTC)),
    ])
    await session.commit()
    period = staff.operator_period(date(2026, 10, 5), date(2026, 10, 11))
    visibility = User.id == operator.id
    rows, total = await staff.operators_table(
        session, week=None, visibility=visibility, period=period
    )
    assert total == len(rows) == 1
    assert rows[0].user_id == operator.id and rows[0].rank == 1
    summary = await staff.summary(session, week=None, visibility=visibility, period=period)
    assert summary.operators_total == 1
    assert summary.coins_awarded_in_period == 0
    assert summary.average_rank == 1


async def test_period_ranks_equal_decimal_totals_together(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    second_operator = await make_user(session, login="decimal-tie")
    first_week = await _week(session, 5)
    second_week = await _week(session, 12)
    session.add_all([
        _result(first_week, operator, 0.1), _result(second_week, operator, 0.2),
        _result(first_week, second_operator, 0.3), _result(second_week, second_operator, 0),
    ])
    await session.commit()
    params = {"date_from": "2026-10-05", "date_to": "2026-10-18"}
    headers = auth(await login(client, head.login))
    response = await client.get("/api/v1/admin/operators", headers=headers, params=params)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 2
    assert [item["points"] for item in items] == [0.3, 0.3]
    assert [item["rank"] for item in items] == [1, 1]
    summary = (await client.get(
        "/api/v1/admin/summary", headers=headers, params=params
    )).json()
    assert summary["average_rank"] == 1
    exported = await client.get("/api/v1/admin/operators/export", headers=headers, params=params)
    csv_rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))
    assert [row[4:6] for row in csv_rows[1:]] == [["1", "0.3"], ["1", "0.3"]]


async def test_supervisor_period_api_preserves_directory_visibility_and_group_filter(
    client: AsyncClient, session: AsyncSession, operator: User, supervisor: User, head: User
) -> None:
    other_supervisor = await make_user(session, login="other-supervisor", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="other-team", supervisor_id=other_supervisor.id)
    outsider = await make_user(session, login="other-team-op", group_id=other_group.id)
    week = await _week(session, 5)
    session.add_all([
        _result(week, operator, 50), _result(week, outsider, 100), _result(week, head, 1000),
        _transaction(operator, 10, datetime(2026, 10, 6, 12, tzinfo=UTC)),
        _transaction(outsider, 20, datetime(2026, 10, 6, 12, tzinfo=UTC)),
        _transaction(head, 1000, datetime(2026, 10, 6, 12, tzinfo=UTC)),
    ])
    await session.commit()
    params = {"date_from": "2026-10-05", "date_to": "2026-10-11"}
    headers = auth(await login(client, supervisor.login))
    response = await client.get("/api/v1/admin/operators", headers=headers, params=params)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    # Directory reads include other teams; management permissions remain narrower.
    assert response.json()["total"] == 2
    assert {item["user_id"] for item in items} == {operator.id, outsider.id}
    assert {item["user_id"]: item["rank"] for item in items} == {
        operator.id: 2, outsider.id: 1,
    }
    summary = (await client.get(
        "/api/v1/admin/summary", headers=headers, params=params
    )).json()
    assert summary["operators_total"] == 2
    assert summary["coins_awarded_in_period"] == 30
    assert summary["average_rank"] == 1.5
    denied_export = await client.get(
        "/api/v1/admin/operators/export", headers=headers, params=params
    )
    assert denied_export.status_code == 403  # Reports permission is separate from directory reads.
    session.add(AccessRule(
        target_type="user", target_id=str(supervisor.id), section="reports", effect="allow"
    ))
    await session.commit()
    exported = await client.get("/api/v1/admin/operators/export", headers=headers, params=params)
    assert exported.status_code == 200, exported.text
    csv_rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))
    assert {row[2] for row in csv_rows[1:]} == {operator.login, outsider.login}
    group_params = {**params, "group_id": operator.group_id}
    grouped = await client.get(
        "/api/v1/admin/operators", headers=headers, params=group_params
    )
    assert grouped.json()["total"] == 1
    assert grouped.json()["items"][0]["user_id"] == operator.id
    assert grouped.json()["items"][0]["rank"] == 2
    exported_group = await client.get(
        "/api/v1/admin/operators/export", headers=headers, params=group_params
    )
    assert exported_group.status_code == 200, exported_group.text
    group_csv = list(csv.reader(
        io.StringIO(exported_group.content.decode("utf-8-sig")), delimiter=";"
    ))
    assert len(group_csv) == 2 and group_csv[1][2] == operator.login


async def test_legacy_default_and_explicit_week_contract_are_preserved(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    week = await _week(session, 5)
    session.add(_result(week, operator, 80, rank=2))
    await session.commit()
    headers = auth(await login(client, head.login))
    for params in ({}, {"week_id": week.id}):
        response = await client.get("/api/v1/admin/operators", headers=headers, params=params)
        item = response.json()["items"][0]
        assert item["points"] == 80 and item["rank"] == 2
        assert item["coins_week"] == 999
        summary = (await client.get(
            "/api/v1/admin/summary", headers=headers, params=params
        )).json()
        assert summary["week_label"] == week.label
        assert summary["date_from"] == "2026-10-05"
        assert summary["date_to"] == "2026-10-11"
        assert summary["coins_awarded_in_period"] is None


async def test_period_does_not_bypass_operator_read_permission(
    client: AsyncClient, operator: User
) -> None:
    headers = auth(await login(client, operator.login))
    params = {"date_from": "2026-10-05", "date_to": "2026-10-14"}
    for endpoint in ("summary", "operators", "operators/export"):
        response = await client.get(f"/api/v1/admin/{endpoint}", headers=headers, params=params)
        assert response.status_code == 403
