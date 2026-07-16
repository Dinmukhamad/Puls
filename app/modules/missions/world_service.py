from __future__ import annotations

import calendar
import re
from datetime import date
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.models.entities import (
    LearningWorld,
    Mission,
    MissionSetting,
    Operator,
    OperatorMissionProgress,
    User,
)
from app.modules.missions.sapar_seed import WINDOW_SETTING_KEY

WORLD_AVAILABILITY = {"available", "coming_soon", "hidden"}
HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def is_day_allowed(day: int, start_day: int, end_day: int) -> bool:
    if not 1 <= day <= 31 or not 1 <= start_day <= 31 or not 1 <= end_day <= 31:
        raise ValueError("День должен быть в диапазоне 1–31")
    if start_day <= end_day:
        return start_day <= day <= end_day
    return day >= start_day or day <= end_day


def active_setting(db: Session, mission_id: int, key: str = WINDOW_SETTING_KEY) -> MissionSetting:
    row = db.scalar(
        select(MissionSetting)
        .where(
            MissionSetting.mission_id == mission_id,
            MissionSetting.key == key,
            MissionSetting.is_active.is_(True),
            MissionSetting.effective_from <= now_utc(),
        )
        .order_by(MissionSetting.version.desc())
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Активная настройка миссии не найдена")
    return row


def _mission_status(progress: OperatorMissionProgress | None, unlocked: bool) -> str:
    if progress and progress.status == "completed":
        return "completed"
    if progress and progress.status == "in_progress":
        return "in_progress"
    return "available" if unlocked else "locked"


def _world_payload(db: Session, operator: Operator, world: LearningWorld, *, include_missions: bool) -> dict[str, Any]:
    from app.modules.missions.service import _is_unlocked

    missions = db.scalars(
        select(Mission)
        .where(Mission.world_id == world.id, Mission.is_active.is_(True))
        .order_by(Mission.world_sort_order, Mission.sort_order, Mission.id)
    ).all()
    progress_rows = db.scalars(
        select(OperatorMissionProgress).where(
            OperatorMissionProgress.operator_id == operator.id,
            OperatorMissionProgress.mission_id.in_([row.id for row in missions] or [-1]),
        )
    ).all()
    progress_by_mission = {row.mission_id: row for row in progress_rows}
    cards = []
    completed = 0
    coins_available = 0
    for mission in missions:
        progress = progress_by_mission.get(mission.id)
        mission_status = _mission_status(progress, _is_unlocked(db, operator.id, mission))
        completed += int(mission_status == "completed")
        if not progress or not progress.reward_claimed:
            coins_available += mission.reward_coins
        cards.append(
            {
                "code": mission.code,
                "title": mission.title,
                "description": mission.description,
                "mission_type": mission.mission_type,
                "sort_order": mission.world_sort_order,
                "reward_coins": mission.reward_coins,
                "estimated_minutes": mission.estimated_minutes,
                "version": mission.version,
                "status": mission_status,
                "current_step_key": progress.current_step_key if progress else None,
                "attempts_count": progress.attempts_count if progress else 0,
                "reward_claimed": progress.reward_claimed if progress else False,
                "best_score": progress.best_score if progress else None,
                "completed_at": progress.completed_at if progress else None,
                "action_label": {"completed": "Пройти ещё раз", "in_progress": "Продолжить", "locked": "Недоступно"}.get(mission_status, "Начать"),
            }
        )
    total = len(missions)
    availability = world.availability
    if total == 0 and availability == "available":
        availability = "coming_soon"
    return {
        "id": world.id,
        "code": world.code,
        "title": world.title,
        "description": world.description,
        "icon": world.icon,
        "illustration_key": world.illustration_key,
        "accent_color": world.accent_color,
        "sort_order": world.sort_order,
        "availability": availability,
        "completed_count": completed,
        "total_count": total,
        "percent": round(completed / total * 100) if total else 0,
        "coins_available": coins_available,
        **({"missions": cards} if include_missions else {}),
    }


def worlds_map(db: Session, operator: Operator) -> dict[str, Any]:
    worlds = db.scalars(
        select(LearningWorld)
        .where(LearningWorld.is_active.is_(True), LearningWorld.availability != "hidden")
        .order_by(LearningWorld.sort_order, LearningWorld.id)
    ).all()
    items = [_world_payload(db, operator, world, include_missions=False) for world in worlds]
    return {
        "worlds": items,
        "completed": sum(item["completed_count"] for item in items),
        "total": sum(item["total_count"] for item in items),
        "percent": round(sum(item["completed_count"] for item in items) / max(1, sum(item["total_count"] for item in items)) * 100),
    }


def world_route(db: Session, operator: Operator, code: str) -> dict[str, Any]:
    world = db.scalar(select(LearningWorld).where(LearningWorld.code == code, LearningWorld.is_active.is_(True)))
    if world is None or world.availability == "hidden":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Территория не найдена")
    return _world_payload(db, operator, world, include_missions=True)


def admin_worlds(db: Session) -> list[LearningWorld]:
    return db.scalars(select(LearningWorld).order_by(LearningWorld.sort_order, LearningWorld.id)).all()


def create_world(db: Session, payload: dict[str, Any]) -> LearningWorld:
    code = str(payload.get("code", "")).strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{2,79}", code):
        raise HTTPException(status_code=422, detail="Некорректный код территории")
    if db.scalar(select(LearningWorld).where(LearningWorld.code == code)):
        raise HTTPException(status_code=409, detail="Такой код территории уже существует")
    world = LearningWorld(code=code)
    db.add(world)
    return update_world(world, payload)


def update_world(world: LearningWorld, payload: dict[str, Any]) -> LearningWorld:
    for key in ("title", "description", "icon", "illustration_key"):
        if key in payload:
            setattr(world, key, str(payload[key]).strip())
    if "accent_color" in payload:
        color = str(payload["accent_color"])
        if not HEX_COLOR.fullmatch(color):
            raise HTTPException(status_code=422, detail="Цвет должен быть в формате #RRGGBB")
        world.accent_color = color.upper()
    if "sort_order" in payload:
        world.sort_order = int(payload["sort_order"])
    if "is_active" in payload:
        world.is_active = bool(payload["is_active"])
    if "availability" in payload:
        availability = str(payload["availability"])
        if availability not in WORLD_AVAILABILITY:
            raise HTTPException(status_code=422, detail="Некорректная доступность территории")
        world.availability = availability
    return world


def assign_world(db: Session, mission_id: int, world_id: int, order: int) -> Mission:
    mission = db.get(Mission, mission_id)
    world = db.get(LearningWorld, world_id)
    if mission is None or world is None:
        raise HTTPException(status_code=404, detail="Миссия или территория не найдена")
    mission.world_id = world.id
    mission.world_sort_order = order
    return mission


def setting_list(db: Session, mission_id: int) -> list[MissionSetting]:
    return db.scalars(select(MissionSetting).where(MissionSetting.mission_id == mission_id).order_by(MissionSetting.key, MissionSetting.version.desc())).all()


def publish_window(db: Session, mission_id: int, payload: dict[str, Any], user: User) -> MissionSetting:
    mission = db.get(Mission, mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="Миссия не найдена")
    start_day = int(payload.get("start_day", 16))
    end_day = int(payload.get("end_day", 1))
    try:
        is_day_allowed(1, start_day, end_day)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    timezone = str(payload.get("timezone", "Asia/Almaty"))
    if timezone != "Asia/Almaty":
        raise HTTPException(status_code=422, detail="В MVP поддерживается таймзона Asia/Almaty")
    current_version = db.scalar(select(func.max(MissionSetting.version)).where(MissionSetting.mission_id == mission_id, MissionSetting.key == WINDOW_SETTING_KEY)) or 0
    db.query(MissionSetting).filter(MissionSetting.mission_id == mission_id, MissionSetting.key == WINDOW_SETTING_KEY, MissionSetting.is_active.is_(True)).update({MissionSetting.is_active: False})
    row = MissionSetting(
        mission_id=mission_id,
        key=WINDOW_SETTING_KEY,
        version=current_version + 1,
        value_json={
            "start_day": start_day,
            "end_day": end_day,
            "timezone": timezone,
            "is_active": bool(payload.get("is_active", True)),
            "operator_message": str(payload.get("operator_message") or "Проверьте разрешённый период смены провайдера."),
        },
        effective_from=payload.get("effective_from") or now_utc(),
        is_active=True,
        updated_by=user.id,
    )
    db.add(row)
    db.flush()
    return row


def window_preview(start_day: int, end_day: int, year: int, month: int) -> dict[str, Any]:
    if not 1 <= month <= 12 or not 2000 <= year <= 2200:
        raise HTTPException(status_code=422, detail="Некорректный месяц или год")
    try:
        is_day_allowed(1, start_day, end_day)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    days = calendar.monthrange(year, month)[1]
    items = [{"date": date(year, month, day).isoformat(), "allowed": is_day_allowed(day, start_day, end_day)} for day in range(1, days + 1)]
    return {"year": year, "month": month, "start_day": start_day, "end_day": end_day, "timezone": "Asia/Almaty", "days": items}


def setting_payload(row: MissionSetting) -> dict[str, Any]:
    return {
        "id": row.id,
        "mission_id": row.mission_id,
        "key": row.key,
        "value": row.value_json,
        "version": row.version,
        "effective_from": row.effective_from,
        "is_active": row.is_active,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at,
    }
