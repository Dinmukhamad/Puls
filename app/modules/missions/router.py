from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Operator, User
from app.modules.missions import service
from app.modules.missions.schemas import (
    MissionActionRequest,
    MissionActionResult,
    MissionAttemptAdminList,
    MissionAttemptRead,
    MissionHintRead,
    MissionMapRead,
    MissionMetadataRead,
    MissionStatsRead,
)
from app.modules.wallet.service import operator_for_user_or_403

router = APIRouter(prefix="/missions", tags=["missions"])
admin_router = APIRouter(prefix="/admin/missions", tags=["admin-missions"])


def _active_operator(db: Session, user: User) -> Operator:
    operator = operator_for_user_or_403(db, user)
    if not operator.is_active or operator.employment_status == "dismissed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Миссии доступны только активным операторам",
        )
    return operator


@router.get("", response_model=MissionMapRead)
def list_missions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.mission_map(db, _active_operator(db, user))


@router.get("/{code}", response_model=MissionMetadataRead)
def get_mission(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.mission_metadata(db, _active_operator(db, user), code)


@router.post("/{code}/start", response_model=MissionAttemptRead)
def start_mission(
    code: str,
    idempotency_key: str = Header(
        alias="Idempotency-Key",
        min_length=8,
        max_length=120,
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    attempt = service.start_or_resume(db, _active_operator(db, user), code, idempotency_key)
    db.commit()
    db.refresh(attempt)
    return service.attempt_read(db, attempt)


@router.get("/attempts/{attempt_id}", response_model=MissionAttemptRead)
def get_attempt(
    attempt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    return service.attempt_read(db, attempt)


@router.post("/attempts/{attempt_id}/actions", response_model=MissionActionResult)
def submit_action(
    attempt_id: int,
    payload: MissionActionRequest,
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        min_length=8,
        max_length=120,
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    accepted, feedback = service.apply_action(
        db,
        attempt,
        payload.action_key,
        payload.payload,
        idempotency_key,
    )
    db.commit()
    db.refresh(attempt)
    return {
        "attempt": service.attempt_read(db, attempt),
        "accepted": accepted,
        "feedback": feedback,
    }


@router.post("/attempts/{attempt_id}/hint", response_model=MissionHintRead)
def request_hint(
    attempt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    hint = service.use_hint(db, attempt)
    db.commit()
    db.refresh(attempt)
    return {"hint": hint, "attempt": service.attempt_read(db, attempt)}


@router.post("/attempts/{attempt_id}/restart", response_model=MissionAttemptRead)
def restart_mission(
    attempt_id: int,
    idempotency_key: str = Header(
        alias="Idempotency-Key",
        min_length=8,
        max_length=120,
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    restarted = service.restart_attempt(db, attempt, idempotency_key)
    db.commit()
    db.refresh(restarted)
    return service.attempt_read(db, restarted)


@admin_router.get("/stats", response_model=MissionStatsRead)
def get_mission_stats(
    mission: str | None = Query(default=None, max_length=80),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    return service.admin_stats(db, mission)


@admin_router.get("/attempts", response_model=MissionAttemptAdminList)
def list_mission_attempts(
    mission: str | None = Query(default=None, max_length=80),
    operator: int | None = Query(default=None, ge=1),
    attempt_status: str | None = Query(default=None, alias="status", max_length=32),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    return service.admin_attempts(
        db,
        mission_code=mission,
        operator_id=operator,
        attempt_status=attempt_status,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
