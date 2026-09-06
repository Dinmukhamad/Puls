"""Регрессии Puls 2: отсутствие данных, импорт, границы доступа и отзыв сессий."""

from datetime import date
from io import BytesIO

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select

from app.core.security import decode_token
from app.models.contest import OperatorWeekMetric
from app.models.enums import MetricDirection, Role
from app.services import weekly
from app.services.scoring import score_week
from tests.conftest import auth, login, make_group, make_user
from tests.test_scoring import positive


def test_unreported_lower_metric_does_not_reward_zero():
    definition = positive("aht", 300, 20)
    definition.direction = MetricDirection.LOWER_IS_BETTER
    missing = score_week([definition], {})
    actual_zero = score_week([definition], {"aht": 0})
    assert missing.final_points == 0
    assert missing.metrics[0].value is None
    assert missing.metrics[0].completion is None
    assert actual_zero.final_points == 20
    assert actual_zero.metrics[0].value == 0


async def tokens(client, name="op1", password="password123"):
    response = await client.post(
        "/api/v1/auth/login", data={"username": name, "password": password}
    )
    assert response.status_code == 200
    return response.json()


async def test_revoked_session_rejects_access_and_refresh(client, operator, developer):
    first = await tokens(client)
    second = await tokens(client)
    owner = auth(await login(client, developer.login))
    sessions = (await client.get("/api/v1/admin/sessions", headers=owner)).json()
    other = next(
        item
        for item in sessions
        if item["id"] == decode_token(second["access_token"], "access")["sid"]
    )
    assert "refresh_hash" not in other
    response = await client.post(f"/api/v1/admin/sessions/{other['id']}/revoke", headers=owner)
    assert response.status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers=auth(second["access_token"]))
    ).status_code == 401
    assert (
        await client.post("/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]})
    ).status_code == 401
    assert (
        await client.get("/api/v1/auth/me", headers=auth(first["access_token"]))
    ).status_code == 200


async def test_refresh_rotates_and_old_refresh_cannot_be_replayed(client, operator):
    original = await tokens(client)
    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": original["refresh_token"]}
    )
    assert response.status_code == 200
    refreshed = response.json()
    assert refreshed["refresh_token"] != original["refresh_token"]
    assert (
        await client.post("/api/v1/auth/refresh", json={"refresh_token": original["refresh_token"]})
    ).status_code == 401
    assert (
        await client.get("/api/v1/auth/me", headers=auth(refreshed["access_token"]))
    ).status_code == 200


async def test_password_change_keeps_current_and_revokes_others(client, operator):
    current, other = await tokens(client), await tokens(client)
    response = await client.post(
        "/api/v1/auth/password",
        headers=auth(current["access_token"]),
        json={
            "current_password": "password123",
            "password": "replacement123",
        },
    )
    assert response.status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers=auth(other["access_token"]))
    ).status_code == 401
    assert (
        await client.get("/api/v1/auth/me", headers=auth(current["access_token"]))
    ).status_code == 200


async def test_cannot_revoke_another_users_session(client, session, operator):
    mine = await tokens(client)
    await make_user(session, login="stranger")
    stranger = await tokens(client, "stranger")
    session_id = decode_token(stranger["access_token"], "access")["sid"]
    assert (
        await client.post(
            f"/api/v1/me/sessions/{session_id}/revoke", headers=auth(mine["access_token"])
        )
    ).status_code == 403


@pytest.mark.parametrize("extension", ["csv", "xlsx"])
async def test_file_preview_apply_calculate_publish_is_idempotent(
    client, session, operator, head, extension
):
    headers = auth(await login(client, head.login))
    week = await weekly.get_or_create_week(session, date(2026, 8, 3))
    await session.commit()
    if extension == "csv":
        content = b"login,quality,hours_worked\nop1,98,40\n"
    else:
        workbook = Workbook()
        workbook.active.append(["login", "quality", "hours_worked"])
        workbook.active.append(["op1", 98, 40])
        stream = BytesIO()
        workbook.save(stream)
        content = stream.getvalue()
        workbook.close()
    root = f"/api/v1/admin/weeks/{week.id}"
    response = await client.post(
        f"{root}/import/preview", headers=headers, files={"file": (f"metrics.{extension}", content)}
    )
    assert response.status_code == 200
    preview = response.json()
    assert preview["can_apply"] is True
    assert preview["operator_count"] == 1
    assert await session.scalar(select(func.count(OperatorWeekMetric.id))) == 0
    assert (
        await client.post(f"{root}/metrics", headers=headers, json={"values": preview["values"]})
    ).status_code == 200
    calculated = await client.post(f"{root}/recalculate", headers=headers)
    assert calculated.status_code == 200
    assert calculated.json()["participants"] == 1
    assert calculated.json()["rows"][0]["missing_metrics"]
    first = await client.post(f"{root}/close", headers=headers)
    second = await client.post(f"{root}/close", headers=headers)
    assert first.status_code == second.status_code == 200
    assert second.json()["already_closed"] is True
    assert (
        await client.post(f"{root}/metrics", headers=headers, json={"values": preview["values"]})
    ).status_code == 409


async def test_supervisor_replace_preserves_other_group(client, session, operator, supervisor):
    foreign_group = await make_group(session, code="other")
    foreign = await make_user(session, login="other", group_id=foreign_group.id)
    week = await weekly.get_or_create_week(session, date(2026, 8, 3))
    session.add(
        OperatorWeekMetric(week_id=week.id, user_id=foreign.id, metric_code="quality", value=99)
    )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    root = f"/api/v1/admin/weeks/{week.id}"
    denied = await client.post(
        f"{root}/metrics",
        headers=headers,
        json={
            "replace": True,
            "values": [{"user_id": foreign.id, "metric_code": "quality", "value": 0}],
        },
    )
    assert denied.status_code == 403
    allowed = await client.post(
        f"{root}/metrics",
        headers=headers,
        json={
            "replace": True,
            "values": [{"user_id": operator.id, "metric_code": "quality", "value": 95}],
        },
    )
    assert allowed.status_code == 200
    assert (
        await session.scalar(
            select(OperatorWeekMetric.value).where(OperatorWeekMetric.user_id == foreign.id)
        )
        == 99
    )
    assert (await client.post(f"{root}/recalculate", headers=headers)).status_code == 403


async def test_bad_file_preview_does_not_write(client, session, operator, head):
    week = await weekly.get_or_create_week(session, date(2026, 8, 3))
    await session.commit()
    headers = auth(await login(client, head.login))
    response = await client.post(
        f"/api/v1/admin/weeks/{week.id}/import/preview",
        headers=headers,
        files={"file": ("bad.csv", b"login,quality\nop1,not-a-number\nunknown,90\n")},
    )
    assert response.status_code == 200
    assert response.json()["can_apply"] is False
    assert len(response.json()["errors"]) == 2
    assert await session.scalar(select(func.count(OperatorWeekMetric.id))) == 0


async def test_head_cannot_edit_admin_and_supervisor_cannot_read_foreign_user(
    client, session, operator, head, supervisor
):
    admin = await make_user(session, login="administrator", role=Role.ADMIN)
    headers = auth(await login(client, head.login))
    assert (
        await client.patch(
            f"/api/v1/admin/users/{admin.id}", headers=headers, json={"full_name": "Changed"}
        )
    ).status_code == 403
    headers = auth(await login(client, supervisor.login))
    assert (await client.get(f"/api/v1/admin/users/{admin.id}", headers=headers)).status_code == 404
    detail = await client.get(f"/api/v1/admin/users/{operator.id}/dashboard", headers=headers)
    assert detail.status_code == 200
    assert (await client.get("/api/v1/admin/audit", headers=headers)).status_code == 403
