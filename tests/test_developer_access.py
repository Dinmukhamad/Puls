import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_token
from app.models.enums import Role
from app.models.session import LoginSession
from app.models.user import User
from tests.conftest import auth, login, make_user
from tests.test_access import change


@pytest.mark.parametrize("role", list(Role))
async def test_only_developer_can_inspect_or_revoke_sessions(client, session, developer, role):
    user = await make_user(session, login="regular", role=role)
    token = await login(client, user.login)
    headers = auth(token)
    sid = decode_token(token, "access")["sid"]
    data = (await client.get("/api/v1/me/access", headers=headers)).json()
    assert data["capabilities"]["manage_sessions"] is False
    for method, path in [
        ("GET", "/me/sessions"),
        ("GET", "/admin/sessions"),
        ("POST", "/me/sessions/revoke-others"),
        ("POST", f"/me/sessions/{sid}/revoke"),
        ("POST", f"/admin/sessions/{sid}/revoke"),
    ]:
        result = await client.request(method, f"/api/v1{path}", headers=headers)
        assert result.status_code == 403, (path, result.text)
        assert result.json()["code"] == (
            "role_required" if role == Role.TRAINER else "developer_required"
        )
    assert (await session.get(LoginSession, sid)).revoked_at is None
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 200


async def test_session_privilege_cannot_be_assigned_with_roles_or_rules(client, session, developer):
    admin = await make_user(session, login="regular-admin", role=Role.ADMIN)
    headers = auth(await login(client, admin.login))
    assert (
        await change(client, headers, changes=[{"section": "system", "effect": "allow"}])
    ).status_code == 200
    assert (await client.get("/api/v1/admin/audit", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/admin/sessions", headers=headers)).status_code == 403
    assert (
        await change(client, headers, changes=[{"section": "manage_sessions", "effect": "allow"}])
    ).status_code == 400
    await client.patch(
        f"/api/v1/admin/users/{admin.id}", headers=headers, json={"is_developer": True}
    )
    profile = (await client.get("/api/v1/auth/me", headers=headers)).json()
    assert profile["is_developer"] is False
    assert (await client.get("/api/v1/admin/sessions", headers=headers)).status_code == 403


async def test_developer_account_cannot_be_taken_over_or_disabled_by_an_admin(
    client, session, developer
):
    admin = await make_user(session, login="business-admin", role=Role.ADMIN)
    headers = auth(await login(client, admin.login))
    for values in ({"role": "operator"}, {"is_active": False}, {"full_name": "Changed"}):
        result = await client.patch(
            f"/api/v1/admin/users/{developer.id}", headers=headers, json=values
        )
        assert result.status_code == 403
        assert result.json()["code"] == "developer_required"
    result = await client.post(
        f"/api/v1/admin/users/{developer.id}/password",
        headers=headers,
        json={"password": "replacement123"},
    )
    assert result.status_code == 403
    # Knowing the reserved login cannot create another developer account either.
    result = await client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "login": settings.DEVELOPER_LOGIN,
            "full_name": "New owner",
            "role": "admin",
            "password": "replacement123",
        },
    )
    assert result.status_code == 403
    assert await session.scalar(select(User.is_active).where(User.id == developer.id)) is True
    await login(client, developer.login)


async def test_developer_can_manage_all_sessions_even_when_system_section_is_denied(
    client, session, developer, operator
):
    current = await login(client, developer.login)
    other = await login(client, developer.login)
    employee = await login(client, operator.login)
    headers = auth(current)
    assert (
        await change(client, headers, changes=[{"section": "system", "effect": "deny"}])
    ).status_code == 200
    permissions = (await client.get("/api/v1/me/access", headers=headers)).json()
    assert permissions["capabilities"]["manage_sessions"] is True
    assert permissions["allowed"]["system"] is False
    own = (await client.get("/api/v1/me/sessions", headers=headers)).json()
    assert len(own) == 2 and all(row["user_id"] == developer.id for row in own)
    all_sessions = (await client.get("/api/v1/admin/sessions", headers=headers)).json()
    assert len(all_sessions) == 3
    assert all("refresh_hash" not in row for row in all_sessions)
    sid = decode_token(employee, "access")["sid"]
    # Legacy own-only URL retains its ownership boundary for the developer.
    assert (
        await client.post(f"/api/v1/me/sessions/{sid}/revoke", headers=headers)
    ).status_code == 404
    assert (
        await client.post("/api/v1/me/sessions/revoke-others", headers=headers)
    ).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=auth(other))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth(employee))).status_code == 200
    assert (
        await client.post(f"/api/v1/admin/sessions/{sid}/revoke", headers=headers)
    ).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=auth(employee))).status_code == 401


async def test_server_configuration_controls_developer_identity(client, session, monkeypatch):
    user = await make_user(session, login="candidate", role=Role.ADMIN)
    headers = auth(await login(client, user.login))
    monkeypatch.setattr(settings, "DEVELOPER_LOGIN", "candidate")
    assert (await client.get("/api/v1/admin/sessions", headers=headers)).status_code == 200
    monkeypatch.setattr(settings, "DEVELOPER_LOGIN", "")
    assert (await client.get("/api/v1/admin/sessions", headers=headers)).status_code == 403
    assert (await client.get("/api/v1/me/access", headers=headers)).json()["capabilities"][
        "manage_sessions"
    ] is False
