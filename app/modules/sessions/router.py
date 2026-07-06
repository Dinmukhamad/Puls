from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc, to_local_iso
from app.core.security import get_current_user, require_roles
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
    return {
        "id": session.id,
        "session_id": session.session_id,
        "is_current": session.session_id == current_session_id,
        "status": status,
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
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> dict:
    now = now_utc()
    current_session_id = getattr(request.state, "session_id", None)
    limit = max(1, min(limit, 500))

    stmt = select(UserSession).join(User).order_by(UserSession.last_seen_at.desc())
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

    sessions = db.scalars(stmt.limit(limit)).all()
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

    return {
        "items": [_session_payload(s, current_session_id) for s in sessions],
        "stats": {
            "active": active_count,
            "revoked": revoked_count,
            "expired": expired_count,
            "shown": len(sessions),
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
