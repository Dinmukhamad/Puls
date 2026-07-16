from __future__ import annotations

from app.models import entities as m
from tests.test_missions import _action, _complete, _operator_client, _start

CAR_SLOTS = (
    ("front", "car-front-v1"),
    ("left", "car-left-v1"),
    ("rear", "car-rear-v1"),
    ("right", "car-right-v1"),
    ("front_seats", "car-front-seats-v1"),
    ("rear_seats", "car-rear-seats-v1"),
    ("trunk", "car-trunk-v1"),
)


def _start_photo(client, key: str) -> dict:
    response = client.post(
        "/api/missions/photo_control_basics/start",
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _reach_car_grid(client, attempt: dict) -> dict:
    attempt_id = attempt["id"]
    _action(client, attempt_id, "begin")
    _action(client, attempt_id, "open_photo_control")
    _action(client, attempt_id, "select_check", {"check_type": "car"})
    result = _action(client, attempt_id, "view_instruction")
    assert result["attempt"]["current_step"]["step_key"] == "car_slot_front"
    return result["attempt"]


def _complete_photo(client, attempt: dict) -> dict:
    attempt = _reach_car_grid(client, attempt)
    attempt_id = attempt["id"]
    for slot, asset in CAR_SLOTS:
        result = _action(
            client,
            attempt_id,
            "confirm_car_slot",
            {"slot_key": slot, "asset_id": asset},
        )
        assert result["accepted"] is True
    _action(client, attempt_id, "submit_car_check")
    _action(client, attempt_id, "select_check", {"check_type": "driver_license"})
    _action(client, attempt_id, "confirm_license_side", {"side": "front"})
    _action(client, attempt_id, "confirm_license_side", {"side": "back"})
    _action(client, attempt_id, "submit_license_check")
    scored = _action(
        client,
        attempt_id,
        "confirm_final_statuses",
        {"car": True, "driver_license": True},
    )["attempt"]
    assert scored["score"] == 100
    completed = _action(client, attempt_id, "complete")
    assert completed["accepted"] is True
    return completed["attempt"]


def test_photo_mission_unlocks_after_first_mission(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    locked = client.get("/api/missions").json()["missions"][1]
    assert locked["status"] == "locked"
    blocked = client.post(
        "/api/missions/photo_control_basics/start",
        headers={"Idempotency-Key": "photo-locked-start-0001"},
    )
    assert blocked.status_code == 409

    _complete(client, _start(client, "photo-prerequisite-0001"))
    available = client.get("/api/missions").json()["missions"][1]
    assert available["status"] == "available"


def test_photo_slots_allowlist_incomplete_submit_and_action_idempotency(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    _complete(client, _start(client, "photo-validation-prerequisite"))
    attempt = _reach_car_grid(client, _start_photo(client, "photo-validation-start"))
    attempt_id = attempt["id"]

    bad = _action(
        client,
        attempt_id,
        "confirm_car_slot",
        {"slot_key": "front", "asset_id": "external-or-forged"},
    )
    assert bad["accepted"] is False
    assert bad["attempt"]["state"]["car_slots"] == {}

    response = client.post(
        f"/api/missions/attempts/{attempt_id}/actions",
        headers={"Idempotency-Key": "photo-incomplete-repeat-0001"},
        json={"action_key": "submit_car_check", "payload": {}},
    )
    assert response.status_code == 200
    assert response.json()["accepted"] is False
    errors = response.json()["attempt"]["errors_count"]
    repeated = client.post(
        f"/api/missions/attempts/{attempt_id}/actions",
        headers={"Idempotency-Key": "photo-incomplete-repeat-0001"},
        json={"action_key": "submit_car_check", "payload": {}},
    )
    assert repeated.status_code == 200
    assert repeated.json()["attempt"]["errors_count"] == errors


def test_photo_completion_score_reward_and_safe_state(db_session, make_client):
    client, operator, _user = _operator_client(db_session, make_client)
    _complete(client, _start(client, "photo-reward-prerequisite"))
    before = db_session.get(m.Operator, operator.id).current_balance
    completed = _complete_photo(client, _start_photo(client, "photo-reward-start"))
    assert completed["status"] == "completed"
    assert completed["score"] == 100
    assert completed["reward_awarded"] is True
    assert set(completed["state"]["car_slots"]) == {slot for slot, _ in CAR_SLOTS}
    assert set(completed["state"]["license_slots"]) == {"front", "back"}

    db_session.expire_all()
    assert db_session.get(m.Operator, operator.id).current_balance == before + 75
    mission = db_session.query(m.Mission).filter_by(code="photo_control_basics").one()
    rewards = (
        db_session.query(m.CoinTransaction)
        .join(m.MissionAttempt, m.CoinTransaction.source_id == m.MissionAttempt.id)
        .filter(
            m.CoinTransaction.source_type == "mission_reward",
            m.MissionAttempt.mission_id == mission.id,
        )
        .all()
    )
    assert len(rewards) == 1
    serialized = str(completed["state"])
    assert "http" not in serialized
    assert "data:" not in serialized


def test_photo_attempt_cannot_be_read_by_another_operator(db_session, make_client):
    owner, _operator, _user = _operator_client(db_session, make_client)
    _complete(owner, _start(owner, "photo-owner-prerequisite"))
    attempt = _start_photo(owner, "photo-owner-start")
    stranger, _other_operator, _other_user = _operator_client(db_session, make_client)
    assert stranger.get(f"/api/missions/attempts/{attempt['id']}").status_code == 404
