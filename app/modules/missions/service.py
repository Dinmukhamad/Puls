from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_local, now_utc
from app.models.entities import (
    CoinTransaction,
    Mission,
    MissionAttempt,
    MissionEvent,
    MissionStep,
    Operator,
    OperatorLevel,
    OperatorLevelAssignment,
    OperatorMissionProgress,
)
from app.modules.missions.sapar_seed import SAPAR_MISSION_CODE
from app.modules.wallet.service import add_transaction

PROFILE_TARGETS = ("name", "status", "park", "rating")
PHONE_MASK_RE = re.compile(r"^\+7 \(\*{3}\) \*{3}-\*{2}-\d{2}$")
PHOTO_MISSION_CODE = "photo_control_basics"
CAR_ASSETS = {
    "front": "car-front-v1",
    "left": "car-left-v1",
    "rear": "car-rear-v1",
    "right": "car-right-v1",
    "front_seats": "car-front-seats-v1",
    "rear_seats": "car-rear-seats-v1",
    "trunk": "car-trunk-v1",
}


def _mission_or_404(db: Session, code: str, *, active_only: bool = True) -> Mission:
    query = select(Mission).where(Mission.code == code)
    if active_only:
        query = query.where(Mission.is_active.is_(True))
    mission = db.scalar(query)
    if mission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Миссия не найдена")
    return mission


def _progress(db: Session, operator_id: int, mission_id: int) -> OperatorMissionProgress | None:
    return db.scalar(
        select(OperatorMissionProgress).where(
            OperatorMissionProgress.operator_id == operator_id,
            OperatorMissionProgress.mission_id == mission_id,
        )
    )


def _is_unlocked(db: Session, operator_id: int, mission: Mission) -> bool:
    required_codes = (mission.prerequisites_json or {}).get("completed_mission_codes", [])
    if not required_codes:
        return True
    completed = set(
        db.scalars(
            select(Mission.code)
            .join(OperatorMissionProgress, OperatorMissionProgress.mission_id == Mission.id)
            .where(
                OperatorMissionProgress.operator_id == operator_id,
                OperatorMissionProgress.status == "completed",
                Mission.code.in_(required_codes),
            )
        ).all()
    )
    return all(code in completed for code in required_codes)


def mission_map(db: Session, operator: Operator) -> dict[str, Any]:
    missions = db.scalars(
        select(Mission).where(Mission.is_active.is_(True)).order_by(Mission.sort_order, Mission.id)
    ).all()
    progress_rows = db.scalars(
        select(OperatorMissionProgress).where(
            OperatorMissionProgress.operator_id == operator.id,
            OperatorMissionProgress.mission_id.in_([mission.id for mission in missions] or [-1]),
        )
    ).all()
    progress_by_mission = {row.mission_id: row for row in progress_rows}

    cards: list[dict[str, Any]] = []
    completed = 0
    for mission in missions:
        progress = progress_by_mission.get(mission.id)
        unlocked = _is_unlocked(db, operator.id, mission)
        card_status = "locked"
        if unlocked:
            card_status = progress.status if progress else "available"
            if card_status == "completed":
                completed += 1
        action_labels = {
            "available": "Начать",
            "in_progress": "Продолжить",
            "completed": "Пройти ещё раз",
            "locked": "Недоступно",
        }
        cards.append(
            {
                "code": mission.code,
                "title": mission.title,
                "description": mission.description,
                "mission_type": mission.mission_type,
                "sort_order": mission.sort_order,
                "reward_coins": mission.reward_coins,
                "estimated_minutes": mission.estimated_minutes,
                "version": mission.version,
                "status": card_status,
                "current_step_key": progress.current_step_key if progress else None,
                "attempts_count": progress.attempts_count if progress else 0,
                "reward_claimed": progress.reward_claimed if progress else False,
                "action_label": action_labels[card_status],
            }
        )

    earned = db.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.operator_id == operator.id,
            CoinTransaction.source_type == "mission_reward",
        )
    ) or 0
    total = len(missions)
    return {
        "missions": cards,
        "completed": completed,
        "total": total,
        "percent": round(completed / total * 100) if total else 0,
        "earned_coins": int(earned),
    }


def mission_metadata(db: Session, operator: Operator, code: str) -> dict[str, Any]:
    mission = _mission_or_404(db, code)
    if not _is_unlocked(db, operator.id, mission):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Миссия пока недоступна")
    steps_count = db.scalar(
        select(func.count(MissionStep.id)).where(
            MissionStep.mission_id == mission.id,
            MissionStep.mission_version == mission.version,
        )
    ) or 0
    return {
        "code": mission.code,
        "title": mission.title,
        "description": mission.description,
        "mission_type": mission.mission_type,
        "reward_coins": mission.reward_coins,
        "estimated_minutes": mission.estimated_minutes,
        "version": mission.version,
        "steps_count": steps_count,
    }


def _demo_code(seed: str) -> str:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return f"{int(digest[:12], 16) % 1_000_000:06d}"


def mission_metadata_by_id(db: Session, mission_id: int) -> dict[str, Any]:
    mission = db.get(Mission, mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="Миссия не найдена")
    steps_count = db.scalar(
        select(func.count(MissionStep.id)).where(
            MissionStep.mission_id == mission.id,
            MissionStep.mission_version == mission.version,
        )
    ) or 0
    return {
        "code": mission.code,
        "title": mission.title,
        "description": mission.description,
        "mission_type": mission.mission_type,
        "reward_coins": mission.reward_coins,
        "estimated_minutes": mission.estimated_minutes,
        "version": mission.version,
        "steps_count": steps_count,
    }


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _new_attempt(
    db: Session,
    operator: Operator,
    mission: Mission,
    progress: OperatorMissionProgress,
    idempotency_key: str,
) -> MissionAttempt:
    seed = secrets.token_urlsafe(32)
    first_step = db.scalar(
        select(MissionStep)
        .where(
            MissionStep.mission_id == mission.id,
            MissionStep.mission_version == mission.version,
        )
        .order_by(MissionStep.step_order)
    )
    if first_step is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="У миссии нет шагов")
    initial_state = {}
    if mission.code == PHOTO_MISSION_CODE:
        initial_state = {
            "car_slots": {},
            "license_slots": {},
            "checks": {"car": "pending", "driver_license": "pending"},
            "instruction_seen": False,
            "final_statuses_confirmed": False,
        }
    elif mission.code == SAPAR_MISSION_CODE:
        from app.modules.missions.world_service import active_setting, is_day_allowed

        setting = active_setting(db, mission.id)
        rule = dict(setting.value_json or {})
        shown_date = now_local().date()
        initial_state = {
            "setting_version": setting.version,
            "provider_rule": rule,
            "simulated_date": shown_date.isoformat(),
            "date_allowed": is_day_allowed(
                shown_date.day, int(rule["start_day"]), int(rule["end_day"])
            ) if rule.get("is_active", True) else True,
            "current_provider": "bukhta",
            "driver_status_errors": 0,
            "date_errors": 0,
            "navigation_errors": 0,
            "provider_errors": 0,
            "terms_viewed": False,
            "consent_confirmed": False,
            "outcomes_confirmed": False,
        }
    attempt = MissionAttempt(
        operator_id=operator.id,
        mission_id=mission.id,
        mission_version=mission.version,
        attempt_number=progress.attempts_count + 1,
        idempotency_key=idempotency_key,
        mode=mission.mission_type,
        status="in_progress",
        current_step_key=first_step.step_key,
        demo_code_seed=seed,
        demo_code_hash=_code_hash(_demo_code(seed)),
        state_json=initial_state,
    )
    db.add(attempt)
    progress.status = "in_progress"
    progress.current_step_key = first_step.step_key
    progress.attempts_count += 1
    progress.started_at = now_utc()
    progress.updated_at = now_utc()
    db.flush()
    _record_event(db, attempt, "started", action_key="start", is_correct=True)
    return attempt


def start_or_resume(
    db: Session,
    operator: Operator,
    code: str,
    idempotency_key: str,
) -> MissionAttempt:
    mission = _mission_or_404(db, code)
    if not _is_unlocked(db, operator.id, mission):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Миссия пока недоступна")

    idempotent_attempt = db.scalar(
        select(MissionAttempt).where(MissionAttempt.idempotency_key == idempotency_key)
    )
    if idempotent_attempt is not None:
        if idempotent_attempt.operator_id != operator.id or idempotent_attempt.mission_id != mission.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ключ запуска уже использован для другой миссии",
            )
        return idempotent_attempt

    active_attempt = db.scalar(
        select(MissionAttempt)
        .where(
            MissionAttempt.operator_id == operator.id,
            MissionAttempt.mission_id == mission.id,
            MissionAttempt.status == "in_progress",
        )
        .order_by(MissionAttempt.id.desc())
    )
    if active_attempt is not None:
        return active_attempt

    progress = _progress(db, operator.id, mission.id)
    if progress is None:
        progress = OperatorMissionProgress(operator_id=operator.id, mission_id=mission.id)
        db.add(progress)
        db.flush()
    return _new_attempt(db, operator, mission, progress, idempotency_key)


def attempt_for_operator(db: Session, attempt_id: int, operator_id: int) -> MissionAttempt:
    attempt = db.scalar(
        select(MissionAttempt).where(
            MissionAttempt.id == attempt_id,
            MissionAttempt.operator_id == operator_id,
        )
    )
    if attempt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Попытка не найдена")
    return attempt


def _step_for_attempt(db: Session, attempt: MissionAttempt) -> MissionStep:
    step = db.scalar(
        select(MissionStep).where(
            MissionStep.mission_id == attempt.mission_id,
            MissionStep.mission_version == attempt.mission_version,
            MissionStep.step_key == attempt.current_step_key,
        )
    )
    if step is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Версия шага миссии больше недоступна",
        )
    return step


def _profile_targets_done(db: Session, attempt_id: int) -> list[str]:
    events = db.scalars(
        select(MissionEvent)
        .where(
            MissionEvent.attempt_id == attempt_id,
            MissionEvent.step_key == "inspect_profile",
            MissionEvent.event_type == "action",
            MissionEvent.is_correct.is_(True),
        )
        .order_by(MissionEvent.created_at, MissionEvent.id)
    ).all()
    done: list[str] = []
    for event in events:
        target = (event.payload_json or {}).get("target")
        if target in PROFILE_TARGETS and target not in done:
            done.append(target)
    return done


def _first_name(operator: Operator) -> str:
    parts = [part for part in (operator.full_name or "").split() if part]
    if len(parts) >= 2:
        return parts[1]
    return parts[0] if parts else ""


def attempt_read(db: Session, attempt: MissionAttempt) -> dict[str, Any]:
    mission = db.get(Mission, attempt.mission_id)
    if mission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Миссия не найдена")
    step = _step_for_attempt(db, attempt)
    operator = db.get(Operator, attempt.operator_id)
    content = dict(step.content_json or {})
    replacements = {
        "{first_name}": _first_name(operator) if operator else "",
        "{demo_code}": _demo_code(attempt.demo_code_seed),
    }
    for key, value in list(content.items()):
        if isinstance(value, str):
            for marker, replacement in replacements.items():
                value = value.replace(marker, replacement)
            content[key] = value
    if step.screen_key == "driver_profile":
        content["profile"] = {
            "full_name": operator.full_name if operator and operator.full_name else "Учебный водитель",
            "role": "Водитель такси",
            "tax_status": "Самозанятый водитель",
            "fleet": "iTaxi",
            "rating": "5.00",
            "level": "—",
            "achievements": "0 из 3",
            "income_mode": "Эффективный",
            "tariffs": "0 из 5",
        }
    level_name = "Стажёр"
    if operator:
        assignment = db.scalar(
            select(OperatorLevelAssignment).where(
                OperatorLevelAssignment.operator_id == operator.id
            )
        )
        if assignment:
            level = db.get(OperatorLevel, assignment.level_id)
            if level:
                level_name = level.name

    completed_targets = _profile_targets_done(db, attempt.id) if step.step_key == "inspect_profile" else []
    required_target = None
    if step.step_key == "inspect_profile" and len(completed_targets) < len(PROFILE_TARGETS):
        required_target = PROFILE_TARGETS[len(completed_targets)]

    step_count = db.scalar(
        select(func.count(MissionStep.id)).where(
            MissionStep.mission_id == attempt.mission_id,
            MissionStep.mission_version == attempt.mission_version,
        )
    ) or 1
    progress = _progress(db, attempt.operator_id, attempt.mission_id)
    reward_eligible = not (
        progress
        and progress.reward_claimed
        and progress.reward_claimed_version == attempt.mission_version
    )
    progress_percent = (
        100
        if attempt.status == "completed"
        else round(step.step_order / max(1, step_count - 1) * 100)
    )
    reward_message = None
    if attempt.status == "completed":
        reward_message = (
            f"Начислено {mission.reward_coins} коинов"
            if attempt.reward_awarded
            else "Миссия повторно пройдена — награда уже получена"
        )
    return {
        "id": attempt.id,
        "mission_code": mission.code,
        "mission_title": mission.title,
        "mission_version": attempt.mission_version,
        "attempt_number": attempt.attempt_number,
        "status": attempt.status,
        "current_step": {
            "step_key": step.step_key,
            "step_order": step.step_order,
            "total_steps": step_count,
            "step_type": step.step_type,
            "screen_key": step.screen_key,
            "action_key": step.action_key,
            "content": content,
            "hint_available": bool(step.hint_text),
            "completed_targets": completed_targets,
            "required_target": required_target,
        },
        "progress_percent": progress_percent,
        "reward_coins": mission.reward_coins,
        "reward_eligible": reward_eligible,
        "reward_awarded": attempt.reward_awarded,
        "reward_message": reward_message,
        "score": attempt.score,
        "max_score": attempt.max_score,
        "best_score": progress.best_score if progress else None,
        "state": attempt.state_json or {},
        "license_identity": {
            "full_name": operator.full_name if operator and operator.full_name else "Учебный водитель",
            "level": level_name,
            "fleet": "iTaxi",
        },
        "errors_count": attempt.errors_count,
        "hints_used": attempt.hints_used,
        "started_at": attempt.started_at,
        "completed_at": attempt.completed_at,
        "autosave_state": "Сохранено",
    }


def _record_event(
    db: Session,
    attempt: MissionAttempt,
    event_type: str,
    *,
    action_key: str | None = None,
    is_correct: bool | None = None,
    payload: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> MissionEvent:
    event = MissionEvent(
        attempt_id=attempt.id,
        step_key=attempt.current_step_key,
        event_type=event_type,
        action_key=action_key,
        is_correct=is_correct,
        payload_json=payload or {},
        idempotency_key=idempotency_key,
    )
    db.add(event)
    return event


def _invalid_action(
    db: Session,
    attempt: MissionAttempt,
    action_key: str,
    feedback: str,
    *,
    event_type: str = "action",
    idempotency_key: str | None = None,
) -> tuple[bool, str]:
    attempt.errors_count += 1
    _record_event(
        db,
        attempt,
        event_type,
        action_key=action_key,
        is_correct=False,
        idempotency_key=idempotency_key,
    )
    return False, feedback


def _advance(db: Session, attempt: MissionAttempt, step: MissionStep) -> None:
    next_step = db.scalar(
        select(MissionStep)
        .where(
            MissionStep.mission_id == attempt.mission_id,
            MissionStep.mission_version == attempt.mission_version,
            MissionStep.step_order > step.step_order,
        )
        .order_by(MissionStep.step_order)
    )
    if next_step is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Следующий шаг не настроен")
    attempt.current_step_key = next_step.step_key
    progress = _progress(db, attempt.operator_id, attempt.mission_id)
    if progress:
        progress.current_step_key = next_step.step_key
        progress.updated_at = now_utc()


def _complete(db: Session, attempt: MissionAttempt) -> tuple[bool, str]:
    if attempt.status == "completed":
        return True, "Результат уже сохранён"
    mission = db.get(Mission, attempt.mission_id)
    progress = db.scalar(
        select(OperatorMissionProgress)
        .where(
            OperatorMissionProgress.operator_id == attempt.operator_id,
            OperatorMissionProgress.mission_id == attempt.mission_id,
        )
        .with_for_update()
    )
    if mission is None or progress is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Прогресс миссии не найден")
    passing_score = int((mission.prerequisites_json or {}).get("passing_score", 0))
    if passing_score and (attempt.score or 0) < passing_score:
        return False, f"Набрано {int(attempt.score or 0)} из 100. Разбери ошибки и попробуй ещё раз."

    completed_at = now_utc()
    attempt.status = "completed"
    attempt.completed_at = completed_at
    attempt.duration_seconds = max(0, int((completed_at - attempt.started_at).total_seconds()))
    progress.status = "completed"
    progress.current_step_key = "completion"
    progress.completed_at = completed_at
    progress.updated_at = completed_at

    eligible = not (
        progress.reward_claimed and progress.reward_claimed_version == attempt.mission_version
    )
    if eligible and mission.reward_coins > 0:
        operator = db.get(Operator, attempt.operator_id)
        if operator is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Оператор не найден")
        transaction = add_transaction(
            db,
            operator,
            mission.reward_coins,
            "mission_reward",
            f"Награда за миссию «{mission.title}»",
            source_type="mission_reward",
            source_id=attempt.id,
            metadata={"mission_code": mission.code, "mission_version": attempt.mission_version},
        )
        db.flush()
        progress.reward_claimed = True
        progress.reward_claimed_version = attempt.mission_version
        progress.reward_transaction_id = transaction.id
        attempt.reward_awarded = True
        return True, f"Миссия завершена — начислено {mission.reward_coins} коинов"

    attempt.reward_awarded = False
    return True, "Миссия повторно пройдена — награда уже получена"


def _photo_score(db: Session, attempt: MissionAttempt, state: dict[str, Any]) -> int:
    wrong_navigation = db.scalar(
        select(func.count(MissionEvent.id)).where(
            MissionEvent.attempt_id == attempt.id,
            MissionEvent.event_type == "wrong_navigation",
        )
    ) or 0
    premature = db.scalar(
        select(func.count(MissionEvent.id)).where(
            MissionEvent.attempt_id == attempt.id,
            MissionEvent.event_type == "incomplete_submit",
        )
    ) or 0
    car_points = min(7, len(state.get("car_slots", {}))) * 7
    license_points = min(2, len(state.get("license_slots", {}))) * 10
    navigation_points = max(0, 10 - int(wrong_navigation) * 2)
    submit_points = max(0, 6 - int(premature) * 3)
    independence_points = max(0, 10 - attempt.hints_used * 2)
    final_points = 5 if state.get("final_statuses_confirmed") else 0
    return int(
        car_points
        + license_points
        + navigation_points
        + submit_points
        + independence_points
        + final_points
    )


def _apply_photo_action(
    db: Session,
    attempt: MissionAttempt,
    step: MissionStep,
    action_key: str,
    payload: dict[str, Any],
    idempotency_key: str | None,
) -> tuple[bool, str]:
    premature_submit = (
        (step.screen_key == "car_grid" and action_key == "submit_car_check")
        or (step.screen_key == "license_grid" and action_key == "submit_license_check")
    )
    if action_key != step.action_key and not premature_submit:
        return _invalid_action(
            db,
            attempt,
            action_key,
            "Сейчас требуется другое действие. Следуй подсказке Пульсара.",
            event_type="wrong_navigation",
            idempotency_key=idempotency_key,
        )

    state = dict(attempt.state_json or {})
    state["car_slots"] = dict(state.get("car_slots", {}))
    state["license_slots"] = dict(state.get("license_slots", {}))
    state["checks"] = dict(
        state.get("checks", {"car": "pending", "driver_license": "pending"})
    )
    event_type = action_key
    safe_payload: dict[str, Any] = {}

    if action_key == "select_check":
        expected = str((step.content_json or {}).get("check_type", ""))
        selected = str(payload.get("check_type", ""))
        if selected != expected:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Выбери подсвеченную обязательную проверку.",
                event_type="wrong_navigation",
                idempotency_key=idempotency_key,
            )
        safe_payload = {"check_type": selected}
    elif action_key == "view_instruction":
        state["instruction_seen"] = True
    elif action_key == "confirm_car_slot":
        expected_slot = str((step.content_json or {}).get("slot_key", ""))
        slot_key = str(payload.get("slot_key", ""))
        asset_id = str(payload.get("asset_id", ""))
        if slot_key != expected_slot:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Заполняй ракурсы по порядку — текущий слот подсвечен.",
                event_type="wrong_navigation",
                idempotency_key=idempotency_key,
            )
        if CAR_ASSETS.get(slot_key) != asset_id:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Этот учебный кадр не относится к выбранному слоту.",
                event_type="invalid_asset",
                idempotency_key=idempotency_key,
            )
        state["car_slots"][slot_key] = {"asset_id": asset_id, "status": "filled"}
        safe_payload = {"slot_key": slot_key, "asset_id": asset_id}
        event_type = "fill_slot"
    elif action_key == "submit_car_check":
        if set(state["car_slots"]) != set(CAR_ASSETS):
            missing = len(CAR_ASSETS) - len(state["car_slots"])
            return _invalid_action(
                db,
                attempt,
                action_key,
                f"Добавьте ещё {missing} фото.",
                event_type="incomplete_submit",
                idempotency_key=idempotency_key,
            )
        state["checks"]["car"] = "passed"
        event_type = "submit_check"
    elif action_key == "confirm_license_side":
        expected_side = str((step.content_json or {}).get("side", ""))
        side = str(payload.get("side", ""))
        if side != expected_side or side not in {"front", "back"}:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Добавь подсвеченную сторону учебного удостоверения.",
                event_type="wrong_navigation",
                idempotency_key=idempotency_key,
            )
        state["license_slots"][side] = {"status": "filled", "asset_id": f"license-{side}-v1"}
        safe_payload = {"side": side, "asset_id": f"license-{side}-v1"}
        event_type = "fill_slot"
    elif action_key == "submit_license_check":
        if set(state["license_slots"]) != {"front", "back"}:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Добавьте лицевую и обратную стороны.",
                event_type="incomplete_submit",
                idempotency_key=idempotency_key,
            )
        state["checks"]["driver_license"] = "passed"
        event_type = "submit_check"
    elif action_key == "confirm_final_statuses":
        if state["checks"] != {"car": "passed", "driver_license": "passed"}:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Сначала успешно отправь обе обязательные проверки.",
                event_type="incomplete_submit",
                idempotency_key=idempotency_key,
            )
        if payload.get("car") is not True or payload.get("driver_license") is not True:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Подтверди обе зелёные галочки.",
                event_type="wrong_navigation",
                idempotency_key=idempotency_key,
            )
        state["final_statuses_confirmed"] = True
        safe_payload = {"car": True, "driver_license": True}
    elif action_key == "complete":
        _record_event(
            db,
            attempt,
            "complete",
            action_key=action_key,
            is_correct=True,
            idempotency_key=idempotency_key,
        )
        result = _complete(db, attempt)
        db.flush()
        return result

    attempt.state_json = state
    _record_event(
        db,
        attempt,
        event_type,
        action_key=action_key,
        is_correct=True,
        payload=safe_payload,
        idempotency_key=idempotency_key,
    )
    if action_key == "confirm_final_statuses":
        attempt.score = _photo_score(db, attempt, state)
        attempt.max_score = 100
        progress = _progress(db, attempt.operator_id, attempt.mission_id)
        if progress:
            progress.best_score = max(progress.best_score or 0, attempt.score)
    _advance(db, attempt, step)
    db.flush()
    return True, "Шаг сохранён"


def _sapar_score(attempt: MissionAttempt, state: dict[str, Any]) -> int:
    driver = max(0, 10 - int(state.get("driver_status_errors", 0)) * 5)
    date_errors = int(state.get("date_errors", 0))
    date_points = 20 if date_errors == 0 else (10 if date_errors == 1 else 0)
    navigation = max(0, 20 - int(state.get("navigation_errors", 0)) * 2)
    provider = max(0, 20 - int(state.get("provider_errors", 0)) * 5)
    consent = 15 if state.get("terms_viewed") and state.get("consent_confirmed") else 0
    outcomes = 10 if state.get("outcomes_confirmed") else 0
    independence = max(0, 5 - attempt.hints_used)
    return driver + date_points + navigation + provider + consent + outcomes + independence


def _apply_sapar_action(
    db: Session,
    attempt: MissionAttempt,
    step: MissionStep,
    action_key: str,
    payload: dict[str, Any],
    idempotency_key: str | None,
) -> tuple[bool, str]:
    state = dict(attempt.state_json or {})

    def reject(message: str, event_type: str, counter: str | None = None) -> tuple[bool, str]:
        if counter:
            state[counter] = int(state.get(counter, 0)) + 1
        attempt.state_json = state
        return _invalid_action(
            db,
            attempt,
            action_key,
            message,
            event_type=event_type,
            idempotency_key=idempotency_key,
        )

    if action_key != step.action_key:
        return reject(
            "Сейчас требуется другое действие. Следуй подсказке Пульсара.",
            "navigation_error",
            "navigation_errors",
        )

    event_type = action_key
    safe_payload: dict[str, Any] = {}
    if action_key == "answer_driver_status":
        answer = payload.get("is_self_employed")
        if answer is not True:
            return reject(
                "Этот путь применяется только к самозанятому водителю. Проверь статус и выбери «Да».",
                "driver_status_answer",
                "driver_status_errors",
            )
        safe_payload = {"is_self_employed": True}
        event_type = "driver_status_answer"
    elif action_key == "answer_date_rule":
        answer = payload.get("allowed")
        expected = bool(state.get("date_allowed"))
        if not isinstance(answer, bool) or answer != expected:
            rule = state.get("provider_rule", {})
            return reject(
                str(rule.get("operator_message") or "Проверь разрешённый период ещё раз."),
                "date_rule_answer",
                "date_errors",
            )
        safe_payload = {"allowed": answer, "simulated_date": state.get("simulated_date")}
        event_type = "date_rule_answer"
    elif action_key == "open_legal_docs":
        if payload.get("section") not in {None, "legal_docs"}:
            return reject("Нужен раздел «Юридическая документация».", "navigation_error", "navigation_errors")
        safe_payload = {"section": "legal_docs"}
    elif action_key == "open_edo":
        if payload.get("section") not in {None, "edo"}:
            return reject("Открой «Электронный документооборот».", "navigation_error", "navigation_errors")
        safe_payload = {"section": "edo"}
    elif action_key == "open_provider_list":
        safe_payload = {"current_provider": state.get("current_provider")}
    elif action_key == "select_provider":
        provider = str(payload.get("provider_code", ""))
        allowed = {"cnt", "payda", "sapar", "partners_pay", "vezunchik", "paper"}
        if provider not in allowed:
            return reject("Неизвестный учебный провайдер.", "provider_error", "provider_errors")
        if provider != "sapar":
            return reject("Для этого обращения выбери SAPAR.", "provider_error", "provider_errors")
        state["selected_provider"] = "sapar"
        safe_payload = {"provider_code": "sapar"}
    elif action_key == "view_terms":
        state["terms_viewed"] = True
    elif action_key == "confirm_consent":
        if payload.get("accepted") is not True or not state.get("terms_viewed"):
            return reject("Сначала прочитай условия и отметь учебное согласие.", "consent_error")
        state["consent_confirmed"] = True
        safe_payload = {"accepted": True, "training_only": True}
    elif action_key == "finish_processing":
        state["processing_complete"] = True
    elif action_key == "confirm_outcomes":
        if payload.get("next_month") is not True or payload.get("contract_and_tariff") is not True:
            return reject(
                "Отметь оба последствия: документы со следующего месяца и оформление договора/тарифа.",
                "outcome_error",
            )
        state["outcomes_confirmed"] = True
        safe_payload = {"next_month": True, "contract_and_tariff": True}
    elif action_key == "complete":
        attempt.score = _sapar_score(attempt, state)
        attempt.max_score = 100
        progress = _progress(db, attempt.operator_id, attempt.mission_id)
        if progress:
            progress.best_score = max(progress.best_score or 0, attempt.score)
        _record_event(
            db,
            attempt,
            "complete",
            action_key=action_key,
            is_correct=True,
            payload={"score": attempt.score, "setting_version": state.get("setting_version")},
            idempotency_key=idempotency_key,
        )
        result = _complete(db, attempt)
        db.flush()
        return result

    attempt.state_json = state
    _record_event(
        db,
        attempt,
        event_type,
        action_key=action_key,
        is_correct=True,
        payload=safe_payload,
        idempotency_key=idempotency_key,
    )
    if action_key == "confirm_outcomes":
        attempt.score = _sapar_score(attempt, state)
        attempt.max_score = 100
        progress = _progress(db, attempt.operator_id, attempt.mission_id)
        if progress:
            progress.best_score = max(progress.best_score or 0, attempt.score)
    _advance(db, attempt, step)
    db.flush()
    return True, "Шаг сохранён"


def apply_action(
    db: Session,
    attempt: MissionAttempt,
    action_key: str,
    payload: dict[str, Any],
    idempotency_key: str | None = None,
) -> tuple[bool, str]:
    if idempotency_key:
        existing = db.scalar(
            select(MissionEvent).where(MissionEvent.idempotency_key == idempotency_key)
        )
        if existing:
            if existing.attempt_id != attempt.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ключ действия уже использован для другой попытки",
                )
            return bool(existing.is_correct), "Результат действия уже сохранён"
    if attempt.status == "completed":
        return (True, "Результат уже сохранён") if action_key == "complete" else (
            False,
            "Эта попытка уже завершена",
        )
    if attempt.status != "in_progress":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Попытка не активна")

    step = _step_for_attempt(db, attempt)
    mission = db.get(Mission, attempt.mission_id)
    if mission and mission.code == PHOTO_MISSION_CODE:
        return _apply_photo_action(
            db, attempt, step, action_key, payload, idempotency_key
        )
    if mission and mission.code == SAPAR_MISSION_CODE:
        return _apply_sapar_action(db, attempt, step, action_key, payload, idempotency_key)
    if action_key != step.action_key:
        feedback = (
            "Для этой тренировки выбери вход по номеру телефона."
            if step.step_key == "choose_login"
            else "Сейчас требуется другое действие. Следуй подсказке Пульсара."
        )
        return _invalid_action(
            db, attempt, action_key, feedback, idempotency_key=idempotency_key
        )

    safe_payload: dict[str, Any] = {}
    if step.step_key == "enter_phone":
        masked_phone = str(payload.get("masked_phone", ""))
        if payload.get("phone_valid") is not True or not PHONE_MASK_RE.fullmatch(masked_phone):
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Введи вымышленный номер: +7 и ещё 10 цифр.",
            )
        safe_payload = {"phone_valid": True, "masked_phone": masked_phone}
    elif step.step_key == "enter_code":
        code = str(payload.get("code", ""))
        if not re.fullmatch(r"\d{6}", code) or not hmac.compare_digest(
            _code_hash(code), attempt.demo_code_hash
        ):
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Код не подошёл. Сверь шесть цифр с сообщением Пульсара и попробуй ещё раз.",
            )
        safe_payload = {"code_entered": True}
    elif step.step_key == "inspect_profile":
        done = _profile_targets_done(db, attempt.id)
        required = PROFILE_TARGETS[len(done)] if len(done) < len(PROFILE_TARGETS) else None
        target = str(payload.get("target", ""))
        if target != required:
            return _invalid_action(
                db,
                attempt,
                action_key,
                "Проверяй данные по порядку: имя, статус, парк и рейтинг.",
            )
        safe_payload = {"target": target}
        _record_event(
            db,
            attempt,
            "action",
            action_key=action_key,
            is_correct=True,
            payload=safe_payload,
        )
        if len(done) + 1 < len(PROFILE_TARGETS):
            db.flush()
            return True, "Контрольная точка подтверждена"
        _advance(db, attempt, step)
        db.flush()
        return True, "Профиль проверен — можно завершать миссию"
    elif step.step_key == "completion":
        _record_event(
            db,
            attempt,
            "action",
            action_key=action_key,
            is_correct=True,
            idempotency_key=idempotency_key,
        )
        result = _complete(db, attempt)
        db.flush()
        return result

    _record_event(
        db,
        attempt,
        "action",
        action_key=action_key,
        is_correct=True,
        payload=safe_payload,
        idempotency_key=idempotency_key,
    )
    _advance(db, attempt, step)
    db.flush()
    return True, "Шаг сохранён"


def use_hint(db: Session, attempt: MissionAttempt) -> str:
    if attempt.status != "in_progress":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Попытка не активна")
    step = _step_for_attempt(db, attempt)
    attempt.hints_used += 1
    _record_event(db, attempt, "hint", action_key="hint", is_correct=None)
    db.flush()
    return step.hint_text or "Следуй подсвеченному элементу на учебном экране."


def restart_attempt(
    db: Session,
    attempt: MissionAttempt,
    idempotency_key: str,
) -> MissionAttempt:
    existing = db.scalar(
        select(MissionAttempt).where(MissionAttempt.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if existing.operator_id != attempt.operator_id or existing.mission_id != attempt.mission_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ключ перезапуска уже использован")
        return existing
    if attempt.status == "in_progress":
        attempt.status = "cancelled"
        _record_event(db, attempt, "restarted", action_key="restart", is_correct=True)
    mission = db.get(Mission, attempt.mission_id)
    progress = _progress(db, attempt.operator_id, attempt.mission_id)
    operator = db.get(Operator, attempt.operator_id)
    if mission is None or progress is None or operator is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Миссию нельзя перезапустить")
    return _new_attempt(db, operator, mission, progress, idempotency_key)


def admin_stats(db: Session, mission_code: str | None = None) -> dict[str, Any]:
    mission_ids: list[int] | None = None
    if mission_code:
        mission = _mission_or_404(db, mission_code, active_only=False)
        mission_ids = [mission.id]
    query = select(MissionAttempt)
    if mission_ids is not None:
        query = query.where(MissionAttempt.mission_id.in_(mission_ids))
    attempts = db.scalars(query).all()
    started_ops = {attempt.operator_id for attempt in attempts}
    completed_attempts = [attempt for attempt in attempts if attempt.status == "completed"]
    completed_ops = {attempt.operator_id for attempt in completed_attempts}
    repeated_ops = {
        operator_id
        for operator_id in started_ops
        if sum(1 for attempt in attempts if attempt.operator_id == operator_id) > 1
    }
    durations = [attempt.duration_seconds for attempt in completed_attempts if attempt.duration_seconds is not None]
    drop_off: dict[str, int] = {}
    for attempt in attempts:
        if attempt.status == "in_progress":
            drop_off[attempt.current_step_key] = drop_off.get(attempt.current_step_key, 0) + 1
    reward_transactions = db.scalars(
        select(CoinTransaction).where(CoinTransaction.source_type == "mission_reward")
    ).all()
    awarded = 0
    for transaction in reward_transactions:
        reward_attempt = db.get(MissionAttempt, transaction.source_id)
        if mission_ids is None or (reward_attempt and reward_attempt.mission_id in mission_ids):
            awarded += transaction.amount
    scored = [float(attempt.score) for attempt in attempts if attempt.score is not None]
    attempt_ids = [attempt.id for attempt in attempts]
    error_rows = db.scalars(
        select(MissionEvent).where(
            MissionEvent.attempt_id.in_(attempt_ids or [-1]),
            MissionEvent.is_correct.is_(False),
        )
    ).all()
    errors_by_type: dict[str, int] = {}
    problem_slots: dict[str, int] = {}
    for event in error_rows:
        errors_by_type[event.event_type] = errors_by_type.get(event.event_type, 0) + 1
        slot = str((event.payload_json or {}).get("slot_key", ""))
        if slot:
            problem_slots[slot] = problem_slots.get(slot, 0) + 1
    return {
        "mission_code": mission_code,
        "started_operators": len(started_ops),
        "completed_operators": len(completed_ops),
        "conversion_percent": round(len(completed_ops) / len(started_ops) * 100, 1) if started_ops else 0,
        "average_duration_seconds": round(sum(durations) / len(durations), 1) if durations else 0,
        "repeat_operators": len(repeated_ops),
        "awarded_coins": awarded,
        "drop_off_by_step": drop_off,
        "average_score": round(sum(scored) / len(scored), 1) if scored else 0,
        "best_score": max(scored) if scored else 0,
        "errors_by_type": errors_by_type,
        "problem_slots": problem_slots,
    }


def admin_attempts(
    db: Session,
    *,
    mission_code: str | None = None,
    operator_id: int | None = None,
    attempt_status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    query = (
        select(MissionAttempt, Mission, Operator)
        .join(Mission, MissionAttempt.mission_id == Mission.id)
        .join(Operator, MissionAttempt.operator_id == Operator.id)
    )
    if mission_code:
        query = query.where(Mission.code == mission_code)
    if operator_id is not None:
        query = query.where(MissionAttempt.operator_id == operator_id)
    if attempt_status:
        query = query.where(MissionAttempt.status == attempt_status)
    if date_from:
        query = query.where(MissionAttempt.started_at >= date_from)
    if date_to:
        query = query.where(MissionAttempt.started_at <= date_to)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(
        query.order_by(MissionAttempt.started_at.desc()).offset(offset).limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": attempt.id,
                "mission_code": mission.code,
                "mission_title": mission.title,
                "operator_id": operator.id,
                "operator_name": operator.full_name,
                "status": attempt.status,
                "current_step_key": attempt.current_step_key,
                "attempt_number": attempt.attempt_number,
                "errors_count": attempt.errors_count,
                "hints_used": attempt.hints_used,
                "reward_awarded": attempt.reward_awarded,
                "started_at": attempt.started_at,
                "completed_at": attempt.completed_at,
                "duration_seconds": attempt.duration_seconds,
            }
            for attempt, mission, operator in rows
        ],
        "total": total,
    }
