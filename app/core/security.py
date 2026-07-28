from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime_utils import now_utc
from app.database.db import get_db
from app.models.entities import Operator, User, UserSession

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


class AccessScopeKind(StrEnum):
    UNRESTRICTED = "unrestricted"
    GROUP = "group"
    DENIED = "denied"


@dataclass(frozen=True, slots=True)
class AccessScope:
    kind: AccessScopeKind
    group_id: int | None = None

    @property
    def is_unrestricted(self) -> bool:
        return self.kind == AccessScopeKind.UNRESTRICTED


def resolve_access_scope(db: Session, user: User) -> AccessScope:
    """Return an explicit access decision; ``None`` is never used as a decision."""
    if user.role in {"admin", "manager"}:
        return AccessScope(AccessScopeKind.UNRESTRICTED)
    if user.role != "supervisor":
        return AccessScope(AccessScopeKind.DENIED)

    group_id = user.group_id
    if group_id is None and user.operator_id:
        operator = db.get(Operator, user.operator_id)
        group_id = operator.group_id if operator else None
    if group_id is None:
        return AccessScope(AccessScopeKind.DENIED)
    return AccessScope(AccessScopeKind.GROUP, group_id)


def require_group_scope(db: Session, user: User) -> AccessScope:
    """Resolve administrative scope and reject ambiguous/missing scope."""
    scope = resolve_access_scope(db, user)
    if scope.kind == AccessScopeKind.DENIED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ запрещён: для роли не назначена область доступа",
        )
    return scope


def require_operator_access(db: Session, user: User, operator: Operator) -> None:
    """Reject access to an operator outside the caller's resolved group."""
    scope = require_group_scope(db, user)
    if scope.kind == AccessScopeKind.GROUP and operator.group_id != scope.group_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Оператор находится вне вашей области доступа",
        )


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def supervisor_scope_group_id(db: Session, user: User) -> int | None:
    """group_id, если user — супервайзер, иначе None (без ограничения).

    Единая точка правды для «супервайзер видит/меняет только свою группу»
    (ТЗ 10.2). manager/admin — без ограничений. Группа берётся из User.group_id,
    а если он не заполнен — из привязанного Operator.group_id (тот же способ,
    что уже использовался для dismiss/restore в operators/router.py).

    Используется во всех местах, где supervisor работает с чужими операторами:
    /coins/*, /shop/purchases/*, GET /operators.
    """
    scope = require_group_scope(db, user)
    return scope.group_id if scope.kind == AccessScopeKind.GROUP else None


def create_access_token(subject: dict | str, role: str = "") -> str:
    settings = get_settings()
    expires = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    if isinstance(subject, dict):
        payload = {**subject, "exp": expires}
    else:
        payload = {"sub": subject, "role": role, "exp": expires}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _extract_token(request: Request, credentials: HTTPAuthorizationCredentials | None) -> str | None:
    """Try cookie first, then Authorization header (backward compat)."""
    cookie_token = request.cookies.get(get_settings().auth_cookie_name)
    if cookie_token:
        return cookie_token
    if credentials:
        return credentials.credentials
    return None


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = _extract_token(request, credentials)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")

    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub"))
    except (InvalidTokenError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный токен") from None

    session_id = payload.get("sid")
    if session_id:
        auth_session = db.scalar(
            select(UserSession).where(
                UserSession.session_id == str(session_id),
                UserSession.user_id == user_id,
            )
        )
        now = now_utc()
        idle_limit_minutes = settings.session_idle_timeout_minutes
        idle_expired = (
            idle_limit_minutes > 0
            and auth_session is not None
            and auth_session.last_seen_at is not None
            and auth_session.last_seen_at < now - timedelta(minutes=idle_limit_minutes)
        )
        if (
            not auth_session
            or auth_session.status != "active"
            or auth_session.revoked_at is not None
            or (auth_session.expires_at is not None and auth_session.expires_at < now)
            or idle_expired
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия завершена")
        request.state.session_id = auth_session.session_id
        request.state.auth_session_id = auth_session.id

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    if getattr(user, "must_change_password", False):
        # Admin / manager / supervisor никогда не блокируются флагом must_change_password.
        # Этот флаг предназначен только для операторов с временными паролями.
        if user.role not in ("admin", "manager", "supervisor"):
            settings = get_settings()
            path = request.url.path.rstrip("/")
            # Убираем query string если есть
            path = path.split("?")[0].rstrip("/")
            allowed_paths = {
                f"{settings.api_prefix}/auth/me",
                f"{settings.api_prefix}/auth/logout",
                f"{settings.api_prefix}/auth/me/password",
                f"{settings.api_prefix}/auth/account",
                f"{settings.api_prefix}/operators/account/change-password",
                f"{settings.api_prefix}/me/level",
                f"{settings.api_prefix}/operators/me",
            }
            if request.method != "OPTIONS" and path not in allowed_paths:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="Необходимо сменить временный пароль")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return user
    return dependency


def is_admin_role(user: User, roles: Iterable[str] = ("supervisor", "manager", "admin")) -> bool:
    return user.role in set(roles)
