"""Analytics follows team ownership even when the employee directory is broader."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.coin import CoinTransaction
from app.models.contest import OperatorDayMetric, OperatorWeekMetric, OperatorWeekResult
from app.models.enums import Role, TxType, WeekStatus
from app.models.shop import ShopItem, ShopRequest
from app.models.user import Group
from app.services import weekly
from tests.conftest import auth, login, make_group, make_user


@pytest.fixture
async def analytics_teams(session, operator, supervisor):
    second_group = await make_group(session, code="second", supervisor_id=supervisor.id)
    teammate = await make_user(session, login="second-team", group_id=second_group.id)
    foreign_supervisor = await make_user(session, login="foreign-sv", role=Role.SUPERVISOR)
    foreign_group = await make_group(session, code="foreign", supervisor_id=foreign_supervisor.id)
    outsider = await make_user(session, login="foreign-op", group_id=foreign_group.id)
    unassigned = await make_user(session, login="unassigned")
    inactive = await make_user(session, login="inactive", group_id=operator.group_id)
    inactive.is_active = False
    # Membership in a group does not grant its supervision or its analytics.
    supervisor.group_id = foreign_group.id
    members = [operator, teammate, outsider, unassigned, inactive]
    item_id = await session.scalar(select(ShopItem.id).limit(1))
    weeks = []
    for offset in range(4):
        monday = date(2026, 9, 7) + timedelta(weeks=offset)
        week = await weekly.get_or_create_week(session, monday)
        weeks.append(week)
        for person, value in zip(
            members, [20 + offset * 10, 40 + offset * 10, 90, 100, 999], strict=True
        ):
            session.add_all(
                [
                    OperatorWeekMetric(
                        week_id=week.id, user_id=person.id, metric_code="quality", value=value
                    ),
                    OperatorDayMetric(
                        day=monday, user_id=person.id, metric_code="quality", value=value
                    ),
                ]
            )
    weeks[-1].status = WeekStatus.CALCULATED
    for person, amount in zip(members, [7, 9, 900, 1000, 9999], strict=True):
        session.add_all(
            [
                CoinTransaction(
                    user_id=person.id,
                    amount=amount,
                    balance_after=amount,
                    tx_type=TxType.MANUAL_CREDIT,
                    reason="Analytics scope fixture",
                    week_id=weeks[-1].id,
                    created_at=datetime(2026, 9, 28, 12, tzinfo=UTC),
                ),
                ShopRequest(user_id=person.id, item_id=item_id, price=1),
                OperatorWeekResult(
                    week_id=weeks[-1].id, user_id=person.id, final_points=amount, rank=1
                ),
            ]
        )
    await session.commit()
    return {
        "operator": operator,
        "teammate": teammate,
        "outsider": outsider,
        "unassigned": unassigned,
        "foreign_group": foreign_group,
        "second_group": second_group,
        "supervisor": supervisor,
        "weeks": weeks,
    }


@pytest.mark.parametrize("endpoint", ["summary", "overview"])
@pytest.mark.parametrize("grain", ["day", "week", "month", "range"])
async def test_every_analytics_period_scopes_all_outputs(
    client, analytics_teams, head, endpoint, grain
):
    team = analytics_teams
    own_ids = {team["operator"].id, team["teammate"].id}
    all_ids = own_ids | {team["outsider"].id, team["unassigned"].id}
    path = f"/api/v1/analytics/{endpoint}"
    params = {"grain": grain, "date_from": "2026-09-07", "date_to": "2026-09-28"}
    for actor, allowed_ids, coins in [(team["supervisor"], own_ids, 16), (head, all_ids, 1916)]:
        response = await client.get(
            path,
            params={**params, "operator_ids": ",".join(map(str, sorted(allowed_ids)))},
            headers=auth(await login(client, actor.login)),
        )
        assert response.status_code == 200, response.text
        report = response.json()
        count = len(allowed_ids)
        assert report["operator_count"] == report["operators_with_data"] == count
        assert report["pending_requests"] == count
        assert report["coins_awarded"] == coins
        assert {row["user_id"] for row in report["operators"]} == allowed_ids
        assert {row["id"] for row in report["comparisons"]} == allowed_ids
        assert sum(row["total"] for row in report["groups"]) == count
        assert {row["id"] for row in report["groups"]} == (
            {team["operator"].group_id, team["second_group"].id}
            if actor is team["supervisor"]
            else {team["operator"].group_id, team["second_group"].id, team["foreign_group"].id, 0}
        )
        quality = next(metric for metric in report["metrics"] if metric["code"] == "quality")
        expected_trend = [30, 40, 50, 60] if count == 2 else [62.5, 67.5, 72.5, 77.5]
        expected_value = expected_trend[-1] if grain in ("day", "week") else sum(expected_trend) / 4
        assert quality["value"] == expected_value
        assert quality["reported"] == quality["total"] == count
        assert quality["coverage"] == 1
        assert quality["below_target"] == (2 if count == 2 else 3)
        plotted = [point for point in report["trend"] if point["value"] is not None]
        expected_points = [expected_value] if grain == "month" else expected_trend
        assert [point["value"] for point in plotted] == expected_points
        assert all(point["reported"] == count for point in plotted)
        assert [value for value in quality["trend"] if value is not None] == expected_points
        if grain == "week":
            assert len(report["trend"]) == 4
            assert sum(person["points"] for person in report["operators"]) == coins
            operator_trends = {
                person["user_id"]: person["trends"]["quality"] for person in report["operators"]
            }
            assert operator_trends[team["operator"].id] == [20, 30, 40, 50]


async def test_analytics_rejects_forged_filters_and_allows_owned_groups(client, analytics_teams):
    team = analytics_teams
    headers = auth(await login(client, team["supervisor"].login))
    for endpoint in ("summary", "overview"):
        path = f"/api/v1/analytics/{endpoint}"
        for params in (
            {"group_id": team["foreign_group"].id},
            {"operator_ids": str(team["outsider"].id)},
            {"operator_ids": str(team["unassigned"].id)},
            {"operator_ids": f"{team['operator'].id},{team['outsider'].id}"},
        ):
            response = await client.get(path, params=params, headers=headers)
            assert response.status_code == 403, response.text
        response = await client.get(
            path,
            params={"group_id": team["second_group"].id, "operator_ids": team["teammate"].id},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert [row["user_id"] for row in response.json()["operators"]] == [team["teammate"].id]


async def test_supervisor_without_owned_groups_has_no_analytics(client, session, analytics_teams):
    team = analytics_teams
    groups = await session.scalars(
        select(Group).where(Group.supervisor_id == team["supervisor"].id)
    )
    for group in groups:
        group.supervisor_id = None
    await session.commit()
    headers = auth(await login(client, team["supervisor"].login))
    response = await client.get("/api/v1/analytics/summary", headers=headers)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["operator_count"] == report["operators_with_data"] == 0
    assert report["pending_requests"] == report["coins_awarded"] == 0
    assert report["operators"] == report["groups"] == report["comparisons"] == []
    assert all(metric["value"] is None for metric in report["metrics"])
    assert all(point["value"] is None and point["reported"] == 0 for point in report["trend"])
    denied = await client.get(
        "/api/v1/analytics/summary", params={"operator_ids": team["operator"].id}, headers=headers
    )
    assert denied.status_code == 403


async def test_admin_and_head_can_read_any_team(client, session, analytics_teams, head):
    team = analytics_teams
    admin = await make_user(session, login="analytics-admin", role=Role.ADMIN)
    for actor in (head, admin):
        headers = auth(await login(client, actor.login))
        response = await client.get("/api/v1/analytics/summary", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["operator_count"] == 4
        selected = await client.get(
            "/api/v1/analytics/summary",
            params={"group_id": team["foreign_group"].id, "operator_ids": team["outsider"].id},
            headers=headers,
        )
        assert selected.status_code == 200, selected.text
        assert [row["user_id"] for row in selected.json()["operators"]] == [team["outsider"].id]


async def test_personal_analytics_stays_private(client, analytics_teams):
    team = analytics_teams
    headers = auth(await login(client, team["operator"].login))
    for endpoint in ("summary", "overview"):
        assert (
            await client.get(f"/api/v1/analytics/{endpoint}", headers=headers)
        ).status_code == 403
    own = await client.get("/api/v1/analytics/me", headers=headers)
    assert own.status_code == 200, own.text
    report = own.json()
    assert [row["user_id"] for row in report["operators"]] == [team["operator"].id]
    assert report["operator_count"] == report["pending_requests"] == 1
    assert report["coins_awarded"] == 7
