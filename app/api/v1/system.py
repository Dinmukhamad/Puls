"""Сессии и журнал аудита с фильтрацией прав."""

from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, DeveloperUser, PaginationDep, SessionDep
from app.core.errors import NotFoundError
from app.models.session import LoginSession
from app.models.settings import AuditLog
from app.models.user import User
from app.schemas.common import Message, Page
from app.services.rules import write_audit
from app.services.sessions import revoke_user_sessions

router = APIRouter(tags=["Сессии и аудит"])


class SessionOut(BaseModel):
    id: str
    user_id: int
    full_name: str
    device: str
    ip_address: str | None
    created_at: datetime
    last_active_at: datetime
    expires_at: datetime
    current: bool


async def _sessions(session: SessionDep, current: str, user_id: int | None) -> list[SessionOut]:
    conditions = [LoginSession.revoked_at.is_(None), LoginSession.expires_at > datetime.now(UTC)]
    if user_id is not None:
        conditions.append(LoginSession.user_id == user_id)
    rows = await session.execute(
        select(LoginSession, User.full_name)
        .join(User)
        .where(*conditions)
        .order_by(LoginSession.last_active_at.desc())
    )
    return [
        SessionOut(
            id=row.id,
            user_id=row.user_id,
            full_name=name,
            device=row.device,
            ip_address=row.ip_address,
            created_at=row.created_at,
            last_active_at=row.last_active_at,
            expires_at=row.expires_at,
            current=row.id == current,
        )
        for row, name in rows
    ]


@router.get("/me/sessions", response_model=list[SessionOut])
async def my_sessions(session: SessionDep, user: DeveloperUser, request: Request):
    return await _sessions(session, request.state.auth_session_id, user.id)


@router.get("/admin/sessions", response_model=list[SessionOut])
async def all_sessions(session: SessionDep, _: DeveloperUser, request: Request):
    return await _sessions(session, request.state.auth_session_id, None)


@router.post("/me/sessions/revoke-others", response_model=Message)
async def revoke_others(session: SessionDep, user: DeveloperUser, request: Request):
    await revoke_user_sessions(session, user.id, except_id=request.state.auth_session_id)
    await write_audit(
        session,
        actor_id=user.id,
        action="session.revoke_others",
        entity_type="user",
        entity_id=user.id,
    )
    await session.commit()
    return Message(detail="Остальные сеансы завершены")


async def _revoke(session: SessionDep, actor: User, session_id: str, own_only: bool):
    record = await session.get(LoginSession, session_id)
    if record is None or (own_only and record.user_id != actor.id):
        raise NotFoundError("Сессия не найдена")
    record.revoked_at = datetime.now(UTC)
    await write_audit(
        session,
        actor_id=actor.id,
        action="session.revoke",
        entity_type="user",
        entity_id=record.user_id,
        comment="Сеанс завершён",
    )
    await session.commit()
    return Message(detail="Сессия завершена")


@router.post("/me/sessions/{session_id}/revoke", response_model=Message)
async def revoke_mine(session: SessionDep, user: DeveloperUser, session_id: str):
    return await _revoke(session, user, session_id, True)


@router.post("/admin/sessions/{session_id}/revoke", response_model=Message)
async def revoke_any(session: SessionDep, user: DeveloperUser, session_id: str):
    return await _revoke(session, user, session_id, False)


class AuditOut(BaseModel):
    id: int
    created_at: datetime
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: str | None
    changes: dict | None
    comment: str | None
    ip_address: str | None


@router.get("/admin/audit", response_model=Page[AuditOut])
async def audit(
    session: SessionDep,
    _: AdminUser,
    pagination: PaginationDep,
    action: str | None = None,
    entity_type: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    conditions = []
    if action:
        conditions.append(AuditLog.action.ilike(f"%{action}%"))
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if date_from:
        conditions.append(AuditLog.created_at >= date_from)
    if date_to:
        conditions.append(AuditLog.created_at <= date_to)
    total = int(await session.scalar(select(func.count(AuditLog.id)).where(*conditions)) or 0)
    rows = await session.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(*conditions)
        .order_by(AuditLog.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [
        AuditOut(
            id=row.id,
            created_at=row.created_at,
            actor_name=row.actor.full_name if row.actor else None,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            changes=row.payload,
            comment=row.comment,
            ip_address=row.ip_address,
        )
        for row in rows
    ]
    return Page.build(items, total, pagination.page, pagination.size)
