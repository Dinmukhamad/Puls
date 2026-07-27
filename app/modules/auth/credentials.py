from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.core.security import hash_password, verify_password
from app.models.entities import User, UserSession

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._]{3,120}$")


def validate_username(value: str) -> str:
    username = value.strip()
    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="Логин: 3–120 символов, только латиница, цифры, точка и _",
        )
    return username


def verify_current_password(user: User, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")


def revoke_all_sessions(db: Session, user: User, reason: str) -> None:
    moment = now_utc()
    for session in db.scalars(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.status == "active",
        )
    ):
        session.status = "revoked"
        session.revoked_at = moment
        session.revoked_by_user_id = user.id
        session.revoke_reason = reason


def change_password(
    db: Session,
    user: User,
    *,
    current_password: str,
    new_password: str,
    confirmation: str,
) -> None:
    verify_current_password(user, current_password)
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Новый пароль должен содержать минимум 8 символов")
    if new_password != confirmation:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Новый пароль не должен совпадать со старым")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    revoke_all_sessions(db, user, "password_changed")


def change_username(
    db: Session,
    user: User,
    *,
    current_password: str,
    new_username: str,
) -> tuple[str, str]:
    verify_current_password(user, current_password)
    username = validate_username(new_username)
    existing = db.scalar(
        select(User).where(User.username == username, User.id != user.id)
    )
    if existing:
        raise HTTPException(status_code=409, detail="Такой логин уже используется")
    previous = user.username
    user.username = username
    revoke_all_sessions(db, user, "username_changed")
    return previous, username
