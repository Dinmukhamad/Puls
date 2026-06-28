from __future__ import annotations

import random
import re
import string
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, hash_password, require_roles, verify_password
from app.database.db import get_db
from app.models.entities import AuditLog, Operator, User
from app.schemas.operators import OperatorCreate, OperatorRead, OperatorUpdate

router = APIRouter(prefix="/operators", tags=["operators"])


# ── Helpers ────────────────────────────────────────────────────

def _gen_username(db: Session, full_name: str) -> str:
    """Генерирует уникальный логин формата user_*"""
    base = re.sub(r'[^a-z0-9]', '', full_name.lower().split()[0]) if full_name else ''
    if not base:
        base = 'operator'
    candidate = f"user_{base}"
    if not db.scalar(select(User).where(User.username == candidate)):
        return candidate
    # Добавляем случайный суффикс
    for _ in range(20):
        suffix = ''.join(random.choices(string.digits, k=4))
        candidate = f"user_{base}{suffix}"
        if not db.scalar(select(User).where(User.username == candidate)):
            return candidate
    raise HTTPException(status_code=500, detail="Не удалось сгенерировать уникальный логин")


def _gen_password() -> str:
    """Генерирует временный пароль минимум 8 символов"""
    chars = string.ascii_letters + string.digits
    return ''.join(random.choices(chars, k=10))


def _audit(db: Session, action: str, entity_type: str, entity_id: int,
           details: str, user: Optional[User] = None) -> None:
    db.add(AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        performed_by_user_id=user.id if user else None,
    ))


# ── Schemas ────────────────────────────────────────────────────

class OperatorCreateFull(BaseModel):
    full_name: str
    group_name: str
    status: str = "active"
    position: Optional[str] = None
    employee_id: Optional[str] = None
    email: Optional[str] = None
    start_date: Optional[str] = None
    comment: Optional[str] = None


class OperatorCreatedResponse(BaseModel):
    operator_id: int
    full_name: str
    group_name: str
    status: str
    username: str
    temp_password: str
    message: str = "Оператор успешно добавлен. Аккаунт создан."


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class ChangeUsernameRequest(BaseModel):
    new_username: str


class ResetPasswordResponse(BaseModel):
    operator_id: int
    full_name: str
    new_password: str


class OperatorFullRead(BaseModel):
    id: int
    full_name: str
    group_name: str
    status: str
    is_active: bool
    position: Optional[str]
    employee_id: Optional[str]
    email: Optional[str]
    comment: Optional[str]
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    username: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────

@router.get("", response_model=List[OperatorRead])
def list_operators(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin"))
) -> List[Operator]:
    return list(db.scalars(
        select(Operator).order_by(Operator.group_name.asc(), Operator.full_name.asc())
    ))


@router.get("/me", response_model=OperatorRead)
def my_operator(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Operator:
    if current_user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Пользователь не привязан к оператору")
    op = db.get(Operator, current_user.operator_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return op


@router.post("", response_model=OperatorCreatedResponse)
def create_operator(
    payload: OperatorCreateFull,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin"))
) -> OperatorCreatedResponse:
    """Создаёт оператора и автоматически создаёт аккаунт для входа"""
    if not payload.full_name.strip():
        raise HTTPException(status_code=400, detail="ФИО обязательно")
    if not payload.group_name.strip():
        raise HTTPException(status_code=400, detail="Группа обязательна")
    if payload.status not in ("active", "inactive", "archive"):
        raise HTTPException(status_code=400, detail="Недопустимый статус")

    # Проверка дублей по ФИО
    existing = db.scalar(select(Operator).where(Operator.full_name == payload.full_name.strip()))
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Похожий оператор уже существует: {existing.full_name} (ID {existing.id})"
        )

    # Email дубль
    if payload.email:
        dup_email = db.scalar(select(Operator).where(Operator.email == payload.email.strip()))
        if dup_email:
            raise HTTPException(status_code=409, detail="Оператор с таким email уже существует")

    # Создаём оператора
    op = Operator(
        full_name=payload.full_name.strip(),
        group_name=payload.group_name.strip(),
        status=payload.status,
        is_active=payload.status == "active",
        position=payload.position,
        employee_id=payload.employee_id,
        email=payload.email,
        comment=payload.comment,
        created_by_user_id=current_user.id,
    )
    db.add(op)
    db.flush()

    # Автоматически создаём аккаунт
    username = _gen_username(db, payload.full_name)
    temp_password = _gen_password()

    user = User(
        full_name=payload.full_name.strip(),
        username=username,
        password_hash=hash_password(temp_password),
        role="operator",
        operator_id=op.id,
        is_active=payload.status == "active",
    )
    db.add(user)
    db.flush()
    op.user_id = user.id

    _audit(db, "operator_created", "operator", op.id,
           f"Создан оператор {op.full_name}, группа {op.group_name}, логин {username}",
           current_user)
    _audit(db, "account_created", "user", user.id,
           f"Автоматически создан аккаунт {username} для оператора {op.full_name}",
           current_user)

    db.commit()

    return OperatorCreatedResponse(
        operator_id=op.id,
        full_name=op.full_name,
        group_name=op.group_name,
        status=op.status,
        username=username,
        temp_password=temp_password,
    )


@router.get("/audit/logs")
def get_audit_logs(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin"))
) -> list:
    from sqlalchemy import select as sa_select
    logs = list(db.execute(
        sa_select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.performed_by_user_id)
        .order_by(AuditLog.created_at.desc())
        .offset(skip).limit(limit)
    ))
    return [
        {
            "id": log.id,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "details": log.details,
            "performed_by": user.full_name if user else "Система",
            "created_at": log.created_at.isoformat(),
        }
        for log, user in logs
    ]

@router.get("/{operator_id}", response_model=OperatorFullRead)
def get_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    # Добавляем username
    username = None
    if op.user_id:
        u = db.get(User, op.user_id)
        username = u.username if u else None
    return {
        "id": op.id, "full_name": op.full_name, "group_name": op.group_name,
        "status": op.status, "is_active": op.is_active, "position": op.position,
        "employee_id": op.employee_id, "email": op.email, "comment": op.comment,
        "current_balance": op.current_balance, "reserved_balance": op.reserved_balance,
        "total_earned": op.total_earned, "total_spent": op.total_spent,
        "username": username,
        "created_at": op.created_at.isoformat(),
    }


@router.patch("/{operator_id}", response_model=OperatorRead)
def update_operator(
    operator_id: int,
    payload: OperatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin"))
) -> Operator:
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    changes = []
    for key, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(op, key, None)
        setattr(op, key, value)
        changes.append(f"{key}: {old} → {value}")
        # Синхронизируем is_active со статусом
        if key == "status":
            op.is_active = (value == "active")
            if op.user_id:
                u = db.get(User, op.user_id)
                if u:
                    u.is_active = op.is_active
    _audit(db, "operator_updated", "operator", op.id,
           "; ".join(changes), current_user)
    db.commit()
    db.refresh(op)
    return op


@router.post("/{operator_id}/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin"))
) -> ResetPasswordResponse:
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    if not op.user_id:
        raise HTTPException(status_code=400, detail="У оператора нет аккаунта")
    user = db.get(User, op.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    new_pwd = _gen_password()
    user.password_hash = hash_password(new_pwd)
    _audit(db, "password_reset", "user", user.id,
           f"Пароль сброшен для {op.full_name} администратором {current_user.full_name}",
           current_user)
    db.commit()
    return ResetPasswordResponse(
        operator_id=op.id,
        full_name=op.full_name,
        new_password=new_pwd,
    )


@router.post("/account/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Оператор меняет свой пароль"""
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Пароль должен содержать минимум 8 символов")
    current_user.password_hash = hash_password(payload.new_password)
    if current_user.operator_id:
        _audit(db, "password_changed", "user", current_user.id,
               f"Оператор {current_user.full_name} изменил пароль", current_user)
    db.commit()
    return {"ok": True, "message": "Пароль успешно изменён"}


@router.post("/account/change-username")
def change_username(
    payload: ChangeUsernameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Оператор меняет свой логин"""
    new_username = payload.new_username.strip()
    if not new_username:
        raise HTTPException(status_code=400, detail="Логин не может быть пустым")
    if not re.match(r'^[a-zA-Z0-9_]+$', new_username):
        raise HTTPException(status_code=400, detail="Логин может содержать только латинские буквы, цифры и _")
    existing = db.scalar(select(User).where(User.username == new_username, User.id != current_user.id))
    if existing:
        raise HTTPException(status_code=409, detail="Такой логин уже используется. Укажите другой логин.")
    old_username = current_user.username
    current_user.username = new_username
    if current_user.operator_id:
        _audit(db, "username_changed", "user", current_user.id,
               f"Логин изменён: {old_username} → {new_username}", current_user)
    db.commit()
    return {"ok": True, "message": "Логин успешно изменён", "new_username": new_username}

