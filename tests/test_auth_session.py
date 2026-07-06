from __future__ import annotations

from app.core.config import get_settings

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
