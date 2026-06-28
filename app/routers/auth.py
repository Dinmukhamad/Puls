from __future__ import annotations

import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_current_user, hash_password, require_roles, verify_password
from app.database.db import get_db
from app.models.entities import Operator, OperatorAuditLog, User
from app.schemas.auth import AccountCredentialsUpdate, LoginRequest, TokenResponse, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")
    if user.role == "operator" and user.operator_id:
        operator = db.get(Operator, user.operator_id)
        if operator and operator.status == "archive":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт оператора находится в архиве")
    return TokenResponse(access_token=create_access_token(str(user.id), user.role))


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.patch("/me/credentials", response_model=UserRead)
def update_my_credentials(
    payload: AccountCredentialsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    username = payload.username.strip() if payload.username is not None else ""
    wants_username = payload.username is not None and username != current_user.username
    wants_password = payload.new_password is not None or payload.repeat_password is not None

    if not wants_username and not wants_password:
        return current_user

    if wants_username:
        if not username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Логин не должен быть пустым.")
        if not re.fullmatch(r"[A-Za-z0-9_]+", username):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Логин может содержать только латинские буквы, цифры и символ _",
            )
        existing = db.scalar(select(User).where(User.username == username, User.id != current_user.id))
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Такой логин уже используется. Укажите другой логин.",
            )

    if wants_password:
        if payload.new_password != payload.repeat_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароли не совпадают.")
        if not payload.current_password or not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Текущий пароль указан неверно.")
        current_user.password_hash = hash_password(payload.new_password or "")
        if current_user.operator_id:
            db.add(OperatorAuditLog(
                operator_id=current_user.operator_id,
                action="password_changed",
                comment="Оператор изменил пароль",
                actor_user_id=current_user.id,
            ))

    if wants_username:
        old_username = current_user.username
        current_user.username = username
        if current_user.operator_id:
            db.add(OperatorAuditLog(
                operator_id=current_user.operator_id,
                action="username_changed",
                comment=f"Логин изменен: {old_username} -> {username}",
                actor_user_id=current_user.id,
            ))

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users", response_model=UserRead, dependencies=[Depends(require_roles("admin"))])
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    if payload.role not in {"operator", "supervisor", "manager", "admin"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимая роль")
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Логин уже занят")
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


@router.get("/users", response_model=List[UserRead], dependencies=[Depends(require_roles("admin"))])
def list_users(db: Session = Depends(get_db)) -> List[User]:
    return list(db.scalars(select(User).order_by(User.id.asc())))
