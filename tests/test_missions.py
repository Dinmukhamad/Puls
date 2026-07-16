from __future__ import annotations

import re

from app.models import entities as m
from tests.conftest import make_operator_user


def _operator_client(db_session, make_client):
    operator, user, password = make_operator_user(db_session)
    client = make_client()
    response = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": password},
    )
    assert response.status_code == 200, response.text
    return client, operator, user


def _start(client, key: str = "mission-test-start-0001") -> dict:
    response = client.post(
        "/api/missions/login_first_time/start",
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _action(client, attempt_id: int, action_key: str, payload: dict | None = None) -> dict:
    response = client.post(
        f"/api/missions/attempts/{attempt_id}/actions",
        json={"action_key": action_key, "payload": payload or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _reach_completion(client, attempt: dict) -> dict:
    attempt_id = attempt["id"]
    result = _action(client, attempt_id, "begin")
    assert result["attempt"]["current_step"]["step_key"] == "choose_login"
    result = _action(client, attempt_id, "choose_phone_login")
    assert result["attempt"]["current_step"]["step_key"] == "enter_phone"
    result = _action(
        client,
        attempt_id,
        "submit_phone",
        {"phone_valid": True, "masked_phone": "+7 (***) ***-**-42"},
    )
    assert result["attempt"]["current_step"]["step_key"] == "enter_code"
    message = result["attempt"]["current_step"]["content"]["message"]
    code = re.search(r"\b\d{6}\b", message).group(0)
    result = _action(client, attempt_id, "submit_code", {"code": code})
    assert result["attempt"]["current_step"]["step_key"] == "inspect_profile"
    for target in ("name", "status", "park", "rating"):
        result = _action(client, attempt_id, "inspect_profile", {"target": target})
    assert result["attempt"]["current_step"]["step_key"] == "completion"
    return result["attempt"]


def _complete(client, attempt: dict) -> dict:
    ready = _reach_completion(client, attempt)
    result = _action(client, ready["id"], "complete")
    assert result["accepted"] is True
    assert result["attempt"]["status"] == "completed"
    return result["attempt"]


def test_mission_map_start_resume_and_refresh(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    mission_map = client.get("/api/missions")
    assert mission_map.status_code == 200
    data = mission_map.json()
    assert data["total"] == 4
    assert data["missions"][0]["code"] == "login_first_time"
    assert data["missions"][0]["action_label"] == "Начать"
    assert data["missions"][1]["code"] == "photo_control_basics"
    assert data["missions"][1]["status"] == "locked"
    assert data["missions"][2]["code"] == "smz_sapar_provider_transfer"
    assert data["missions"][2]["status"] == "available"
    assert data["missions"][3]["code"] == "smz_sign_previous_month_acts"
    assert data["missions"][3]["status"] == "locked"

    first = _start(client, "mission-resume-start-0001")
    resumed = _start(client, "mission-resume-start-0002")
    assert resumed["id"] == first["id"]
    _action(client, first["id"], "begin")

    refreshed = client.get(f"/api/missions/attempts/{first['id']}")
    assert refreshed.status_code == 200
    assert refreshed.json()["current_step"]["step_key"] == "choose_login"


def test_invalid_action_and_wrong_code_keep_current_step(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start(client, "mission-invalid-action-0001")
    result = _action(client, attempt["id"], "choose_profile_login")
    assert result["accepted"] is False
    assert result["attempt"]["current_step"]["step_key"] == "intro"

    _action(client, attempt["id"], "begin")
    _action(client, attempt["id"], "choose_phone_login")
    result = _action(
        client,
        attempt["id"],
        "submit_phone",
        {"phone_valid": True, "masked_phone": "+7 (***) ***-**-01"},
    )
    wrong = _action(client, attempt["id"], "submit_code", {"code": "000000"})
    assert wrong["accepted"] is False
    assert wrong["attempt"]["current_step"]["step_key"] == "enter_code"
    assert wrong["attempt"]["errors_count"] == 2
    assert "Учебный код" in result["attempt"]["current_step"]["content"]["message"]


def test_phone_and_code_are_not_stored_in_events(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start(client, "mission-private-data-0001")
    _action(client, attempt["id"], "begin")
    _action(client, attempt["id"], "choose_phone_login")
    result = _action(
        client,
        attempt["id"],
        "submit_phone",
        {"phone_valid": True, "masked_phone": "+7 (***) ***-**-73"},
    )
    code = re.search(
        r"\b\d{6}\b",
        result["attempt"]["current_step"]["content"]["message"],
    ).group(0)
    _action(client, attempt["id"], "submit_code", {"code": code})

    db_session.expire_all()
    events = db_session.query(m.MissionEvent).filter_by(attempt_id=attempt["id"]).all()
    serialized = " ".join(str(event.payload_json) for event in events)
    assert code not in serialized
    assert "70000000073" not in serialized
    assert "+7 (***) ***-**-73" in serialized
    stored_attempt = db_session.get(m.MissionAttempt, attempt["id"])
    assert stored_attempt.demo_code_hash != code
    assert len(stored_attempt.demo_code_hash) == 64


def test_foreign_attempt_is_not_accessible(db_session, make_client):
    owner, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start(owner, "mission-owner-attempt-0001")
    stranger, _other_operator, _other_user = _operator_client(db_session, make_client)
    response = stranger.get(f"/api/missions/attempts/{attempt['id']}")
    assert response.status_code == 404
    action = stranger.post(
        f"/api/missions/attempts/{attempt['id']}/actions",
        json={"action_key": "begin", "payload": {}},
    )
    assert action.status_code == 404


def test_completion_reward_is_idempotent_and_replay_has_no_reward(db_session, make_client):
    client, operator, _user = _operator_client(db_session, make_client)
    starting_balance = operator.current_balance
    first = _complete(client, _start(client, "mission-first-reward-0001"))
    assert first["reward_awarded"] is True

    repeated_complete = _action(client, first["id"], "complete")
    assert repeated_complete["attempt"]["reward_awarded"] is True

    db_session.expire_all()
    refreshed_operator = db_session.get(m.Operator, operator.id)
    assert refreshed_operator.current_balance == starting_balance + 50
    rewards = db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id,
        source_type="mission_reward",
    ).all()
    assert len(rewards) == 1
    assert rewards[0].source_id == first["id"]

    replay = _start(client, "mission-replay-start-0001")
    assert replay["id"] != first["id"]
    replay_result = _complete(client, replay)
    assert replay_result["reward_awarded"] is False
    assert "награда уже получена" in replay_result["reward_message"]
    db_session.expire_all()
    assert db_session.get(m.Operator, operator.id).current_balance == starting_balance + 50
    assert db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id,
        source_type="mission_reward",
    ).count() == 1


def test_wallet_failure_rolls_back_completion(db_session, make_client, monkeypatch):
    client, operator, _user = _operator_client(db_session, make_client)
    attempt = _reach_completion(client, _start(client, "mission-wallet-rollback-0001"))
    before = operator.current_balance

    def fail_transaction(*_args, **_kwargs):
        raise RuntimeError("wallet unavailable")

    monkeypatch.setattr("app.modules.missions.service.add_transaction", fail_transaction)
    response = client.post(
        f"/api/missions/attempts/{attempt['id']}/actions",
        json={"action_key": "complete", "payload": {}},
    )
    assert response.status_code == 500
    db_session.expire_all()
    stored = db_session.get(m.MissionAttempt, attempt["id"])
    progress = db_session.query(m.OperatorMissionProgress).filter_by(
        operator_id=operator.id,
        mission_id=stored.mission_id,
    ).one()
    assert stored.status == "in_progress"
    assert progress.status == "in_progress"
    assert db_session.get(m.Operator, operator.id).current_balance == before


def test_admin_mission_stats_and_operator_forbidden(db_session, make_client, client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    forbidden = operator_client.get("/api/admin/missions/stats")
    assert forbidden.status_code == 403

    stats = client.get("/api/admin/missions/stats")
    assert stats.status_code == 200
    assert "started_operators" in stats.json()
    attempts = client.get("/api/admin/missions/attempts?limit=10")
    assert attempts.status_code == 200
    assert "items" in attempts.json()


def test_start_requires_idempotency_key(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    response = client.post("/api/missions/login_first_time/start")
    assert response.status_code == 422
