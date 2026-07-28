from __future__ import annotations

import logging
from datetime import datetime
from time import perf_counter

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import LearningWorld, Mission, Operator, User
from app.modules.missions import service, world_service
from app.modules.missions.schemas import (
    DocumentSigningWindowPreview,
    DocumentSigningWindowUpdate,
    LearningWorldAdminRead,
    LearningWorldCreate,
    LearningWorldMapRead,
    LearningWorldPatch,
    LearningWorldRouteRead,
    MissionActionRequest,
    MissionActionResult,
    MissionAttemptAdminList,
    MissionAttemptRead,
    MissionHintRead,
    MissionMapRead,
    MissionMetadataRead,
    MissionSettingRead,
    MissionStatsRead,
    MissionWorldAssignment,
    ProviderWindowPreview,
    ProviderWindowUpdate,
)
from app.modules.wallet.service import operator_for_user_or_403

router = APIRouter(prefix="/missions", tags=["missions"])
admin_router = APIRouter(prefix="/admin/missions", tags=["admin-missions"])
logger = logging.getLogger(__name__)


def _log_attempt_action(
    attempt,
    action: str,
    started: float,
    *,
    error_code: str | None = None,
) -> None:
    logger.info(
        "mission_action",
        extra={
            "operator_id": attempt.operator_id,
            "mission_code": attempt.mission.code if attempt.mission else None,
            "version": attempt.mission_version,
            "attempt_id": attempt.id,
            "attempt_number": attempt.attempt_number,
            "action": action,
            "error_code": error_code,
            "latency_ms": round((perf_counter() - started) * 1000, 1),
        },
    )


def _active_operator(db: Session, user: User) -> Operator:
    operator = operator_for_user_or_403(db, user)
    if operator.employment_status == "dismissed":
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


@router.get("/worlds", response_model=LearningWorldMapRead)
def list_learning_worlds(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return world_service.worlds_map(db, _active_operator(db, user))


@router.get("/worlds/{code}", response_model=LearningWorldRouteRead)
def get_learning_world(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return world_service.world_route(db, _active_operator(db, user), code)


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
    started = perf_counter()
    attempt = service.start_or_resume(db, _active_operator(db, user), code, idempotency_key)
    db.commit()
    db.refresh(attempt)
    _log_attempt_action(attempt, "start_or_resume", started)
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
    idempotency_key: str = Header(
        alias="Idempotency-Key",
        min_length=8,
        max_length=120,
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    started = perf_counter()
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
    _log_attempt_action(
        attempt,
        payload.action_key,
        started,
        error_code=None if accepted else "INVALID_ACTION",
    )
    return {
        "attempt": service.attempt_read(db, attempt),
        "accepted": accepted,
        "feedback": feedback,
    }


@router.post("/attempts/{attempt_id}/hint", response_model=MissionHintRead)
def request_hint(
    attempt_id: int,
    idempotency_key: str = Header(
        alias="Idempotency-Key",
        min_length=8,
        max_length=120,
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    started = perf_counter()
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    hint = service.use_hint(db, attempt, idempotency_key)
    db.commit()
    db.refresh(attempt)
    _log_attempt_action(attempt, "hint", started)
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
    started = perf_counter()
    operator = _active_operator(db, user)
    attempt = service.attempt_for_operator(db, attempt_id, operator.id)
    restarted = service.restart_attempt(db, attempt, idempotency_key)
    db.commit()
    db.refresh(restarted)
    _log_attempt_action(restarted, "restart", started)
    return service.attempt_read(db, restarted)


@admin_router.get("/stats", response_model=MissionStatsRead)
def get_mission_stats(
    mission: str | None = Query(default=None, max_length=80),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    return service.admin_stats(db, mission)


@admin_router.get("/worlds", response_model=list[LearningWorldAdminRead])
def list_admin_worlds(
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    return world_service.admin_worlds(db)


@admin_router.post("/worlds", response_model=LearningWorldAdminRead)
def create_admin_world(
    payload: LearningWorldCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
):
    world = world_service.create_world(db, payload.model_dump())
    db.commit()
    db.refresh(world)
    return world


@admin_router.patch("/worlds/{world_id}", response_model=LearningWorldAdminRead)
def patch_admin_world(
    world_id: int,
    payload: LearningWorldPatch,
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
):
    world = db.get(LearningWorld, world_id)
    if world is None:
        raise HTTPException(status_code=404, detail="Территория не найдена")
    world_service.update_world(world, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(world)
    return world


@admin_router.patch("/{mission_id}/world", response_model=MissionMetadataRead)
def assign_mission_world(
    mission_id: int,
    payload: MissionWorldAssignment,
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
):
    mission = world_service.assign_world(db, mission_id, payload.world_id, payload.world_sort_order)
    db.commit()
    return service.mission_metadata_by_id(db, mission.id)


@admin_router.get("/{mission_id}/settings", response_model=list[MissionSettingRead])
def list_mission_settings(
    mission_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    return [world_service.setting_payload(row) for row in world_service.setting_list(db, mission_id)]


@admin_router.patch(
    "/{mission_id}/settings/provider-transfer-window",
    response_model=MissionSettingRead,
)
def update_provider_window(
    mission_id: int,
    payload: ProviderWindowUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    setting = world_service.publish_window(db, mission_id, payload.model_dump(), user)
    db.commit()
    db.refresh(setting)
    return world_service.setting_payload(setting)


@admin_router.get(
    "/{mission_id}/settings/provider-transfer-window/preview",
    response_model=ProviderWindowPreview,
)
def preview_provider_window(
    mission_id: int,
    start_day: int = Query(ge=1, le=31),
    end_day: int = Query(ge=1, le=31),
    year: int = Query(ge=2000, le=2200),
    month: int = Query(ge=1, le=12),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    if db.get(Mission, mission_id) is None:
        raise HTTPException(status_code=404, detail="Миссия не найдена")
    return world_service.window_preview(start_day, end_day, year, month)


@admin_router.patch(
    "/{mission_id}/settings/document-signing-window",
    response_model=MissionSettingRead,
)
def update_document_signing_window(
    mission_id: int,
    payload: DocumentSigningWindowUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    setting = world_service.publish_document_signing_window(
        db, mission_id, payload.model_dump(), user
    )
    db.commit()
    db.refresh(setting)
    return world_service.setting_payload(setting)


@admin_router.get(
    "/{mission_id}/settings/document-signing-window/preview",
    response_model=DocumentSigningWindowPreview,
)
def preview_document_signing_window(
    mission_id: int,
    start_day: int = Query(default=5, ge=1, le=31),
    end_day: int = Query(default=15, ge=1, le=31),
    year: int = Query(ge=2000, le=2200),
    month: int = Query(ge=1, le=12),
    exception_end_day: int | None = Query(default=None, ge=1, le=31),
    exception_year_month: str | None = Query(default=None, max_length=7),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("supervisor", "manager", "admin")),
):
    if db.get(Mission, mission_id) is None:
        raise HTTPException(status_code=404, detail="Миссия не найдена")
    return world_service.document_signing_preview(
        start_day,
        end_day,
        year,
        month,
        exception_end_day,
        exception_year_month,
    )


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
