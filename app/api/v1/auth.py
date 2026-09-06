"""Аутентификация: вход по логину и паролю, обновление токена, свой профиль."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import CurrentUser, SessionDep
from app.core.security import (
    decode_token,
    hash_password,
    verify_password,
)
from app.models.session import LoginSession
from app.models.user import User
from app.schemas.common import Message
from app.schemas.user import PasswordChange, RefreshRequest, Token, UserOut
from app.services.rules import write_audit
from app.services.sessions import (
    is_valid,
    new_session,
    revoke_user_sessions,
    secret_hash,
    session_tokens,
)

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Неверный логин или пароль",
    headers={"WWW-Authenticate": "Bearer"},
)


@router.post("/login", response_model=Token, summary="Вход в систему")
async def login(
    session: SessionDep,
    request: Request,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    user = await session.scalar(select(User).where(User.login == form.username))
    if user is None or not verify_password(form.password, user.hashed_password):
        raise _INVALID_CREDENTIALS
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена"
        )
    token = await new_session(session, user.id, request)
    await write_audit(session, actor_id=user.id, action="auth.login", entity_type="session")
    await session.commit()
    return token


@router.post("/refresh", response_model=Token, summary="Обновить пару токенов")
async def refresh(session: SessionDep, payload: RefreshRequest) -> Token:
    try:
        claims = decode_token(payload.refresh_token, "refresh")
        user_id = int(claims["sub"])
        session_id, secret = str(claims["sid"]), str(claims["jti"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен"
        ) from exc

    user = await session.get(User, user_id)
    record = await session.get(LoginSession, session_id)
    if user is None or not user.is_active or not is_valid(record, user_id):
        raise _INVALID_CREDENTIALS
    assert record is not None
    new_secret = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    rotated = await session.execute(
        update(LoginSession)
        .where(
            LoginSession.id == session_id,
            LoginSession.refresh_hash == secret_hash(secret),
            LoginSession.revoked_at.is_(None),
        )
        .values(
            refresh_hash=secret_hash(new_secret),
            last_active_at=now,
            expires_at=now + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS),
        )
    )
    if rotated.rowcount != 1:
        raise _INVALID_CREDENTIALS
    token = session_tokens(record, new_secret)
    await session.commit()
    return token


@router.get("/me", response_model=UserOut, summary="Профиль текущего пользователя")
async def me(session: SessionDep, user: CurrentUser) -> User:
    loaded = await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user.id)
    )
    return loaded or user


@router.post("/password", response_model=Message, summary="Сменить свой пароль")
async def change_password(
    session: SessionDep,
    user: CurrentUser,
    payload: PasswordChange,
    request: Request,
) -> Message:
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Текущий пароль неверен"
        )
    user.hashed_password = hash_password(payload.password)
    await revoke_user_sessions(session, user.id, except_id=request.state.auth_session_id)
    await write_audit(
        session,
        actor_id=user.id,
        action="user.password_change",
        entity_type="user",
        entity_id=user.id,
    )
    await session.commit()
    return Message(detail="Пароль обновлён. Остальные сеансы завершены.")


@router.post("/logout", response_model=Message, summary="Завершить текущую сессию")
async def logout(session: SessionDep, user: CurrentUser, request: Request) -> Message:
    record = await session.get(LoginSession, request.state.auth_session_id)
    assert record is not None
    record.revoked_at = datetime.now(UTC)
    await write_audit(session, actor_id=user.id, action="auth.logout", entity_type="session")
    await session.commit()
    return Message(detail="Сессия завершена")
