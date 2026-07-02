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
    AccountCredentialsUpdate, LoginRequest,
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
    cookie_options = {
        "key": settings.auth_cookie_name,
        "value": token,
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite,
        "max_age": settings.access_token_expire_minutes * 60,
        "path": "/",
    }
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.set_cookie(**cookie_options)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response, current_user: User = Depends(get_current_user)):
    settings = get_settings()
    cookie_options = {"key": settings.auth_cookie_name, "path": "/"}
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.delete_cookie(**cookie_options)
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
        current_user.must_change_password = False
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


@router.patch("/me/login")
def change_my_login(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    response: Response = None,
) -> dict:
    """Change current user login. Requires current password verification."""
    from pydantic import BaseModel
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
    db.add(AuditLog(
        action="login_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Логин изменён: {old_login} → {new_login}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    return {"ok": True, "message": "Логин успешно изменён", "new_login": new_login}


@router.patch("/me/password")
def change_my_password(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    response: Response = None,
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
    db.add(AuditLog(
        action="password_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Пароль изменён пользователем {current_user.username}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    # Clear auth cookie → force re-login
    settings = get_settings()
    if response:
        response.delete_cookie(key=settings.auth_cookie_name, path="/")
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


@router.get("/users", response_model=List[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> List[User]:
    return list(db.scalars(select(User).order_by(User.id)))
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
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
    AccountCredentialsUpdate, LoginRequest,
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
    cookie_options = {
        "key": settings.auth_cookie_name,
        "value": token,
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite,
        "max_age": settings.access_token_expire_minutes * 60,
        "path": "/",
    }
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.set_cookie(**cookie_options)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response, db: Session = Depends(get_db)):
    """Logout всегда работает — даже если JWT протух или невалиден."""
    settings = get_settings()
    cookie_options = {"key": settings.auth_cookie_name, "path": "/"}
    if settings.auth_cookie_domain:
        cookie_options["domain"] = settings.auth_cookie_domain
    response.delete_cookie(**cookie_options)
    return {"ok": True}


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get("/debug-me")
def debug_me(
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """Диагностика текущей сессии — возвращает состояние пользователя без блокировок."""
    settings = get_settings()
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    if not cookie_token:
        return {"status": "no_cookie"}
    try:
        from jose import jwt as _jwt
        payload = _jwt.decode(cookie_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub"))
    except Exception as e:
        return {"status": "invalid_token", "error": str(e)}
    user = db.get(User, user_id)
    if not user:
        return {"status": "user_not_found", "user_id": user_id}
    return {
        "status": "ok",
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "can_manage_operators": user.can_manage_operators,
    }


@router.post("/fix-session")
def fix_session(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """
    Аварийный endpoint: сбрасывает must_change_password для текущего
    admin/manager/supervisor пользователя. Вызывается автоматически
    фронтендом если обнаружен 403 при наличии валидного токена.
    """
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    from typing import Optional as Opt
    settings = get_settings()
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    if not cookie_token:
        return {"ok": False, "reason": "no_token"}
    try:
        from jose import jwt as _jwt
        payload = _jwt.decode(cookie_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub"))
    except Exception:
        return {"ok": False, "reason": "invalid_token"}
    user = db.get(User, user_id)
    if not user or not user.is_active:
        return {"ok": False, "reason": "user_not_found"}
    if user.role not in ("admin", "manager", "supervisor"):
        return {"ok": False, "reason": "not_allowed_for_role"}
    if user.must_change_password:
        user.must_change_password = False
        db.commit()
        return {"ok": True, "fixed": True}
    return {"ok": True, "fixed": False}


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
        current_user.must_change_password = False
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


@router.patch("/me/login")
def change_my_login(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    response: Response = None,
) -> dict:
    """Change current user login. Requires current password verification."""
    from pydantic import BaseModel
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
    db.add(AuditLog(
        action="login_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Логин изменён: {old_login} → {new_login}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    return {"ok": True, "message": "Логин успешно изменён", "new_login": new_login}


@router.patch("/me/password")
def change_my_password(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    response: Response = None,
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
    db.add(AuditLog(
        action="password_changed",
        entity_type="user",
        entity_id=current_user.id,
        details=f"Пароль изменён пользователем {current_user.username}",
        performed_by_user_id=current_user.id,
    ))
    db.commit()
    # Clear auth cookie → force re-login
    settings = get_settings()
    if response:
        response.delete_cookie(key=settings.auth_cookie_name, path="/")
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


@router.get("/users", response_model=List[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> List[User]:
    return list(db.scalars(select(User).order_by(User.id)))
