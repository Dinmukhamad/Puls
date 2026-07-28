from __future__ import annotations

from tests.test_coin_rules_and_group_scope import _login, _make_role_user


def test_manager_cannot_call_delete_endpoints(db_session, make_client):
    manager, password = _make_role_user(db_session, role="manager")
    manager_client = _login(make_client, manager.username, password)

    endpoints = (
        "/api/groups/999999",
        "/api/operators/999999",
        "/api/work-norms/999999",
        "/api/admin/operator-levels/999999",
        "/api/admin/operator-level-rules/999999",
        "/api/admin/tests/questions/999999",
    )
    for endpoint in endpoints:
        response = manager_client.delete(endpoint)
        assert response.status_code == 403, (endpoint, response.text)


def test_manager_cannot_disable_level_through_patch(db_session, make_client, client):
    manager, password = _make_role_user(db_session, role="manager")
    manager_client = _login(make_client, manager.username, password)
    level = client.get("/api/admin/operator-levels").json()[0]

    response = manager_client.patch(
        f"/api/admin/operator-levels/{level['id']}",
        json={"is_active": not level["is_active"]},
    )

    assert response.status_code == 403, response.text
    assert "только администратор" in response.json()["detail"]


def test_administrator_can_delete_empty_group(client):
    created = client.post(
        "/api/groups",
        json={"name": "Временная группа для проверки удаления", "status": "active"},
    )
    assert created.status_code == 200, created.text

    deleted = client.delete(f"/api/groups/{created.json()['id']}")

    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"ok": True}
