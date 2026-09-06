"""Validation and audit guarantees for the administrative configuration forms."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import AuditLog
from app.models.user import User
from tests.conftest import auth, login


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "   ", "code": "invalid", "target_value": 1},
        {"title": "Invalid", "code": "invalid", "target_value": 0},
        {"title": "Invalid", "code": "invalid", "max_points": -1},
        {"title": "Invalid", "code": "invalid", "penalty_per_unit": -1},
    ],
)
async def test_invalid_metric_is_rejected(client: AsyncClient, head: User, payload: dict) -> None:
    response = await client.post(
        "/api/v1/admin/config/metrics", headers=auth(await login(client, head.login)), json=payload
    )
    assert response.status_code == 400


async def test_configuration_create_update_audit_is_recorded(
    client: AsyncClient, session: AsyncSession, head: User
) -> None:
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/config/metrics",
        headers=headers,
        json={"code": "custom_metric", "title": "Показатель", "target_value": 10, "max_points": 5},
    )
    assert response.status_code == 201
    metric = response.json()
    response = await client.patch(
        f"/api/v1/admin/config/metrics/{metric['id']}",
        headers=headers,
        json={"target_value": 20, "is_active": False},
    )
    assert response.status_code == 200
    entries = list(
        await session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == "metric", AuditLog.entity_id == str(metric["id"]))
            .order_by(AuditLog.id)
        )
    )
    assert [entry.action for entry in entries] == ["metric.create", "metric.update"]
    assert entries[1].payload["before"]["target_value"] == 10
    assert entries[1].payload["after"]["target_value"] == 20
    assert entries[1].actor_id == head.id


async def test_rule_null_and_unknown_reference_do_not_replace_settings(
    client: AsyncClient, head: User
) -> None:
    headers = auth(await login(client, head.login))
    before = (await client.get("/api/v1/admin/config/rules", headers=headers)).json()
    for payload in [{"points_per_coin": None}, {"lateness_metric_code": "missing_metric"}]:
        response = await client.put("/api/v1/admin/config/rules", headers=headers, json=payload)
        assert response.status_code == 400
    after = (await client.get("/api/v1/admin/config/rules", headers=headers)).json()
    assert after == before


async def test_badge_rejects_malformed_rule_parameters(client: AsyncClient, head: User) -> None:
    response = await client.post(
        "/api/v1/admin/config/badges",
        headers=auth(await login(client, head.login)),
        json={
            "code": "bad_rule",
            "title": "Достижение",
            "rule_type": "top_rank",
            "rule_params": {"max_rank": "not-a-number"},
        },
    )
    assert response.status_code == 400


async def test_store_optional_limits_can_be_cleared_but_price_cannot(
    client: AsyncClient, head: User
) -> None:
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/config/shop-items",
        headers=headers,
        json={
            "code": "coffee_test",
            "title": "Кофе",
            "price": 5,
            "stock_limit": 20,
            "per_user_monthly_limit": 2,
        },
    )
    assert response.status_code == 201
    path = f"/api/v1/admin/config/shop-items/{response.json()['id']}"
    response = await client.patch(path, headers=headers, json={"price": None})
    assert response.status_code == 400
    response = await client.patch(
        path,
        headers=headers,
        json={"stock_limit": None, "per_user_monthly_limit": None, "is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["price"] == 5
    assert response.json()["stock_limit"] is None
    assert response.json()["per_user_monthly_limit"] is None
    assert response.json()["is_active"] is False


async def test_supervisor_can_read_but_not_change_configuration(
    client: AsyncClient, supervisor: User
) -> None:
    headers = auth(await login(client, supervisor.login))
    assert (await client.get("/api/v1/admin/config/shop-items", headers=headers)).status_code == 200
    assert (
        await client.put(
            "/api/v1/admin/config/rules", headers=headers, json={"points_per_coin": 10}
        )
    ).status_code == 403
