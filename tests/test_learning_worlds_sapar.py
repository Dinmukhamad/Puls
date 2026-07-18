from __future__ import annotations

from app.models import entities as m
from app.modules.missions.world_service import is_day_allowed
from tests.test_missions import _action, _operator_client


def _start_sapar(client, key: str) -> dict:
    response = client.post(
        "/api/missions/smz_sapar_provider_transfer/start",
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _complete_sapar(client, attempt: dict) -> dict:
    attempt_id = attempt["id"]
    allowed = attempt["state"]["date_allowed"]
    actions = (
        ("begin", {}),
        ("answer_driver_status", {"is_self_employed": True}),
        ("answer_date_rule", {"allowed": allowed}),
        ("open_legal_docs", {"section": "legal_docs"}),
        ("open_edo", {"section": "edo"}),
        ("open_provider_list", {}),
        ("select_provider", {"provider_code": "sapar"}),
        ("view_terms", {}),
        ("confirm_consent", {"accepted": True}),
        ("finish_processing", {}),
        ("confirm_outcomes", {"next_month": True, "contract_and_tariff": True}),
    )
    result = None
    for action, payload in actions:
        result = _action(client, attempt_id, action, payload)
        assert result["accepted"] is True
    assert result["attempt"]["score"] == 100
    return _action(client, attempt_id, "complete")["attempt"]


def test_cross_month_and_normal_date_windows():
    assert is_day_allowed(15, 16, 1) is False
    assert is_day_allowed(16, 16, 1) is True
    assert is_day_allowed(31, 16, 1) is True
    assert is_day_allowed(1, 16, 1) is True
    assert is_day_allowed(2, 16, 1) is False
    assert is_day_allowed(10, 5, 12) is True
    assert is_day_allowed(4, 5, 12) is False
    assert is_day_allowed(13, 5, 12) is False


def test_world_map_and_routes(db_session, make_client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    response = operator_client.get("/api/missions/worlds")
    assert response.status_code == 200, response.text
    data = response.json()
    assert [row["code"] for row in data["worlds"]] == [
        "yandex_pro",
        "taxi_pro",
        "crm_requests",
        "self_employment_docs",
    ]
    yandex = operator_client.get("/api/missions/worlds/yandex_pro").json()
    assert [row["code"] for row in yandex["missions"]] == [
        "login_first_time",
        "photo_control_basics",
    ]
    smz = operator_client.get("/api/missions/worlds/self_employment_docs").json()
    assert smz["missions"][0]["code"] == "smz_sapar_provider_transfer"
    assert smz["missions"][0]["status"] == "available"


def test_sapar_happy_path_score_reward_and_idempotency(db_session, make_client):
    operator_client, operator, _user = _operator_client(db_session, make_client)
    before = operator.current_balance
    completed = _complete_sapar(
        operator_client,
        _start_sapar(operator_client, "sapar-happy-start-0001"),
    )
    assert completed["status"] == "completed"
    assert completed["reward_awarded"] is True
    repeated = _action(operator_client, completed["id"], "complete")
    assert repeated["accepted"] is True
    db_session.expire_all()
    assert db_session.get(m.Operator, operator.id).current_balance == before + 150
    rewards = db_session.query(m.CoinTransaction).filter_by(
        source_type="mission_reward", source_id=completed["id"]
    ).all()
    assert len(rewards) == 1


def test_sapar_errors_stay_on_step_and_reduce_score(db_session, make_client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start_sapar(operator_client, "sapar-errors-start-0001")
    _action(operator_client, attempt["id"], "begin")
    wrong = _action(
        operator_client,
        attempt["id"],
        "answer_driver_status",
        {"is_self_employed": False},
    )
    assert wrong["accepted"] is False
    assert wrong["attempt"]["current_step"]["step_key"] == "driver_status"
    assert wrong["attempt"]["state"]["driver_status_errors"] == 1
    right = _action(
        operator_client,
        attempt["id"],
        "answer_driver_status",
        {"is_self_employed": True},
    )
    wrong_date = _action(
        operator_client,
        attempt["id"],
        "answer_date_rule",
        {"allowed": not right["attempt"]["state"]["date_allowed"]},
    )
    assert wrong_date["accepted"] is False
    assert wrong_date["attempt"]["state"]["date_errors"] == 1


def test_admin_window_versions_preview_and_attempt_snapshot(client, db_session, make_client):
    mission = db_session.query(m.Mission).filter_by(code="smz_sapar_provider_transfer").one()
    preview = client.get(
        f"/api/admin/missions/{mission.id}/settings/provider-transfer-window/preview",
        params={"start_day": 16, "end_day": 1, "year": 2028, "month": 2},
    )
    assert preview.status_code == 200, preview.text
    days = {row["date"]: row["allowed"] for row in preview.json()["days"]}
    assert days["2028-02-01"] is True
    assert days["2028-02-02"] is False
    assert days["2028-02-16"] is True
    assert "2028-02-29" in days

    operator_client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start_sapar(operator_client, "sapar-snapshot-start-0001")
    old_version = attempt["state"]["setting_version"]
    updated = client.patch(
        f"/api/admin/missions/{mission.id}/settings/provider-transfer-window",
        json={
            "start_day": 10,
            "end_day": 20,
            "timezone": "Asia/Almaty",
            "operator_message": "Учебный период: с 10-го по 20-е число.",
            "is_active": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == old_version + 1
    resumed = operator_client.get(f"/api/missions/attempts/{attempt['id']}").json()
    assert resumed["state"]["setting_version"] == old_version
    assert resumed["state"]["provider_rule"]["start_day"] == 16


def test_admin_world_crud_and_role_protection(client, db_session, make_client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    forbidden = operator_client.post(
        "/api/admin/missions/worlds",
        json={"code": "operator_world", "title": "Нельзя создать"},
    )
    assert forbidden.status_code == 403

    created = client.post(
        "/api/admin/missions/worlds",
        json={
            "code": "future_training",
            "title": "Будущее обучение",
            "description": "Тест расширяемости карты",
            "accent_color": "#334455",
            "availability": "coming_soon",
            "sort_order": 99,
        },
    )
    assert created.status_code == 200, created.text
    world_id = created.json()["id"]
    patched = client.patch(
        f"/api/admin/missions/worlds/{world_id}",
        json={"title": "Будущие уроки", "availability": "hidden"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "Будущие уроки"
    assert patched.json()["availability"] == "hidden"
