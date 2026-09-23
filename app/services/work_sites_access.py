"""Opaque, expiring QR challenges; approval never grants additional section permissions."""

import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import PermissionDeniedError
from app.models.enums import Role
from app.models.session import LoginSession
from app.models.user import User
from app.models.work_sites_access import WorkSitesAccess
from app.services.access import effective_access
from app.services.rules import write_audit
from app.services.sessions import is_valid, secret_hash

QR_PREFIX = "puls:work-sites:"
QR_LIFETIME = timedelta(minutes=5)


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def has_grant(session, session_id):
    return (
        await session.scalar(
            select(WorkSitesAccess.approved_at).where(WorkSitesAccess.session_id == session_id)
        )
        is not None
    )


async def status(session, user, session_id):
    required = user.role == Role.OPERATOR
    row = await session.get(WorkSitesAccess, session_id) if required else None
    return {
        "required": required,
        "granted": not required or bool(row and row.approved_at),
        "pending_until": utc(row.expires_at)
        if row and not row.approved_at and utc(row.expires_at) > datetime.now(UTC)
        else None,
    }


async def issue(session, user, session_id):
    if user.role != Role.OPERATOR:
        raise PermissionDeniedError("Для вашей роли QR-подтверждение не требуется")
    # Serialize regeneration with approval on the same browser session.
    await session.scalar(
        select(LoginSession).where(LoginSession.id == session_id).with_for_update()
    )
    row = await session.get(WorkSitesAccess, session_id)
    now = datetime.now(UTC)
    if row and row.approved_at:
        return {"granted": True, "payload": None, "expires_at": None}
    if row and utc(row.requested_at) > now - timedelta(seconds=3):
        raise HTTPException(429, "Подождите несколько секунд перед созданием нового QR")
    token = secrets.token_urlsafe(32)
    if row is None:
        row = WorkSitesAccess(session_id=session_id)
        session.add(row)
    row.token_hash = secret_hash(token)
    row.requested_at = now
    row.expires_at = now + QR_LIFETIME
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "QR уже обновляется. Попробуйте ещё раз.") from None
    return {"granted": False, "payload": QR_PREFIX + token, "expires_at": utc(row.expires_at)}


def token_digest(payload):
    if not re.fullmatch(re.escape(QR_PREFIX) + r"[A-Za-z0-9_-]{43}", payload):
        raise HTTPException(422, "Это не QR-код доступа к Рабочим сайтам Puls")
    return secret_hash(payload[len(QR_PREFIX) :])


async def resolve(session, payload, *, lock=False):
    digest = token_digest(payload)
    row = await session.scalar(select(WorkSitesAccess).where(WorkSitesAccess.token_hash == digest))
    invalid = HTTPException(
        410, "QR истёк, уже использован или заменён. Попросите оператора создать новый."
    )
    if row is None:
        raise invalid
    query = select(LoginSession).where(LoginSession.id == row.session_id)
    login_session = await session.scalar(query.with_for_update() if lock else query)
    # Regeneration may have occurred while approval waited on the session lock.
    await session.refresh(row)
    if row.token_hash != digest or row.approved_at or utc(row.expires_at) <= datetime.now(UTC):
        raise invalid
    user = (
        await session.scalar(select(User).where(User.id == login_session.user_id))
        if login_session
        else None
    )
    if (
        not user
        or not user.is_active
        or user.role != Role.OPERATOR
        or not is_valid(login_session, user.id)
    ):
        raise invalid
    if not (await effective_access(session, user))["allowed"].get("training"):
        raise PermissionDeniedError(
            "Доступ оператора к обучению закрыт. QR не изменяет права аккаунта.",
            code="section_denied",
        )
    return row, login_session, user


def recipient(row, login_session, user):
    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "login": user.login,
        "device": login_session.device,
        "requested_at": utc(row.requested_at),
        "expires_at": utc(row.expires_at),
        "section": "Рабочие сайты",
    }


async def preview(session, payload):
    return recipient(*await resolve(session, payload))


async def approve(session, actor, payload):
    row, login_session, user = await resolve(session, payload, lock=True)
    result = await session.execute(
        update(WorkSitesAccess)
        .where(
            WorkSitesAccess.session_id == row.session_id,
            WorkSitesAccess.token_hash == token_digest(payload),
            WorkSitesAccess.approved_at.is_(None),
            WorkSitesAccess.expires_at > datetime.now(UTC),
        )
        .values(token_hash=None, approved_at=datetime.now(UTC), approved_by_id=actor.id)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(410, "QR уже использован или заменён. Создайте новый.")
    await write_audit(
        session,
        actor_id=actor.id,
        action="work_sites.approve",
        entity_type="user",
        entity_id=user.id,
        payload={"section": "work_sites", "session_id": login_session.id},
    )
    await session.commit()
    return {"granted": True, "user_id": user.id, "full_name": user.full_name}
