from __future__ import annotations

ADMIN_CREDENTIALS = {"username": "admin", "password": "TestAdmin123!"}

_PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
_MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E Safari/604"


def test_admin_can_list_sessions(client):
    r = client.get("/api/admin/sessions")

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["stats"]["active"] >= 1
    assert any(item["username"] == "admin" for item in data["items"])


def test_stats_include_role_and_device_breakdown(client):
    """Для фильтров-вкладок бэкенд должен отдавать разбивку по ролям и
    типу устройства (счётчики Все/ПК/Телефон)."""
    data = client.get("/api/admin/sessions?status=active").json()
    stats = data["stats"]
    assert "by_role" in stats
    assert set(stats["by_role"]) == {"admin", "supervisor", "operator"}
    assert stats["by_role"]["admin"] >= 1  # админ-фикстура залогинена
    assert "by_device" in stats
    assert set(stats["by_device"]) == {"pc", "mobile"}
    assert "total_users" in stats


def test_role_filter_returns_only_that_role(client, make_client):
    # заводим супервайзера с активной сессией
    from app.database.db import SessionLocal
    from tests.test_coin_rules_and_group_scope import _make_role_user
    db = SessionLocal()
    try:
        sup, pwd = _make_role_user(db, role="supervisor")
        sup_username = sup.username
    finally:
        db.close()
    sup_client = make_client()
    assert sup_client.post("/api/auth/login", json={"username": sup_username, "password": pwd}).status_code == 200

    r = client.get("/api/admin/sessions?status=active&role=supervisor")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, "ожидали хотя бы одну сессию супервайзера"
    assert all(i["role"] == "supervisor" for i in items)
    assert any(i["username"] == sup_username for i in items)


def test_device_filter_pc_vs_mobile(client, make_client):
    # одна сессия админа с мобильным UA, одна — с ПК
    pc_client = make_client()
    assert pc_client.post("/api/auth/login", json=ADMIN_CREDENTIALS, headers={"user-agent": _PC_UA}).status_code == 200
    mobile_client = make_client()
    assert mobile_client.post("/api/auth/login", json=ADMIN_CREDENTIALS, headers={"user-agent": _MOBILE_UA}).status_code == 200

    pc_items = client.get("/api/admin/sessions?status=active&device=pc").json()["items"]
    assert pc_items, "ожидали хотя бы одну ПК-сессию"
    assert all("mobile" not in (i.get("device_label") or "").lower() for i in pc_items)

    mobile_items = client.get("/api/admin/sessions?status=active&device=mobile").json()["items"]
    assert mobile_items, "ожидали хотя бы одну мобильную сессию"
    assert all(
        any(m in f"{i.get('device_label','')} {i.get('os_label','')}".lower() for m in ("mobile", "iphone", "ios"))
        for i in mobile_items
    )


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
