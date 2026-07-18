from __future__ import annotations

from app.core.config import get_settings
from tests.conftest import make_operator_user

ADMIN_CREDENTIALS = {"username": "admin", "password": "TestAdmin123!"}


def _set_cookie_header(response) -> str:
    return response.headers.get("set-cookie", "")


def test_login_cookie_lasts_30_days(make_client):
    c = make_client()
    r = c.post("/api/auth/login", json=ADMIN_CREDENTIALS)

    assert r.status_code == 200, r.text
    assert f"Max-Age={30 * 24 * 60 * 60}" in _set_cookie_header(r)
    assert f"Max-Age={get_settings().access_token_expire_minutes * 60}" in _set_cookie_header(r)


def test_me_extends_auth_cookie(make_client):
    c = make_client()
    login = c.post("/api/auth/login", json=ADMIN_CREDENTIALS)
    assert login.status_code == 200, login.text

    r = c.get("/api/auth/me")

    assert r.status_code == 200, r.text
    assert f"Max-Age={30 * 24 * 60 * 60}" in _set_cookie_header(r)


def test_password_change_revokes_session_and_old_token(db_session, make_client):
    from app.models.entities import UserSession

    _, user, password = make_operator_user(db_session)
    client = make_client()
    login = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": password},
    )
    assert login.status_code == 200, login.text
    old_token = client.cookies.get(get_settings().auth_cookie_name)
    assert old_token

    changed = client.patch(
        "/api/auth/me/password",
        json={
            "current_password": password,
            "new_password": "NewOperatorPass123!",
            "confirm_password": "NewOperatorPass123!",
        },
    )
    assert changed.status_code == 200, changed.text
    assert "Max-Age=0" in _set_cookie_header(changed)

    old_session_request = make_client().get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert old_session_request.status_code == 401, old_session_request.text

    db_session.expire_all()
    sessions = db_session.query(UserSession).filter(UserSession.user_id == user.id).all()
    assert sessions
    assert all(session.status == "revoked" for session in sessions)

    new_login = make_client().post(
        "/api/auth/login",
        json={"username": user.username, "password": "NewOperatorPass123!"},
    )
    assert new_login.status_code == 200, new_login.text


def test_account_password_change_also_revokes_session(db_session, make_client):
    _, user, password = make_operator_user(db_session)
    client = make_client()
    login = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": password},
    )
    assert login.status_code == 200, login.text
    old_token = client.cookies.get(get_settings().auth_cookie_name)

    changed = client.post(
        "/api/auth/account",
        json={
            "current_password": password,
            "new_password": "AccountNewPass123!",
            "repeat_password": "AccountNewPass123!",
        },
    )
    assert changed.status_code == 200, changed.text
    assert "Max-Age=0" in _set_cookie_header(changed)

    old_session_request = make_client().get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert old_session_request.status_code == 401, old_session_request.text


def test_auth_cookie_deletion_preserves_configured_domain():
    from fastapi import Response

    from app.modules.auth.router import _delete_auth_cookie

    settings = get_settings()
    previous_domain = settings.auth_cookie_domain
    try:
        settings.auth_cookie_domain = "example.com"
        response = Response()
        _delete_auth_cookie(response)
    finally:
        settings.auth_cookie_domain = previous_domain

    cookie_header = _set_cookie_header(response)
    assert "Domain=example.com" in cookie_header
    assert "Max-Age=0" in cookie_header
