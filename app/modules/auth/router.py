from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime_utils import now_utc
from app.core.security import (
    create_access_token,
    dummy_password_hash,
    get_current_user,
    hash_password,
    require_roles,
    verify_password,
)
from app.database.db import get_db
from app.models.entities import AuditLog, User, UserSession
from app.modules.auth.rate_limit import login_rate_limiter
from app.modules.auth.schemas import (
    AccountCredentialsUpdate,
    LoginRequest,
    UserCreate,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else ""
    settings = get_settings()
    # Доверяем заголовкам прокси, если явно включено (PaaS) или источник — из
    # списка доверенных прокси. Иначе берём прямой IP, чтобы X-Forwarded-For
    # нельзя было подделать напрямую.
    if not (settings.trust_forwarded_for or direct_ip in settings.trusted_proxy_ip_list):
        return direct_ip
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    return forwarded or real_ip or direct_ip


def _device_info(user_agent: str) -> tuple[str, str, str]:
    low = (user_agent or "").lower()
    if "edg/" in low:
        browser = "Edge"
    elif "chrome" in low:
        browser = "Chrome"
    elif "firefox" in low:
        browser = "Firefox"
    elif "safari" in low:
        browser = "Safari"
    else:
        browser = "Browser"

    if "windows" in low:
        os_label = "Windows"
    elif "mac os" in low:
        os_label = "macOS"
    elif "iphone" in low or "ipad" in low:
        os_label = "iOS"
    elif "android" in low:
        os_label = "Android"
    elif "linux" in low:
        os_label = "Linux"
    else:
        os_label = "Unknown OS"

    device = "Mobile" if any(x in low for x in ("mobile", "iphone", "android")) else "Desktop"
    return f"{device} · {browser} · {os_label}", browser, os_label


# Браузеры и так ограничивают куки ~400 днями; для бессрочной сессии ставим
# этот максимум, а скользящее обновление на /me продлевает куку при каждом входе.
_COOKIE_MAX_AGE_UNLIMITED = 400 * 24 * 60 * 60


def _cookie_max_age(settings) -> int:
    minutes = settings.access_token_expire_minutes
    return minutes * 60 if minutes > 0 else _COOKIE_MAX_AGE_UNLIMITED


def _session_expires_at(now, settings):
    minutes = settings.access_token_expire_minutes
    return now + timedelta(minutes=minutes) if minutes > 0 else None


def _create_auth_session(db: Session, request: Request, user: User) -> UserSession:
    settings = get_settings()
    now = now_utc()
    user_agent = request.headers.get("user-agent") or ""
    device_label, browser_label, os_label = _device_info(user_agent)
    session = UserSession(
        session_id=uuid4().hex,
        user_id=user.id,
        ip_address=_client_ip(request),
        user_agent=user_agent[:4000],
        device_label=device_label,
        browser_label=browser_label,
        os_label=os_label,
        status="active",
        created_at=now,
        last_seen_at=now,
        expires_at=_session_expires_at(now, settings),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _set_auth_cookie(response: Response, user: User, session_id: str) -> None:
    token = create_access_token({"sub": str(user.id), "sid": session_id}, role=user.role)
    settings = get_settings()
    cookie_options = {
        "key": settings.auth_cookie_name,
        "value": token,
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite,
        "max_age": _cookie_max_age(settings),
        "path": "/",
    }
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.set_cookie(**cookie_options)
    csrf_token = uuid4().hex
    response.set_cookie(
        key="pulse_csrf_token",
        value=csrf_token,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=_cookie_max_age(settings),
        path="/",
    )


def _delete_auth_cookie(response: Response) -> None:
    settings = get_settings()
    cookie_options = {"key": settings.auth_cookie_name, "path": "/"}
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.delete_cookie(**cookie_options)
    response.delete_cookie(key="pulse_csrf_token", path="/")


def _revoke_user_sessions(db: Session, user: User, reason: str) -> None:
    now = now_utc()
    sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.status == "active",
        )
    )
    for session in sessions:
        session.status = "revoked"
        session.revoked_at = now
        session.revoked_by_user_id = user.id
        session.revoke_reason = reason


def _session_id_from_cookie(request: Request) -> str | None:
    settings = get_settings()
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except (InvalidTokenError, TypeError, ValueError):
        return None
    sid = payload.get("sid")
    return str(sid) if sid else None


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = _client_ip(request)
    retry_after = login_rate_limiter.retry_after(payload.username, client_ip)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много попыток входа. Повторите через {retry_after} сек.",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.scalar(select(User).where(User.username == payload.username))
    # Хеш сверяем всегда, даже если пользователя нет: иначе несуществующий
    # логин отвечает мгновенно, а существующий — после bcrypt, и по этой
    # разнице во времени собирают список валидных логинов.
    password_matches = verify_password(
        payload.password,
        user.password_hash if user else dummy_password_hash(),
    )
    if not user or not password_matches:
        login_rate_limiter.failure(payload.username, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Неверный логин или пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Аккаунт деактивирован")

    login_rate_limiter.success(payload.username, client_ip)
    session = _create_auth_session(db, request, user)
    _set_auth_cookie(response, user, session.session_id)
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Logout всегда работает — даже если JWT протух или невалиден."""
    sid = _session_id_from_cookie(request)
    if sid:
        session = db.scalar(select(UserSession).where(UserSession.session_id == sid))
        if session and session.status == "active":
            session.status = "revoked"
            session.revoked_at = now_utc()
            session.revoke_reason = "logout"
            db.commit()
    settings = get_settings()
    cookie_options = {"key": settings.auth_cookie_name, "path": "/"}
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.delete_cookie(**cookie_options)
    return {"ok": True}


@router.get("/me", response_model=UserRead)
def me(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    # Sliding session: each successful app start extends the HttpOnly cookie.
    sid = getattr(request.state, "session_id", None)
    session = db.scalar(select(UserSession).where(UserSession.session_id == sid)) if sid else None
    if session is None:
        session = _create_auth_session(db, request, current_user)
    else:
        now = now_utc()
        session.last_seen_at = now
        db.commit()
    _set_auth_cookie(response, current_user, session.session_id)
    return current_user



@router.post("/account", response_model=UserRead)
def update_account(
    payload: AccountCredentialsUpdate,
    response: Response,
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
        if len(payload.new_password or "") < 8:
            raise HTTPException(status_code=400, detail="Новый пароль должен содержать минимум 8 символов")
        if payload.new_password != payload.repeat_password:
            raise HTTPException(status_code=400, detail="Пароли не совпадают")
        if verify_password(payload.new_password or "", current_user.password_hash):
            raise HTTPException(status_code=400, detail="Новый пароль не должен совпадать со старым")
        current_user.password_hash = hash_password(payload.new_password or "")
        current_user.must_change_password = False
        _revoke_user_sessions(db, current_user, "password_changed")
        if current_user.operator_id:
            db.add(AuditLog(
                operator_id=current_user.operator_id,
                action="password_changed",
                comment="Оператор изменил пароль",
                actor_user_id=current_user.id,
            ))

    if wants_username:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Введите текущий пароль")
        if not wants_password and not verify_password(
            payload.current_password, current_user.password_hash
        ):
            raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
        old_username = current_user.username
        from app.modules.auth.credentials import validate_username

        username = validate_username(payload.username or "")
        existing = db.scalar(select(User).where(
            User.username == username, User.id != current_user.id
        ))
        if existing:
            raise HTTPException(status_code=409,
                                detail="Такой логин уже используется")
        current_user.username = username
        _revoke_user_sessions(db, current_user, "username_changed")
        if current_user.operator_id:
            db.add(AuditLog(
                operator_id=current_user.operator_id,
                action="username_changed",
                comment=f"Логин изменен: {old_username} -> {username}",
                actor_user_id=current_user.id,
            ))

    db.commit()
    db.refresh(current_user)
    if wants_password or wants_username:
        _delete_auth_cookie(response)
    return current_user


@router.patch("/me/login")
def change_my_login(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    response: Response = None,
) -> dict:
    """Change current user login. Requires current password verification."""
    import re as _re

    new_login   = (payload.get("new_login") or "").strip()
    current_pwd = payload.get("current_password") or ""

    if not new_login:
        raise HTTPException(status_code=400, detail="Логин не может быть пустым")
    if not _re.match(r'^[a-zA-Z0-9._]+$', new_login):
        raise HTTPException(status_code=400, detail="Логин может содержать только буквы, цифры, точку и нижнее подчёркивание")
    if len(new_login) < 3:
        raise HTTPException(status_code=400, detail="Логин должен быть не менее 3 символов")
    if not verify_password(current_pwd, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")

    existing = db.scalar(select(User).where(User.username == new_login, User.id != current_user.id))
    if existing:
        raise HTTPException(status_code=409, detail="Этот логин уже занят. Выберите другой.")

    old_login = current_user.username
    current_user.username = new_login
    _revoke_user_sessions(db, current_user, "username_changed")
    db.add(AuditLog(
        action="login_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Логин изменён: {old_login} → {new_login}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    if response is not None:
        _delete_auth_cookie(response)
    return {"ok": True, "message": "Логин успешно изменён", "new_login": new_login}


@router.patch("/me/password")
def change_my_password(
    payload: dict,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Change current user password. Logs out after change."""
    current_pwd = payload.get("current_password") or ""
    new_pwd     = payload.get("new_password") or ""
    confirm_pwd = payload.get("confirm_password") or ""

    if not verify_password(current_pwd, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    if len(new_pwd) < 8:
        raise HTTPException(status_code=400, detail="Новый пароль должен содержать минимум 8 символов")
    if new_pwd != confirm_pwd:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    if verify_password(new_pwd, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Новый пароль не должен совпадать со старым")

    current_user.password_hash = hash_password(new_pwd)
    current_user.must_change_password = False
    _revoke_user_sessions(db, current_user, "password_changed")
    db.add(AuditLog(
        action="password_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Пароль изменён пользователем {current_user.username}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    # Clear auth cookie → force re-login
    _delete_auth_cookie(response)
    return {"ok": True, "message": "Пароль изменён. Войдите снова.", "logout": True}


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
        must_change_password=payload.must_change_password,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.id)))
