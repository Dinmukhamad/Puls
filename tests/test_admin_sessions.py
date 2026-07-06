from __future__ import annotations

ADMIN_CREDENTIALS = {"username": "admin", "password": "TestAdmin123!"}


def test_admin_can_list_sessions(client):
    r = client.get("/api/admin/sessions")

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["stats"]["active"] >= 1
    assert any(item["username"] == "admin" for item in data["items"])


def test_admin_can_revoke_another_session(client, make_client):
    other = make_client()
    login = other.post(
        "/api/auth/login",
        json=ADMIN_CREDENTIALS,
        headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/126"},
    )
    assert login.status_code == 200, login.text

    sessions = client.get("/api/admin/sessions?status=active").json()["items"]
    target = next(item for item in sessions if item["username"] == "admin" and not item["is_current"])

    revoked = client.post(f"/api/admin/sessions/{target['session_id']}/revoke")
    assert revoked.status_code == 200, revoked.text

    me = other.get("/api/auth/me")
    assert me.status_code == 401
