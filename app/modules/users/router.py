from __future__ import annotations

import logging
import re
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, hash_password
from app.database.db import get_db
from app.models.entities import AuditLog, Group, Operator, User
from app.modules.operator_levels.service import ensure_default_levels, operator_level_badge
from app.modules.users.schemas import (
    UserChangeRoleRequest,
    UserCreateRequest,
    UserListOut,
    UserReadOut,
    UserResetPasswordRequest,
    UserUpdateRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

ROLES = {"operator", "supervisor", "manager", "admin"}
STATUSES = {"active", "inactive", "dismissed", "blocked"}
ROLE_CREATE_MATRIX = {
    "admin": {"operator", "supervisor", "manager", "admin"},
    "manager": {"operator", "supervisor"},
}
ROLE_EDIT_MATRIX = ROLE_CREATE_MATRIX


def _allowed_roles(actor: User) -> set[str]:
    return ROLE_CREATE_MATRIX.get(actor.role, set())


def _ensure_can_target(actor: User, target_role: str) -> None:
    if target_role not in _allowed_roles(actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для этой роли")


def _validate_password(password: str) -> None:
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Пароль должен быть минимум 8 символов")
    if not re.search(r"[A-Za-zА-Яа-я]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать буквы и цифры")


def _active_admin_count(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))) or 0


def _ensure_not_last_admin(db: Session, user: User, new_role: str | None = None, new_active: bool | None = None) -> None:
    would_stop_being_admin = (
        user.role == "admin"
        and user.is_active
        and ((new_role is not None and new_role != "admin") or new_active is False)
    )
    if would_stop_being_admin and _active_admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Нельзя изменить или отключить последнего администратора системы.")


def _audit(db: Session, action: str, target_user_id: int, old_value: str, new_value: str, actor: User, reason: str = "") -> None:
    db.add(AuditLog(
        action=action,
        entity_type="user",
        entity_id=target_user_id,
        details=f"old={old_value}; new={new_value}; reason={reason}",
        performed_by_user_id=actor.id,
    ))


def _user_status(user: User) -> str:
    return getattr(user, "status", None) or ("active" if user.is_active else "inactive")


def _sync_active_from_status(user: User) -> None:
    user.is_active = user.status == "active"


def _group_name(db: Session, user: User, operator: Operator | None = None) -> str | None:
    if operator and operator.group_name:
        return operator.group_name
    if user.group_id:
        group = db.get(Group, user.group_id)
        return group.name if group else None
    return None


def _operator_for_user(db: Session, user: User) -> Operator | None:
    if user.operator_id:
        return db.get(Operator, user.operator_id)
    return None


def _tenure_days(operator) -> int | None:
    """Стаж оператора в днях от start_date (или created_at) до сегодня."""
    if not operator:
        return None
    today = _date.today()
    start = operator.start_date or (operator.created_at.date() if operator.created_at else None)
    if not start:
        return None
    return max(0, (today - start).days)


def _safe_level_badge(db: Session, operator) -> dict | None:
    """Безопасный вызов — не роняет весь список если уровень не удаётся получить."""
    try:
        return operator_level_badge(db, operator)
    except Exception:
        return None


def _user_out(db: Session, user: User, level_cache: dict | None = None) -> dict:
    operator = _operator_for_user(db, user)
    # Для операторских аккаунтов карточка оператора является источником ФИО.
    # Это не даёт спискам и фильтрам расходиться, если старые записи users и
    # operators были созданы в разное время.
    display_name = operator.full_name if operator and user.role == "operator" else user.full_name
    # level берём из кеша (preloaded) или пропускаем — не делаем N+1 запросов
    if level_cache is not None and operator and user.role == "operator":
        level = level_cache.get(operator.id)
    elif operator and user.role == "operator":
        level = _safe_level_badge(db, operator)
    else:
        level = None
    return {
        "id": user.id,
        "full_name": display_name,
        "login": user.username,
        "username": user.username,
        "email": user.email or (operator.email if operator else None),
        "phone": user.phone,
        "role": user.role,
        "group_id": user.group_id or (operator.group_id if operator else None),
        "group_name": _group_name(db, user, operator),
        "operator_id": user.operator_id,
        "level": level,
        "rate": float(operator.rate) if operator and operator.rate is not None else None,
        "position": operator.position if operator else None,
        "participation_status": operator.participation_status if operator else None,
        "employment_status": operator.employment_status if operator else None,
        "status": _user_status(user),
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "can_manage_operators": user.can_manage_operators,
        "created_at": user.created_at,
        "tenure_days": _tenure_days(operator),
        "start_date": operator.start_date.isoformat() if operator and operator.start_date else None,
    }


def _visible_user_stmt(db: Session, actor: User):
    stmt = select(User).where(User.status != "deleted")  # скрываем удалённых операторов
    if actor.role == "manager":
        stmt = stmt.where(User.role.in_(("operator", "supervisor")))
    elif actor.role == "supervisor":
        group_id = actor.group_id
        if not group_id and actor.operator_id:
            operator = db.get(Operator, actor.operator_id)
            group_id = operator.group_id if operator else None
        stmt = stmt.where(User.role == "operator")
        if group_id:
            stmt = stmt.where(User.group_id == group_id)
    elif actor.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    return stmt


@router.get("", response_model=UserListOut)
def list_users(
    role: str | None = None,
    group_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    page = max(1, page)
    limit = min(max(1, limit), 200)
    ensure_default_levels(db)
    stmt = _visible_user_stmt(db, current_user)
    if role:
        stmt = stmt.where(User.role == role)
    if status:
        stmt = stmt.where(User.status == status)
    if group_id:
        stmt = stmt.where(User.group_id == group_id)
    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(q), User.username.ilike(q), User.email.ilike(q)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = list(db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit)))

    # Preload operator level assignments одним запросом — избегаем N+1
    # Собираем operator_id всех операторов в текущей странице
    operator_ids = [u.operator_id for u in users if u.operator_id and u.role == "operator"]
    level_cache: dict = {}
    if operator_ids:
        try:
            from app.models.entities import OperatorLevel, OperatorLevelAssignment
            rows = list(db.execute(
                select(OperatorLevelAssignment, OperatorLevel)
                .join(OperatorLevel, OperatorLevelAssignment.level_id == OperatorLevel.id)
                .where(OperatorLevelAssignment.operator_id.in_(operator_ids))
            ))
            for assignment, level in rows:
                level_cache[assignment.operator_id] = {
                    "id": level.id,
                    "code": level.code,
                    "name": level.name,
                    "color": level.color,
                    "icon": level.icon,
                    "sort_order": level.sort_order,
                }
        except Exception as e:
            logger.error(f"[list_users] ошибка загрузки уровней: {e}")

    items = []
    for u in users:
        try:
            items.append(_user_out(db, u, level_cache=level_cache))
        except Exception as e:
            logger.error(f"[list_users] ошибка при сборке user_id={u.id}: {e}", exc_info=True)
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.post("", response_model=UserReadOut)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _ensure_can_target(current_user, payload.role)
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Некорректная роль")
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Некорректный статус")
    if payload.confirm_password is not None and payload.confirm_password != payload.password:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    _validate_password(payload.password)
    if payload.role in {"operator", "supervisor"} and not payload.group_id:
        raise HTTPException(status_code=400, detail="Для этой роли нужно выбрать группу")
    if payload.group_id and not db.get(Group, payload.group_id):
        raise HTTPException(status_code=404, detail="Группа не найдена")
    login = payload.login.strip()
    if not re.match(r"^[a-zA-Z0-9._]+$", login):
        raise HTTPException(status_code=400, detail="Логин может содержать латиницу, цифры, точку и _")
    if db.scalar(select(User).where(User.username == login)):
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    operator = None
    if payload.role == "operator":
        group = db.get(Group, payload.group_id)
        operator = Operator(
            full_name=payload.full_name.strip(),
            group_id=group.id,
            group_name=group.name,
            participation_status="participating",
            employment_status="active",
            status="active",
            is_active=payload.status == "active",
            position="operator",
            email=payload.email,
            created_by_user_id=current_user.id,
        )
        db.add(operator)
        db.flush()

    user = User(
        full_name=payload.full_name.strip(),
        username=login,
        password_hash=hash_password(payload.password),
        role=payload.role,
        operator_id=operator.id if operator else None,
        group_id=payload.group_id,
        email=payload.email,
        phone=payload.phone,
        status=payload.status,
        is_active=payload.status == "active",
        can_manage_operators=False,
        # Оператор получает временный пароль → должен сменить
        # Руководители/Администраторы создают свои пароли → менять необязательно
        must_change_password=payload.role == "operator",
    )
    db.add(user)
    db.flush()
    if operator:
        operator.user_id = user.id

    _audit(db, "user_created", user.id, "", payload.role, current_user, "create user")
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.patch("/{user_id}", response_model=UserReadOut)
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    _ensure_can_target(current_user, user.role)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data:
        if data["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Некорректный статус")
        _ensure_not_last_admin(db, user, new_active=data["status"] == "active")
        user.status = data["status"]
        _sync_active_from_status(user)
    if "is_active" in data:
        _ensure_not_last_admin(db, user, new_active=bool(data["is_active"]))
        user.is_active = bool(data["is_active"])
        user.status = "active" if user.is_active else "inactive"
    if "position" in data and data["position"] not in {"operator", "chat_manager"}:
        raise HTTPException(status_code=400, detail="Некорректная должность")
    if "participation_status" in data and data["participation_status"] not in {
        "participating", "not_participating"
    }:
        raise HTTPException(status_code=400, detail="Некорректный статус участия")
    if "rate" in data and data["rate"] is not None and data["rate"] not in {0.5, 0.75, 1.0}:
        raise HTTPException(status_code=400, detail="Ставка должна быть 0.5, 0.75 или 1.0")
    if "login" in data and data["login"]:
        login = data["login"].strip()
        existing = db.scalar(select(User).where(User.username == login, User.id != user.id))
        if existing:
            raise HTTPException(status_code=409, detail="Логин уже используется")
        user.username = login
    for field in ("full_name", "email", "phone", "group_id"):
        if field in data:
            setattr(user, field, data[field])
    operator = _operator_for_user(db, user)
    if operator:
        if "group_id" in data and data["group_id"] is None:
            raise HTTPException(status_code=400, detail="Оператору необходимо выбрать группу")
        operator.full_name = user.full_name
        operator.email = user.email
        operator.is_active = user.is_active
        operator.status = user.status
        if "group_id" in data and user.group_id:
            group = db.get(Group, user.group_id)
            if not group:
                raise HTTPException(status_code=400, detail="Группа не найдена")
            operator.group_id = group.id
            operator.group_name = group.name
        if "position" in data:
            operator.position = data["position"]
        if "participation_status" in data:
            operator.participation_status = data["participation_status"]
        if "start_date" in data:
            operator.start_date = data["start_date"]
        if "rate" in data:
            operator.rate = data["rate"]
    _audit(db, "user_updated", user.id, "", "updated", current_user, "")
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/{user_id}/change-role", response_model=UserReadOut)
def change_role(
    user_id: int,
    payload: UserChangeRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    _ensure_can_target(current_user, user.role)
    _ensure_can_target(current_user, payload.role)
    _ensure_not_last_admin(db, user, new_role=payload.role)
    old = user.role
    user.role = payload.role
    user.can_manage_operators = False
    _audit(db, "user_role_changed", user.id, old, payload.role, current_user, payload.reason)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/{user_id}/deactivate", response_model=UserReadOut)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    _ensure_can_target(current_user, user.role)
    _ensure_not_last_admin(db, user, new_active=False)
    user.status = "inactive"
    user.is_active = False
    _audit(db, "user_deactivated", user.id, "active", "inactive", current_user, "")
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: UserResetPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    _ensure_can_target(current_user, user.role)
    _validate_password(payload.new_password)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = payload.must_change_password
    _audit(db, "user_password_reset", user.id, "", "reset", current_user, "")
    db.commit()
    return {"ok": True}
