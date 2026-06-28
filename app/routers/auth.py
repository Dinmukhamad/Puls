from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    create_access_token, get_current_user, hash_password,
    require_roles, verify_password,
)
from app.database.db import get_db
from app.models.entities import AuditLog, Operator, User
from app.schemas.auth import (
    AccountCredentialsUpdate, LoginRequest, TokenResponse,
    UserCreate, UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Неверный логин или пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Аккаунт деактивирован")

    token = create_access_token({"sub": str(user.id)}, role=user.role)

    settings = get_settings()
    response.set_cookie(
        key="pulse_access_token",
        value=token,
        httponly=True,
        secure=getattr(settings, 'auth_cookie_secure', False),
        samesite=getattr(settings, 'auth_cookie_samesite', 'lax'),
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    return {"ok": True, "access_token": token, "token_type": "bearer"}


@router.post("/logout")
def logout(response: Response, current_user: User = Depends(get_current_user)):
    response.delete_cookie(key="pulse_access_token", path="/")
    return {"ok": True}


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/account", response_model=UserRead)
def update_account(
    payload: AccountCredentialsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    wants_password = bool(payload.new_password)
    wants_username = bool(payload.username and payload.username != current_user.username)

    if wants_password:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Введите текущий пароль")
        if not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
        if payload.new_password != payload.repeat_password:
            raise HTTPException(status_code=400, detail="Пароли не совпадают")
        current_user.password_hash = hash_password(payload.new_password or "")
        if current_user.operator_id:
            db.add(AuditLog(
                operator_id=current_user.operator_id,
                action="password_changed",
                comment="Оператор изменил пароль",
                actor_user_id=current_user.id,
            ))

    if wants_username:
        old_username = current_user.username
        username = payload.username
        existing = db.scalar(select(User).where(
            User.username == username, User.id != current_user.id
        ))
        if existing:
            raise HTTPException(status_code=409,
                                detail="Такой логин уже используется")
        current_user.username = username
        if current_user.operator_id:
            db.add(AuditLog(
                operator_id=current_user.operator_id,
                action="username_changed",
                comment=f"Логин изменен: {old_username} -> {username}",
                actor_user_id=current_user.id,
            ))

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users", response_model=UserRead)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> User:
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь уже существует")
    user = User(
        full_name=payload.full_name,
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        operator_id=payload.operator_id,
        can_manage_operators=payload.can_manage_operators,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=List[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> List[User]:
    return list(db.scalars(select(User).order_by(User.id)))
