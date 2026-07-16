from __future__ import annotations

import re

from app.models import entities as m
from tests.test_learning_worlds_sapar import _complete_sapar, _start_sapar
from tests.test_missions import _action, _operator_client

MISSION_CODE = "smz_sign_previous_month_acts"


def _start_signing(client, key: str) -> dict:
    response = client.post(
        f"/api/missions/{MISSION_CODE}/start",
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _unlock_signing(client, key: str) -> None:
    _complete_sapar(client, _start_sapar(client, key))


def _code_from_attempt(attempt: dict) -> str:
    values = re.findall(r"\b\d{4}\b", attempt["current_step"]["content"]["message"])
    assert values
    return values[-1]


def _reach_signed_unsaved(client, attempt: dict) -> dict:
    attempt_id = attempt["id"]
    state = attempt["state"]
    target = state["target_period"]
    actions = (
        ("begin", {}),
        ("answer_date_eligibility", {"allowed": state["date_allowed"]}),
        ("answer_target_period", {"year": target["year"], "month": target["month"]}),
        ("start_egov_signature", {"purpose": "auth"}),
    )
    result = None
    for action, payload in actions:
        result = _action(client, attempt_id, action, payload)
        assert result["accepted"] is True
    auth_code = _code_from_attempt(result["attempt"])
    for action, payload in (
        ("submit_training_code", {"purpose": "auth", "code": auth_code}),
        ("approve_signature", {"purpose": "auth"}),
        ("return_to_sapar", {"purpose": "auth"}),
        ("enter_sapar", {}),
        ("open_target_avr", {}),
        ("open_avr_package", {}),
        ("start_egov_signature", {"purpose": "documents"}),
    ):
        result = _action(client, attempt_id, action, payload)
        assert result["accepted"] is True
    docs_code = _code_from_attempt(result["attempt"])
    for action, payload in (
        ("submit_training_code", {"purpose": "documents", "code": docs_code}),
        ("approve_signature", {"purpose": "documents"}),
        ("return_to_sapar", {"purpose": "documents"}),
    ):
        result = _action(client, attempt_id, action, payload)
        assert result["accepted"] is True
    return result["attempt"]


def test_document_signing_is_second_locked_world_mission(db_session, make_client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    world = operator_client.get("/api/missions/worlds/self_employment_docs")
    assert world.status_code == 200, world.text
    missions = world.json()["missions"]
    assert [row["code"] for row in missions] == [
        "smz_sapar_provider_transfer",
        MISSION_CODE,
    ]
    assert missions[1]["status"] == "locked"
    blocked = operator_client.post(
        f"/api/missions/{MISSION_CODE}/start",
        headers={"Idempotency-Key": "signing-blocked-start"},
    )
    assert blocked.status_code == 409


def test_document_signing_preview_dates_periods_and_exception(client, db_session):
    mission = db_session.query(m.Mission).filter_by(code=MISSION_CODE).one()
    base = client.get(
        f"/api/admin/missions/{mission.id}/settings/document-signing-window/preview",
        params={"year": 2027, "month": 1, "start_day": 5, "end_day": 15},
    )
    assert base.status_code == 200, base.text
    payload = base.json()
    assert payload["target_period"] == {
        "year": 2026,
        "month": 12,
        "label": "за декабрь 2026",
    }
    days = {row["date"]: row["allowed"] for row in payload["days"]}
    assert days["2027-01-04"] is False
    assert days["2027-01-05"] is True
    assert days["2027-01-15"] is True
    assert days["2027-01-16"] is False

    extended = client.get(
        f"/api/admin/missions/{mission.id}/settings/document-signing-window/preview",
        params={
            "year": 2027,
            "month": 1,
            "start_day": 5,
            "end_day": 15,
            "exception_end_day": 25,
            "exception_year_month": "2027-01",
        },
    ).json()
    assert extended["effective_end_day"] == 25
    assert extended["effective_end_date"] == "2027-01-25"
    assert {row["date"]: row["allowed"] for row in extended["days"]}["2027-01-25"] is True

    current = (
        db_session.query(m.MissionSetting)
        .filter_by(
            mission_id=mission.id,
            key="document_signing_window",
            is_active=True,
        )
        .one()
    )
    updated = client.patch(
        f"/api/admin/missions/{mission.id}/settings/document-signing-window",
        json={
            "start_day": 5,
            "end_day": 15,
            "timezone": "Asia/Almaty",
            "exception_end_day": 25,
            "exception_year_month": "2027-01",
            "operator_message": "В январе срок продлён до 25-го включительно.",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == current.version + 1


def test_document_signing_two_sessions_unsaved_restore_score_and_reward(
    db_session, make_client
):
    operator_client, operator, _user = _operator_client(db_session, make_client)
    _unlock_signing(operator_client, "signing-prerequisite-happy")
    before = operator.current_balance
    attempt = _start_signing(operator_client, "signing-happy-start")
    unsaved = _reach_signed_unsaved(operator_client, attempt)
    assert unsaved["current_step"]["step_key"] == "save_documents"
    assert unsaved["state"]["auth_signature_state"] == "approved"
    assert unsaved["state"]["docs_signature_state"] == "approved"
    assert unsaved["state"]["save_state"] == "not_saved"
    assert unsaved["state"]["challenge_ids"]["auth"] != unsaved["state"]["challenge_ids"]["documents"]

    restored = operator_client.get(f"/api/missions/attempts/{attempt['id']}")
    assert restored.status_code == 200
    assert restored.json()["state"]["save_state"] == "not_saved"

    saved = _action(operator_client, attempt["id"], "save_signed_documents")
    assert saved["accepted"] is True
    assert saved["attempt"]["score"] == 100
    completed = _action(operator_client, attempt["id"], "complete")["attempt"]
    assert completed["status"] == "completed"
    assert completed["reward_awarded"] is True

    db_session.expire_all()
    assert db_session.get(m.Operator, operator.id).current_balance == before + 120
    rewards = db_session.query(m.CoinTransaction).filter_by(
        source_type="mission_reward", source_id=attempt["id"]
    ).all()
    assert len(rewards) == 1


def test_document_signing_decline_retry_and_wrong_code_penalty(db_session, make_client):
    operator_client, _operator, _user = _operator_client(db_session, make_client)
    _unlock_signing(operator_client, "signing-prerequisite-errors")
    attempt = _start_signing(operator_client, "signing-errors-start")
    state = attempt["state"]
    target = state["target_period"]
    for action, payload in (
        ("begin", {}),
        ("answer_date_eligibility", {"allowed": state["date_allowed"]}),
        ("answer_target_period", {"year": target["year"], "month": target["month"]}),
        ("start_egov_signature", {"purpose": "auth"}),
    ):
        result = _action(operator_client, attempt["id"], action, payload)
        assert result["accepted"] is True
    for _ in range(2):
        wrong = _action(
            operator_client,
            attempt["id"],
            "submit_training_code",
            {"purpose": "auth", "code": "9999"},
        )
        assert wrong["accepted"] is False
    code = _code_from_attempt(wrong["attempt"])
    verified = _action(
        operator_client,
        attempt["id"],
        "submit_training_code",
        {"purpose": "auth", "code": code},
    )
    declined = _action(
        operator_client,
        attempt["id"],
        "decline_signature",
        {"purpose": "auth"},
    )
    assert verified["accepted"] is True
    assert declined["accepted"] is False
    assert declined["attempt"]["current_step"]["step_key"] == "egov_auth_sign"
    approved = _action(
        operator_client,
        attempt["id"],
        "approve_signature",
        {"purpose": "auth"},
    )
    assert approved["accepted"] is True
