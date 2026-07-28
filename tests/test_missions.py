from __future__ import annotations

import re
from datetime import timedelta

from app.core.datetime_utils import now_utc
from app.models import entities as m
from app.modules.missions.service import close_stale_attempts
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
    counter = getattr(_action, "counter", 0) + 1
    _action.counter = counter
    response = client.post(
        f"/api/missions/attempts/{attempt_id}/actions",
        headers={"Idempotency-Key": f"mission-action-{attempt_id}-{counter}"},
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
    assert data["missions"][0]["can_start"] is True
    assert data["missions"][0]["can_replay"] is False
    assert data["missions"][0]["active_attempt_id"] is None
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
        headers={"Idempotency-Key": "mission-foreign-action-0001"},
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
    assert refreshed_operator.current_balance == starting_balance + 100
    rewards = db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id,
        source_type="mission_reward",
    ).all()
    assert len(rewards) == 1
    assert rewards[0].source_id == first["id"]
    grants = db_session.query(m.MissionRewardGrant).filter_by(
        operator_id=operator.id,
    ).all()
    assert len(grants) == 1
    assert grants[0].attempt_id == first["id"]

    replay = _start(client, "mission-replay-start-0001")
    assert replay["id"] != first["id"]
    assert replay["attempt_number"] == first["attempt_number"] + 1
    assert replay["reward_eligible"] is False
    assert replay["replay_of_attempt_id"] == first["id"]
    replay_result = _complete(client, replay)
    assert replay_result["reward_awarded"] is False
    assert "награда уже получена" in replay_result["reward_message"]
    db_session.expire_all()
    assert db_session.get(m.Operator, operator.id).current_balance == starting_balance + 100
    assert db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id,
        source_type="mission_reward",
    ).count() == 1
    assert db_session.query(m.MissionRewardGrant).filter_by(
        operator_id=operator.id,
    ).count() == 1

    card = next(
        row
        for row in client.get("/api/missions").json()["missions"]
        if row["code"] == "login_first_time"
    )
    assert card["status"] == "completed"
    assert card["can_replay"] is True
    assert card["completed_attempts_count"] == 2
    assert card["reward_state"] == "claimed"


def test_hint_is_idempotent_and_active_time_caps_idle_gap(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start(client, "mission-hint-idempotent-start")
    stored = db_session.get(m.MissionAttempt, attempt["id"])
    stored.last_activity_at = now_utc() - timedelta(hours=2)
    db_session.commit()

    headers = {"Idempotency-Key": "mission-hint-same-logical-key"}
    first = client.post(
        f"/api/missions/attempts/{attempt['id']}/hint",
        headers=headers,
    )
    second = client.post(
        f"/api/missions/attempts/{attempt['id']}/hint",
        headers=headers,
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["attempt"]["hints_used"] == 1
    assert second.json()["attempt"]["hints_used"] == 1
    assert first.json()["hint"] == second.json()["hint"]
    assert 899 <= first.json()["attempt"]["active_duration_seconds"] <= 901


def test_stale_attempt_cleanup_preserves_history(db_session, make_client):
    client, _operator, _user = _operator_client(db_session, make_client)
    attempt = _start(client, "mission-stale-cleanup-start")
    stored = db_session.get(m.MissionAttempt, attempt["id"])
    stored.last_activity_at = now_utc() - timedelta(hours=25)
    db_session.commit()

    assert close_stale_attempts(db_session, 24) == 1
    db_session.commit()
    db_session.refresh(stored)

    assert stored.status == "cancelled"
    assert stored.close_reason == "stale_cleanup"
    assert db_session.get(m.MissionAttempt, attempt["id"]) is not None


def test_wallet_failure_rolls_back_completion(db_session, make_client, monkeypatch):
    client, operator, _user = _operator_client(db_session, make_client)
    attempt = _reach_completion(client, _start(client, "mission-wallet-rollback-0001"))
    before = operator.current_balance

    def fail_transaction(*_args, **_kwargs):
        raise RuntimeError("wallet unavailable")

    monkeypatch.setattr("app.modules.missions.service.add_transaction", fail_transaction)
    response = client.post(
        f"/api/missions/attempts/{attempt['id']}/actions",
        headers={"Idempotency-Key": "mission-wallet-failure-complete"},
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


def test_completed_mission_replays_without_progress_reset_or_second_reward(
    db_session, make_client
):
    """Регрессия под именованный сценарий ТЗ (оператор atageldieva_aknur_co, п.16).

    Оператор, уже завершивший миссию, проходит её повторно:
    - статус completed сохраняется (никогда не откатывается в available);
    - историческая (первая) попытка остаётся неизменной;
    - attempt_number растёт, создаётся новая попытка;
    - повторное прохождение не начисляет коины;
    - баланс, число транзакций награды и число MissionRewardGrant не меняются;
    - лучший результат не уменьшается.
    Реальный прод-оператор не используется — сценарий воспроизводится на
    изолированном тестовом операторе, прогресс никому не сбрасывается.
    """
    client, operator, _user = _operator_client(db_session, make_client)
    starting_balance = operator.current_balance

    first = _complete(client, _start(client, "named-scenario-first-0001"))
    assert first["reward_awarded"] is True

    db_session.expire_all()
    first_attempt = db_session.get(m.MissionAttempt, first["id"])
    mission_id = first_attempt.mission_id
    original_status = first_attempt.status
    original_reward_awarded = first_attempt.reward_awarded
    original_reward_tx = first_attempt.reward_transaction_id
    progress = db_session.query(m.OperatorMissionProgress).filter_by(
        operator_id=operator.id, mission_id=mission_id
    ).one()
    assert progress.status == "completed"
    best_before = progress.best_score

    replay = _start(client, "named-scenario-replay-0001")
    assert replay["id"] != first["id"]
    assert replay["attempt_number"] == first["attempt_number"] + 1
    assert replay["reward_eligible"] is False
    replay_done = _complete(client, replay)
    assert replay_done["reward_awarded"] is False
    assert "награда уже получена" in replay_done["reward_message"]

    db_session.expire_all()
    # Историческая попытка неизменна.
    unchanged = db_session.get(m.MissionAttempt, first["id"])
    assert unchanged.status == original_status == "completed"
    assert unchanged.reward_awarded == original_reward_awarded is True
    assert unchanged.reward_transaction_id == original_reward_tx
    # Прогресс не сброшен, best_score не уменьшился.
    progress = db_session.query(m.OperatorMissionProgress).filter_by(
        operator_id=operator.id, mission_id=mission_id
    ).one()
    assert progress.status == "completed"
    assert (progress.best_score or 0) >= (best_before or 0)
    # Экономика: одна награда, один grant, баланс не изменился повторно.
    assert db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id, source_type="mission_reward"
    ).count() == 1
    assert db_session.query(m.MissionRewardGrant).filter_by(
        operator_id=operator.id
    ).count() == 1
    assert db_session.get(m.Operator, operator.id).current_balance == starting_balance + 100


def test_reward_is_granted_once_under_concurrent_completion(db_session, make_client):
    """Регрессия под сценарий ТЗ п.5 (две вкладки не создают две награды).

    Инвариант «награда один раз на operator_id+mission_id+mission_version»
    защищён двумя уровнями, и тест проверяет оба:
    1. Уникальное ограничение БД uq_mission_reward_grant_once не даёт вставить
       второй grant — параллельная вкладка, чья транзакция флашится второй,
       гарантированно откатывается на уровне БД.
    2. Сервис завершения корректно трактует уже существующий grant как
       «награда получена» и не создаёт вторую транзакцию/начисление.
    """
    from sqlalchemy.exc import IntegrityError

    client, operator, _user = _operator_client(db_session, make_client)
    starting_balance = operator.current_balance

    first = _complete(client, _start(client, "concurrent-first-0001"))
    assert first["reward_awarded"] is True

    db_session.expire_all()
    attempt = db_session.get(m.MissionAttempt, first["id"])
    mission_id = attempt.mission_id
    mission_version = attempt.mission_version

    # (1) Уровень БД: дубликат grant для того же ключа отклоняется.
    duplicate = m.MissionRewardGrant(
        operator_id=operator.id,
        mission_id=mission_id,
        mission_version=mission_version,
        attempt_id=first["id"],
        amount=100,
        currency="₡",
    )
    db_session.add(duplicate)
    try:
        db_session.flush()
        raised = False
    except IntegrityError:
        raised = True
    finally:
        db_session.rollback()
    assert raised, "уникальное ограничение uq_mission_reward_grant_once должно сработать"

    # (2) Уровень сервиса: вторая вкладка (replay), даже если ошибочно считает
    # себя eligible, не приводит к повторному начислению.
    replay = _start(client, "concurrent-second-tab-0001")
    stored_replay = db_session.get(m.MissionAttempt, replay["id"])
    stored_replay.reward_eligible = True  # эмулируем гонку: старт до появления grant
    db_session.commit()
    replay_done = _complete(client, replay)
    assert replay_done["reward_awarded"] is False

    db_session.expire_all()
    assert db_session.query(m.CoinTransaction).filter_by(
        operator_id=operator.id, source_type="mission_reward"
    ).count() == 1
    assert db_session.query(m.MissionRewardGrant).filter_by(
        operator_id=operator.id
    ).count() == 1
    assert db_session.get(m.Operator, operator.id).current_balance == starting_balance + 100
