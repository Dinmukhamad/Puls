"""Аутентификация: вход по логину и паролю, обновление токена, свой профиль."""
from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import CurrentUser, SessionDep
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.common import Message
from app.schemas.user import PasswordChange, RefreshRequest, Token, UserOut

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Неверный логин или пароль",
    headers={"WWW-Authenticate": "Bearer"},
)


def _issue(user: User) -> Token:
    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        expires_in=settings.ACCESS_TOKEN_TTL_MINUTES * 60,
    )


@router.post("/login", response_model=Token, summary="Вход в систему")
async def login(
    session: SessionDep,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    user = await session.scalar(select(User).where(User.login == form.username))
    if user is None or not verify_password(form.password, user.hashed_password):
        raise _INVALID_CREDENTIALS
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена"
        )
    return _issue(user)


@router.post("/refresh", response_model=Token, summary="Обновить пару токенов")
async def refresh(session: SessionDep, payload: RefreshRequest) -> Token:
    try:
        claims = decode_token(payload.refresh_token, "refresh")
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен"
        ) from exc

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise _INVALID_CREDENTIALS
    return _issue(user)


@router.get("/me", response_model=UserOut, summary="Профиль текущего пользователя")
async def me(session: SessionDep, user: CurrentUser) -> User:
    loaded = await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user.id)
    )
    return loaded or user


@router.post("/password", response_model=Message, summary="Сменить свой пароль")
async def change_password(
    session: SessionDep, user: CurrentUser, payload: PasswordChange
) -> Message:
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Текущий пароль неверен"
        )
    user.hashed_password = hash_password(payload.password)
    await session.commit()
    return Message(detail="Пароль обновлён")
