from __future__ import annotations

from datetime import date

from tests.test_access_control_group_scope import _supervisor_with_group
from tests.test_coin_rules_and_group_scope import (
    _login,
    _make_group,
    _make_operator_in_group,
)


def test_supervisor_analytics_is_scoped_to_own_group(db_session, make_client):
    from app.models import entities as m

    group_a = _make_group(db_session, "AnalyticsScopeA")
    group_b = _make_group(db_session, "AnalyticsScopeB")
    op_a = _make_operator_in_group(db_session, group_a, full_name="Analytics Operator A")
    op_b = _make_operator_in_group(db_session, group_b, full_name="Analytics Operator B")

    db_session.add_all([
        m.OperatorDailyMetric(
            operator_id=op_a.id,
            operator_name=op_a.full_name,
            metric_date=date(2034, 4, 10),
            calls_count=10,
        ),
        m.OperatorDailyMetric(
            operator_id=op_b.id,
            operator_name=op_b.full_name,
            metric_date=date(2034, 4, 12),
            calls_count=20,
        ),
    ])
    db_session.commit()

    supervisor, password = _supervisor_with_group(db_session, group_a)
    client = _login(make_client, supervisor.username, password)

    groups_response = client.get("/api/analytics/groups-list")
    assert groups_response.status_code == 200, groups_response.text
    group_ids = {item["id"] for item in groups_response.json()["items"]}
    assert group_ids == {group_a.id}

    periods_response = client.get("/api/analytics/available-periods")
    assert periods_response.status_code == 200, periods_response.text
    periods = periods_response.json()["items"]
    assert any(item["start_date"] == "2034-04-10" for item in periods)
    assert not any(item["start_date"] == "2034-04-12" for item in periods)

    foreign_group_response = client.get(
        "/api/analytics/summary",
        params={
            "start_date": "2034-04-01",
            "end_date": "2034-04-30",
            "group_id": group_b.id,
        },
    )
    assert foreign_group_response.status_code == 403, foreign_group_response.text


def test_manager_analytics_groups_are_not_scoped(client, db_session):
    group_a = _make_group(db_session, "AnalyticsManagerA")
    group_b = _make_group(db_session, "AnalyticsManagerB")

    response = client.get("/api/analytics/groups-list")
    assert response.status_code == 200, response.text
    group_ids = {item["id"] for item in response.json()["items"]}
    assert {group_a.id, group_b.id} <= group_ids
