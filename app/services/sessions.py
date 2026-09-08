"""Выпуск, проверка и отзыв серверных сессий."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.driver_auth import DriverDevice
from app.models.session import LoginSession
from app.models.user import User
from app.schemas.user import Token


def secret_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def is_valid(record: LoginSession | None, user_id: int) -> bool:
    if record is None or record.user_id != user_id or record.revoked_at is not None:
        return False
    expiry = record.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return expiry > datetime.now(UTC)


def session_tokens(record: LoginSession, secret: str) -> Token:
    return Token(
        access_token=create_access_token(record.user_id, session_id=record.id),
        refresh_token=create_refresh_token(record.user_id, session_id=record.id, secret=secret),
        expires_in=settings.ACCESS_TOKEN_TTL_MINUTES * 60,
    )


async def new_session(session: AsyncSession, user_id: int, request: Request) -> Token:
    now = datetime.now(UTC)
    secret = secrets.token_urlsafe(32)
    record = LoginSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        refresh_hash=secret_hash(secret),
        device=request.headers.get("user-agent", "Неизвестное устройство")[:255],
        ip_address=request.client.host[:64] if request.client else None,
        last_active_at=now,
        expires_at=now + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS),
    )
    session.add(record)
    await session.flush()
    return session_tokens(record, secret)


async def revoke_user_sessions(
    session: AsyncSession,
    user_id: int,
    except_id: str | None = None,
) -> None:
    # Общий порядок блокировок с подтверждением кода: сначала пользователь.
    await session.scalar(select(User.id).where(User.id == user_id).with_for_update())
    await session.execute(delete(DriverDevice).where(DriverDevice.user_id == user_id))
    conditions = [LoginSession.user_id == user_id, LoginSession.revoked_at.is_(None)]
    if except_id:
        conditions.append(LoginSession.id != except_id)
    await session.execute(
        update(LoginSession).where(*conditions).values(revoked_at=datetime.now(UTC))
    )
