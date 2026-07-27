from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.datetime_utils import now_utc, to_local_iso
from app.core.security import require_roles
from app.database.db import get_db
from app.models.entities import User, UserSession

router = APIRouter(prefix="/admin/sessions", tags=["admin-sessions"])


class RevokeUserSessionsRequest(BaseModel):
    user_id: int
    exclude_current: bool = True


def _session_payload(session: UserSession, current_session_id: str | None) -> dict:
    user = session.user
    status = session.status
    if status == "active" and session.expires_at is not None and session.expires_at < now_utc():
        status = "expired"
    now = now_utc()
    if session.session_id == current_session_id:
        activity_state = "current"
    elif status in {"revoked", "expired"}:
        activity_state = "ended"
    elif session.last_seen_at and session.last_seen_at >= now - timedelta(minutes=15):
        activity_state = "active"
    elif session.last_seen_at and session.last_seen_at >= now - timedelta(hours=24):
        activity_state = "recent"
    else:
        activity_state = "inactive"
    return {
        "id": session.id,
        "session_id": session.session_id,
        "is_current": session.session_id == current_session_id,
        "status": status,
        "activity_state": activity_state,
        "user_id": session.user_id,
        "user_name": user.full_name if user else "",
        "username": user.username if user else "",
        "role": user.role if user else "",
        "ip_address": session.ip_address,
        "device_label": session.device_label,
        "browser_label": session.browser_label,
        "os_label": session.os_label,
        "user_agent": session.user_agent,
        "created_at": to_local_iso(session.created_at),
        "last_seen_at": to_local_iso(session.last_seen_at),
        "expires_at": to_local_iso(session.expires_at),
        "revoked_at": to_local_iso(session.revoked_at),
        "revoke_reason": session.revoke_reason,
        "revoked_by": session.revoked_by.full_name if session.revoked_by else "",
    }


@router.get("")
def list_sessions(
    request: Request,
    status: str = "active",
    q: str = "",
    role: str = "all",
    device: str = "all",
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> dict:
    now = now_utc()
    current_session_id = getattr(request.state, "session_id", None)
    limit = max(1, min(limit, 500))

    # Признак мобильного устройства выводим из device_label — он формируется при
    # логине и всегда начинается с "Mobile" или "Desktop" (см. auth/router._device_info),
    # плюс подстраховываемся по OS/строке UA. Отдельного поля в БД нет и не нужно.
    mobile_markers = ("mobile", "iphone", "ipad", "android", "ios")

    def _is_mobile(session: UserSession) -> bool:
        haystack = f"{session.device_label or ''} {session.os_label or ''} {session.user_agent or ''}".lower()
        return any(m in haystack for m in mobile_markers)

    stmt = (
        select(UserSession)
        .join(UserSession.user)
        .options(
            selectinload(UserSession.user),
            selectinload(UserSession.revoked_by),
        )
        .order_by(UserSession.last_seen_at.desc())
    )
    if status and status != "all":
        if status == "expired":
            stmt = stmt.where(UserSession.expires_at.is_not(None), UserSession.expires_at < now)
        elif status == "active":
            stmt = stmt.where(
                UserSession.status == "active",
                or_(UserSession.expires_at.is_(None), UserSession.expires_at >= now),
            )
        else:
            stmt = stmt.where(UserSession.status == status)
    if role and role != "all":
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.full_name.ilike(like),
                User.username.ilike(like),
                User.role.ilike(like),
                UserSession.ip_address.ilike(like),
                UserSession.device_label.ilike(like),
                UserSession.browser_label.ilike(like),
                UserSession.os_label.ilike(like),
            )
        )

    # Фильтр по типу устройства применяем в Python (а не в SQL) — device_label
    # это уже собранная человекочитаемая строка, и разбирать её через ilike было бы
    # хрупко. Берём чуть больше строк из БД, затем фильтруем и режем до limit.
    fetched = db.scalars(stmt.limit(limit * 3 if device in ("pc", "mobile") else limit)).all()
    if device == "mobile":
        fetched = [s for s in fetched if _is_mobile(s)]
    elif device == "pc":
        fetched = [s for s in fetched if not _is_mobile(s)]
    sessions = fetched[:limit]
    active_count = db.scalar(
        select(func.count()).select_from(UserSession).where(
            UserSession.status == "active",
            or_(UserSession.expires_at.is_(None), UserSession.expires_at >= now),
        )
    ) or 0
    revoked_count = db.scalar(
        select(func.count()).select_from(UserSession).where(UserSession.status == "revoked")
    ) or 0
    expired_count = db.scalar(
        select(func.count()).select_from(UserSession).where(
            UserSession.expires_at.is_not(None),
            UserSession.expires_at < now,
        )
    ) or 0

    # Разбивка активных сессий по ролям и типу устройства — для фильтров-вкладок
    # и счётчиков «Все / ПК / Телефон». Считаем по тем же критериям активности.
    active_filter = (
        UserSession.status == "active",
        or_(UserSession.expires_at.is_(None), UserSession.expires_at >= now),
    )
    role_rows = db.execute(
        select(User.role, func.count(UserSession.id))
        .select_from(UserSession).join(UserSession.user)
        .where(*active_filter).group_by(User.role)
    ).all()
    by_role = {r: c for r, c in role_rows}
    total_users = db.scalar(
        select(func.count(func.distinct(UserSession.user_id))).where(*active_filter)
    ) or 0

    # Тип устройства по активным сессиям — тоже в Python по device_label/OS/UA.
    active_sessions_for_device = db.scalars(
        select(UserSession).where(*active_filter)
    ).all()
    mobile_count = sum(1 for s in active_sessions_for_device if _is_mobile(s))
    pc_count = len(active_sessions_for_device) - mobile_count
    active_now = sum(
        1
        for session in active_sessions_for_device
        if session.last_seen_at and session.last_seen_at >= now - timedelta(minutes=15)
    )
    last_24h = db.scalar(
        select(func.count()).select_from(UserSession).where(
            UserSession.last_seen_at >= now - timedelta(hours=24)
        )
    ) or 0
    devices = {
        (session.user_id, session.device_label, session.browser_label, session.os_label)
        for session in active_sessions_for_device
    }
    active_by_user: dict[int, int] = {}
    for session in active_sessions_for_device:
        active_by_user[session.user_id] = active_by_user.get(session.user_id, 0) + 1
    suspicious = sum(1 for count in active_by_user.values() if count >= 5)

    return {
        "items": [_session_payload(s, current_session_id) for s in sessions],
        "stats": {
            "active": active_count,
            "active_now": active_now,
            "last_24h": last_24h,
            "suspicious": suspicious,
            "total_devices": len(devices),
            "revoked": revoked_count,
            "expired": expired_count,
            "shown": len(sessions),
            "total_users": total_users,
            "by_role": {
                "admin": by_role.get("admin", 0),
                "supervisor": by_role.get("supervisor", 0),
                "operator": by_role.get("operator", 0),
            },
            "by_device": {"pc": pc_count, "mobile": mobile_count},
        },
    }


@router.post("/{session_id}/revoke")
def revoke_session(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
) -> dict:
    current_session_id = getattr(request.state, "session_id", None)
    if session_id == current_session_id:
        raise HTTPException(status_code=400, detail="Нельзя сбросить текущую сессию администратора")

    session = db.scalar(select(UserSession).where(UserSession.session_id == session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if session.status != "revoked":
        session.status = "revoked"
        session.revoked_at = now_utc()
        session.revoked_by_user_id = admin.id
        session.revoke_reason = "admin_revoke"
        db.commit()
    return {"ok": True}


@router.post("/revoke-user")
def revoke_user_sessions(
    payload: RevokeUserSessionsRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
) -> dict:
    current_session_id = getattr(request.state, "session_id", None)
    stmt = select(UserSession).where(
        UserSession.user_id == payload.user_id,
        UserSession.status == "active",
    )
    sessions = db.scalars(stmt).all()
    now = now_utc()
    count = 0
    for session in sessions:
        if payload.exclude_current and session.session_id == current_session_id:
            continue
        session.status = "revoked"
        session.revoked_at = now
        session.revoked_by_user_id = admin.id
        session.revoke_reason = "admin_revoke_user"
        count += 1
    db.commit()
    return {"ok": True, "revoked": count}
