"""Сессии и журнал аудита с фильтрацией прав."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, DeveloperUser, PaginationDep, SessionDep
from app.core.errors import NotFoundError
from app.models.enums import Role
from app.models.session import LoginSession
from app.models.settings import AuditLog
from app.models.user import User
from app.schemas.common import Message, Page
from app.services.rules import write_audit
from app.services.sessions import is_valid, revoke_user_sessions

router = APIRouter(tags=["Сессии и аудит"])


class SessionOut(BaseModel):
    id: str
    user_id: int
    full_name: str
    login: str
    role: Role
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
        select(LoginSession, User.full_name, User.login, User.role)
        .join(User)
        .where(*conditions)
        .order_by(LoginSession.last_active_at.desc())
    )
    return [
        SessionOut(
            id=row.id,
            user_id=row.user_id,
            full_name=name,
            login=login,
            role=role,
            device=row.device,
            ip_address=row.ip_address,
            created_at=row.created_at,
            last_active_at=row.last_active_at,
            expires_at=row.expires_at,
            current=row.id == current,
        )
        for row, name, login, role in rows
    ]


@router.get("/me/sessions", response_model=list[SessionOut])
async def my_sessions(session: SessionDep, user: DeveloperUser, request: Request):
    return await _sessions(session, request.state.auth_session_id, user.id)


@router.get("/admin/sessions", response_model=list[SessionOut])
async def all_sessions(session: SessionDep, _: DeveloperUser, request: Request):
    return await _sessions(session, request.state.auth_session_id, None)


SessionId = Annotated[
    str, StringConstraints(strict=True, min_length=1, max_length=36, pattern=r"^\S+$")
]


class BulkSessionRevoke(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["selected", "user", "role", "all"]
    # IDs are the frozen set confirmed in the UI, even for a whole role or all users.
    session_ids: list[SessionId] = Field(min_length=1, max_length=5000)
    user_id: Annotated[int, Field(strict=True, gt=0)] | None = None
    role: Role | None = None
    keep_current: StrictBool = True

    @model_validator(mode="after")
    def validate_scope(self):
        if len(set(self.session_ids)) != len(self.session_ids):
            raise ValueError("Идентификаторы сессий не должны повторяться")
        if self.scope == "user":
            if self.user_id is None or "role" in self.model_fields_set:
                raise ValueError("Для пользователя нужен user_id без role")
        elif self.scope == "role":
            if self.role is None or "user_id" in self.model_fields_set:
                raise ValueError("Для роли нужен role без user_id")
        elif {"user_id", "role"} & self.model_fields_set:
            raise ValueError("Для выбранных или всех сессий критерии не допускаются")
        return self


class BulkSessionRevokeOut(BaseModel):
    revoked_count: int
    user_count: int
    current_revoked: bool
    detail: str


@router.post("/admin/sessions/revoke-bulk", response_model=BulkSessionRevokeOut)
async def revoke_bulk(
    session: SessionDep,
    user: DeveloperUser,
    request: Request,
    payload: BulkSessionRevoke,
):
    # Match only IDs the developer reviewed. New devices are never swept into a bulk action.
    candidate_user_ids = set(
        await session.scalars(
            select(LoginSession.user_id).where(LoginSession.id.in_(payload.session_ids))
        )
    )
    user_conditions = [User.id.in_(candidate_user_ids)]
    if payload.scope == "user":
        user_conditions.append(User.id == payload.user_id)
    elif payload.scope == "role":
        user_conditions.append(User.role == payload.role)

    # Keep the existing user -> session lock order used by password changes and driver QR.
    # The locked query reads the actual role, rather than trusting the client's old listing.
    # NO KEY UPDATE blocks role edits but permits FK checks from login/audit inserts.
    matched_user_ids = list(
        await session.scalars(
            select(User.id)
            .where(*user_conditions)
            .order_by(User.id)
            .with_for_update(key_share=True)
        )
    )
    now = datetime.now(UTC)
    current_id = request.state.auth_session_id
    conditions = [
        LoginSession.id.in_(payload.session_ids),
        LoginSession.user_id.in_(matched_user_ids),
        LoginSession.revoked_at.is_(None),
        LoginSession.expires_at > now,
    ]
    if payload.keep_current:
        conditions.append(LoginSession.id != current_id)
    records = [
        record
        for record in await session.scalars(
            select(LoginSession)
            .where(*conditions)
            .order_by(LoginSession.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if is_valid(record, record.user_id)
    ]
    now = datetime.now(UTC)
    for record in records:
        record.revoked_at = now

    affected_user_ids = sorted({record.user_id for record in records})
    revoked_ids = [record.id for record in records]
    current_revoked = current_id in revoked_ids
    await write_audit(
        session,
        actor_id=user.id,
        action="session.revoke_bulk",
        entity_type="session",
        payload={
            "scope": payload.scope,
            "user_id": payload.user_id,
            "role": payload.role.value if payload.role else None,
            "keep_current": payload.keep_current,
            "current_revoked": current_revoked,
            "revoked_count": len(records),
            "user_count": len(affected_user_ids),
            "user_ids": affected_user_ids,
            "session_ids": revoked_ids,
        },
        comment="Массовое завершение сессий",
    )
    await session.commit()
    return BulkSessionRevokeOut(
        revoked_count=len(records),
        user_count=len(affected_user_ids),
        current_revoked=current_revoked,
        detail=f"Завершено сессий: {len(records)}",
    )


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
