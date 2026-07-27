from __future__ import annotations

import logging
import random
import re
import secrets
import string
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime_utils import business_today
from app.core.security import (
    get_current_user,
    hash_password,
    require_roles,
    supervisor_scope_group_id,
)
from app.database.db import get_db
from app.models.entities import (
    AuditLog,
    CoinTransaction,
    Group,
    Operator,
    ShopPurchase,
    User,
    WeeklyResult,
    now_utc,
)
from app.modules.auth.credentials import (
    change_password as change_account_password,
)
from app.modules.auth.credentials import (
    change_username as change_account_username,
)
from app.modules.operator_levels.schemas import OperatorLevelSummary
from app.modules.operator_levels.service import operator_level_badge, operator_level_summary
from app.modules.operators.schemas import OperatorRead, OperatorUpdate
from app.modules.rating.service import rating_cache_invalidate

logger = logging.getLogger(__name__)

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
        suffix = ''.join(secrets.choice(string.digits) for _ in range(4))
        candidate = f"user_{base}{suffix}"
        if not db.scalar(select(User).where(User.username == candidate)):
            return candidate
    raise HTTPException(status_code=500, detail="Не удалось сгенерировать уникальный логин")


def _gen_password(username: str | None = None) -> str:
    """Генерирует сложный временный пароль минимум 10 символов."""
    special_chars = "!@#$%&*?"
    chars = string.ascii_letters + string.digits + special_chars
    rng = random.SystemRandom()
    for _ in range(50):
        password_chars = [
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.digits),
            secrets.choice(special_chars),
        ]
        password_chars.extend(secrets.choice(chars) for _ in range(6))
        rng.shuffle(password_chars)
        password = ''.join(password_chars)
        if password != (username or ""):
            return password
    raise HTTPException(status_code=500, detail="Не удалось сгенерировать временный пароль")


def _audit(db: Session, action: str, entity_type: str, entity_id: int,
           details: str, user: User | None = None) -> None:
    db.add(AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        performed_by_user_id=user.id if user else None,
    ))


def _operator_user(db: Session, op: Operator) -> User | None:
    if op.user_id:
        return db.get(User, op.user_id)
    return db.scalar(select(User).where(User.operator_id == op.id))


def _sync_operator_state(db: Session, op: Operator) -> None:
    op.is_active = (
        op.employment_status == "active"
        and op.participation_status == "participating"
    )
    if op.employment_status == "dismissed":
        op.status = "dismissed"
    else:
        op.status = "active" if op.is_active else "inactive"

    user = _operator_user(db, op)
    if user:
        user.full_name = op.full_name
        user.is_active = op.employment_status == "active"


def _safe_level_badge(db: Session, operator) -> dict | None:
    """Безопасный вызов — не роняет весь список если уровень не удаётся получить."""
    try:
        return operator_level_badge(db, operator)
    except Exception:
        return None


def _operator_response(db: Session, op: Operator) -> dict:
    user = _operator_user(db, op)
    # Стаж: если задана start_date — считаем от неё, иначе от created_at
    start = op.start_date or op.created_at.date()
    tenure_days = max(0, (business_today() - start).days)
    return {
        "id": op.id,
        "full_name": op.full_name,
        "group_id": op.group_id,
        "group_name": op.group_name,
        "participation_status": op.participation_status,
        "employment_status": op.employment_status,
        "status": op.status,
        "is_active": op.is_active,
        "position": op.position,
        "email": op.email,
        "username": user.username if user else None,
        "current_balance": op.current_balance,
        "reserved_balance": op.reserved_balance,
        "total_earned": op.total_earned,
        "total_spent": op.total_spent,
        "created_at": op.created_at,
        "updated_at": getattr(op, "updated_at", None),
        "dismissed_at": op.dismissed_at,
        "level": _safe_level_badge(db, op),
        "start_date": op.start_date.isoformat() if op.start_date else None,
        "tenure_days": tenure_days,
        "rate": op.rate,
    }


def _validate_username(db: Session, username: str, current_user_id: int | None = None) -> str:
    value = username.strip()
    if not value:
        raise HTTPException(status_code=400, detail="Логин обязателен")
    if not re.match(r"^[a-zA-Z0-9_]+$", value):
        raise HTTPException(status_code=400, detail="Логин может содержать только латинские буквы, цифры и _")
    existing = db.scalar(select(User).where(User.username == value, User.id != current_user_id))
    if existing:
        raise HTTPException(status_code=409, detail="Такой логин уже используется")
    return value


def _operator_history_counts(db: Session, operator_id: int) -> dict:
    return {
        "weekly_results": db.scalar(
            select(func.count(WeeklyResult.id)).where(WeeklyResult.operator_id == operator_id)
        ) or 0,
        "coin_transactions": db.scalar(
            select(func.count(CoinTransaction.id)).where(CoinTransaction.operator_id == operator_id)
        ) or 0,
        "shop_purchases": db.scalar(
            select(func.count(ShopPurchase.id)).where(ShopPurchase.operator_id == operator_id)
        ) or 0,
    }


def require_operator_management_access(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role in {"manager", "admin"}:
        return current_user
    if current_user.role == "supervisor" and current_user.can_manage_operators:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")


def _get_operator_or_404_scoped(db: Session, operator_id: int, current_user: User) -> Operator:
    """Загружает оператора и проверяет, что супервайзер не выходит за пределы
    своей группы (ТЗ 10.2) — единая точка для всех операций над одним
    оператором по ID (просмотр, редактирование, увольнение, восстановление,
    сброс пароля). manager/admin — без ограничений.
    """
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None and op.group_id != group_id:
        raise HTTPException(status_code=403, detail="Нет доступа к оператору другой группы")
    return op


# ── Schemas ────────────────────────────────────────────────────

VALID_POSITIONS = ("operator", "chat_manager")
VALID_PARTICIPATION = ("participating", "not_participating")
VALID_EMPLOYMENT = ("active", "dismissed")


class OperatorCreateFull(BaseModel):
    full_name: str
    group_id: int                          # required — select from groups list
    participation_status: str = "participating"
    position: str = "operator"
    email: str | None = None


class OperatorCreatedGroup(BaseModel):
    id: int
    name: str


class OperatorCreatedResponse(BaseModel):
    id: int
    operator_id: int
    full_name: str
    group: OperatorCreatedGroup
    group_name: str
    participation_status: str
    position: str
    email: str | None = None
    login: str
    username: str
    temporary_password: str
    temp_password: str
    message: str = "Оператор успешно создан"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class ChangeUsernameRequest(BaseModel):
    new_username: str
    current_password: str


class ResetPasswordResponse(BaseModel):
    operator_id: int
    full_name: str
    new_password: str


class RestoreOperatorRequest(BaseModel):
    participation_status: str = "participating"


class OperatorFullRead(BaseModel):
    id: int
    full_name: str
    group_id: int | None
    group_name: str
    participation_status: str
    employment_status: str = "active"
    status: str
    is_active: bool
    position: str | None
    email: str | None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    username: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    dismissed_at: datetime | None = None
    level: dict | None = None

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────

@router.get("", response_model=list[OperatorRead])
def list_operators(
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin"))
) -> list[dict]:
    query = select(Operator).order_by(Operator.group_name.asc(), Operator.full_name.asc())
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None:
        query = query.where(Operator.group_id == group_id)
    if limit is not None:
        query = query.offset(offset).limit(limit)
    operators = list(db.scalars(query))
    return [_operator_response(db, op) for op in operators]


@router.get("/me", response_model=OperatorRead)
def my_operator(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    if current_user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Пользователь не привязан к оператору")
    op = db.get(Operator, current_user.operator_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return _operator_response(db, op)


@router.post("", response_model=OperatorCreatedResponse)
def create_operator(
    payload: OperatorCreateFull,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management_access)
) -> OperatorCreatedResponse:
    """Создаёт оператора с авто-аккаунтом. Группа выбирается из списка."""
    # Validate required fields
    if not payload.full_name.strip():
        raise HTTPException(status_code=400, detail="Укажите ФИО оператора")
    if len(payload.full_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="ФИО слишком короткое")
    if payload.participation_status not in VALID_PARTICIPATION:
        raise HTTPException(status_code=400, detail="Некорректный статус участия")
    if payload.position not in VALID_POSITIONS:
        raise HTTPException(status_code=400, detail="Некорректная должность")

    # Validate group
    group = db.get(Group, payload.group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    if group.status != "active":
        raise HTTPException(status_code=400, detail="Нельзя добавить оператора в отключённую группу")
    supervisor_group_id = supervisor_scope_group_id(db, current_user)
    if supervisor_group_id is not None and group.id != supervisor_group_id:
        raise HTTPException(status_code=403, detail="Можно добавлять операторов только в свою группу")

    # Validate email
    email = payload.email.strip() if payload.email else None
    if email:
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            raise HTTPException(status_code=400, detail="Введите корректный email")
        dup_email = db.scalar(select(Operator).where(Operator.email == email))
        if dup_email:
            raise HTTPException(status_code=409, detail="Оператор с таким email уже существует")

    # Check duplicate name
    existing = db.scalar(select(Operator).where(Operator.full_name == payload.full_name.strip()))
    if existing:
        raise HTTPException(status_code=409,
            detail=f"Оператор с таким ФИО уже существует: {existing.full_name} (ID {existing.id})")

    # Create operator
    is_active = payload.participation_status == "participating"
    op = Operator(
        full_name=payload.full_name.strip(),
        group_id=group.id,
        group_name=group.name,
        participation_status=payload.participation_status,
        employment_status="active",
        status="active" if is_active else "inactive",
        is_active=is_active,
        position=payload.position,
        email=email,
        created_by_user_id=current_user.id,
    )
    db.add(op)
    db.flush()

    # Auto-create account
    username = _gen_username(db, payload.full_name)
    temp_password = _gen_password(username)

    user = User(
        full_name=payload.full_name.strip(),
        username=username,
        password_hash=hash_password(temp_password),
        role="operator",
        operator_id=op.id,
        is_active=True,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    op.user_id = user.id

    _audit(db, "operator_created", "operator", op.id,
           f"Создан оператор {op.full_name}, группа {group.name}, должность {payload.position}, логин {username}",
           current_user)

    db.commit()

    return OperatorCreatedResponse(
        id=op.id,
        operator_id=op.id,
        full_name=op.full_name,
        group=OperatorCreatedGroup(id=group.id, name=group.name),
        group_name=group.name,
        participation_status=op.participation_status,
        position=op.position or "operator",
        email=op.email,
        login=username,
        username=username,
        temporary_password=temp_password,
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
    op = _get_operator_or_404_scoped(db, operator_id, current_user)
    return _operator_response(db, op)


@router.get("/{operator_id}/level", response_model=OperatorLevelSummary)
def get_operator_level(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    op = _get_operator_or_404_scoped(db, operator_id, current_user)
    return operator_level_summary(db, op)


@router.patch("/{operator_id}", response_model=OperatorRead)
def update_operator(
    operator_id: int,
    payload: OperatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management_access)
) -> dict:
    op = _get_operator_or_404_scoped(db, operator_id, current_user)
    changes = []

    data = payload.model_dump(exclude_unset=True)

    if "full_name" in data:
        full_name = (data["full_name"] or "").strip()
        if len(full_name) < 2:
            raise HTTPException(status_code=400, detail="ФИО обязательно")
        changes.append(f"full_name: {op.full_name} → {full_name}")
        op.full_name = full_name

    if "group_id" in data:
        group_id = data["group_id"]
        if group_id is None:
            raise HTTPException(status_code=400, detail="Группа обязательна")
        group = db.get(Group, group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Группа не найдена")
        if group.id != op.group_id and group.status != "active":
            raise HTTPException(status_code=400, detail="Нельзя перевести оператора в отключённую группу")
        changes.append(f"group_id: {op.group_id} → {group.id}")
        op.group_id = group.id
        op.group_name = group.name

    if "participation_status" in data:
        value = data["participation_status"]
        if value not in VALID_PARTICIPATION:
            raise HTTPException(status_code=400, detail="Некорректный статус участия")
        if op.employment_status == "dismissed" and value == "participating":
            raise HTTPException(status_code=400, detail="Сначала восстановите оператора")
        changes.append(f"participation_status: {op.participation_status} → {value}")
        op.participation_status = value

    if "employment_status" in data:
        value = data["employment_status"]
        if value not in VALID_EMPLOYMENT:
            raise HTTPException(status_code=400, detail="Некорректный статус работы")
        old_employment_status = op.employment_status
        if value == "dismissed":
            op.employment_status = "dismissed"
            op.participation_status = "not_participating"
            op.dismissed_at = op.dismissed_at or now_utc()
        else:
            op.employment_status = "active"
            op.dismissed_at = None
        changes.append(f"employment_status: {old_employment_status} → {value}")

    if "position" in data:
        value = data["position"]
        if value not in VALID_POSITIONS:
            raise HTTPException(status_code=400, detail="Некорректная должность")
        changes.append(f"position: {op.position} → {value}")
        op.position = value

    if "email" in data:
        email = data["email"].strip() if data["email"] else None
        if email and not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            raise HTTPException(status_code=400, detail="Введите корректный email")
        if email:
            duplicate = db.scalar(select(Operator).where(Operator.email == email, Operator.id != op.id))
            if duplicate:
                raise HTTPException(status_code=409, detail="Оператор с таким email уже существует")
        changes.append(f"email: {op.email} → {email}")
        op.email = email

    if "username" in data:
        user = _operator_user(db, op)
        if not user:
            raise HTTPException(status_code=400, detail="У оператора нет аккаунта")
        username = _validate_username(db, data["username"] or "", user.id)
        changes.append(f"username: {user.username} → {username}")
        user.username = username

    # Backward compatibility: старые клиенты могут прислать status/is_active.
    if "status" in data and "participation_status" not in data and "employment_status" not in data:
        status_value = data["status"]
        if status_value == "dismissed":
            op.employment_status = "dismissed"
            op.participation_status = "not_participating"
            op.dismissed_at = op.dismissed_at or now_utc()
            changes.append("status: legacy → dismissed")
        elif status_value in {"active", "inactive"}:
            op.participation_status = "participating" if status_value == "active" else "not_participating"
            changes.append(f"status: legacy → {status_value}")

    op.updated_at = now_utc()
    _sync_operator_state(db, op)
    _audit(db, "operator_updated", "operator", op.id,
           "; ".join(changes) if changes else "Без изменений", current_user)
    db.commit()
    rating_cache_invalidate()  # ФИО/группа/статусы участия видны в рейтинге
    db.refresh(op)
    return _operator_response(db, op)


@router.post("/{operator_id}/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management_access)
) -> ResetPasswordResponse:
    op = _get_operator_or_404_scoped(db, operator_id, current_user)
    user = _operator_user(db, op)
    if not user:
        raise HTTPException(status_code=400, detail="У оператора нет аккаунта")

    new_pwd = _gen_password(user.username)
    user.password_hash = hash_password(new_pwd)
    user.must_change_password = True
    _audit(db, "password_reset", "user", user.id,
           f"Пароль сброшен для {op.full_name} администратором {current_user.full_name}",
           current_user)
    db.commit()
    return ResetPasswordResponse(
        operator_id=op.id,
        full_name=op.full_name,
        new_password=new_pwd,
    )


@router.post("/{operator_id}/dismiss", response_model=OperatorRead)
def dismiss_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management_access),
) -> dict:
    op = _get_operator_or_404_scoped(db, operator_id, current_user)
    if op.employment_status == "dismissed":
        return _operator_response(db, op)

    op.employment_status = "dismissed"
    op.participation_status = "not_participating"
    op.dismissed_at = now_utc()
    op.updated_at = now_utc()
    _sync_operator_state(db, op)
    _audit(db, "operator_dismissed", "operator", op.id,
           f"Оператор {op.full_name} уволен. Вход заблокирован, участие отключено.",
           current_user)
    db.commit()
    rating_cache_invalidate()  # уволенный выпадает из рейтинга и номинаций
    db.refresh(op)
    return _operator_response(db, op)


@router.post("/{operator_id}/restore", response_model=OperatorRead)
def restore_operator(
    operator_id: int,
    payload: RestoreOperatorRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management_access),
) -> dict:
    if payload.participation_status not in VALID_PARTICIPATION:
        raise HTTPException(status_code=400, detail="Некорректный статус участия")

    op = _get_operator_or_404_scoped(db, operator_id, current_user)

    op.employment_status = "active"
    op.participation_status = payload.participation_status
    op.dismissed_at = None
    op.updated_at = now_utc()
    _sync_operator_state(db, op)
    _audit(db, "operator_restored", "operator", op.id,
           f"Оператор {op.full_name} восстановлен со статусом участия {payload.participation_status}.",
           current_user)
    db.commit()
    rating_cache_invalidate()
    db.refresh(op)
    return _operator_response(db, op)


@router.delete("/{operator_id}")
def delete_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Полное удаление оператора из БД — только для admin.
    Каскадно удаляет всю историю (PeriodReport, DailyMetrics, уровни и т.д.).
    """
    from sqlalchemy import text

    # Только admin
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Удаление оператора доступно только администратору",
        )

    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")

    op_name = op.full_name
    op_id   = op.id
    user_id = op.user_id

    try:
        conn = db.connection()

        def safe_exec(sql: str, params: dict) -> None:
            """
            Выполняет SQL через SAVEPOINT — если таблица не существует,
            откатывается к savepoint и продолжает. Соединение остаётся живым.
            """
            sp = f"sp_{abs(hash(sql)) % 100000}"
            conn.execute(text(f"SAVEPOINT {sp}"))
            try:
                conn.execute(text(sql), params)
                conn.execute(text(f"RELEASE SAVEPOINT {sp}"))
            except Exception:
                conn.execute(text(f"ROLLBACK TO SAVEPOINT {sp}"))

        oid = op_id

        # 1. Зависимые таблицы — через savepoint (таблица может не существовать)
        for tbl in [
            "period_reports", "operator_daily_metrics",
            "operator_level_assignments", "operator_level_history",
            "coin_transactions", "shop_purchases",
            "lateness_records", "violations", "penalty_records",
            "test_results", "weekly_results", "rating_snapshots",
            "operator_audit_logs",
        ]:
            safe_exec(f"DELETE FROM {tbl} WHERE operator_id = :oid", {"oid": oid})

        # 2. Audit logs — обнуляем entity_id
        safe_exec(
            "UPDATE audit_logs SET entity_id = NULL WHERE entity_type = 'operator' AND entity_id = :oid",
            {"oid": oid},
        )

        # 3. Отвязать и деактивировать учётную запись
        if user_id:
            conn.execute(
                text("""UPDATE users
                        SET is_active = false,
                            operator_id = NULL,
                            status = 'deleted',
                            username = CONCAT('deleted_', :oid, '_', username)
                        WHERE id = :uid"""),
                {"oid": oid, "uid": user_id},
            )

        # 4. Обнулить self-FK оператора
        conn.execute(
            text("UPDATE operators SET user_id = NULL, group_id = NULL WHERE id = :oid"),
            {"oid": oid},
        )

        # 5. Удалить оператора
        conn.execute(text("DELETE FROM operators WHERE id = :oid"), {"oid": oid})

        # 6. Audit лог удаления
        conn.execute(
            text(
                "INSERT INTO audit_logs "
                "(action, entity_type, entity_id, details, performed_by_user_id, created_at) "
                "VALUES ('operator_deleted', 'operator', NULL, :details, :uid, NOW())"
            ),
            {
                "details": f"Администратор удалил оператора: {op_name} (ID {oid}) со всей историей",
                "uid": current_user.id,
            },
        )

        db.commit()
        rating_cache_invalidate()  # оператор исчез из рейтинга
        return {"ok": True, "message": f"Оператор «{op_name}» удалён вместе с историей"}

    except Exception:
        db.rollback()
        logger.exception("Не удалось удалить оператора id=%s", operator_id)
        raise HTTPException(status_code=500, detail="Не удалось удалить оператора. Попробуйте позже или обратитесь к администратору.") from None


@router.get("/{operator_id}/history")
def operator_history(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if current_user.role not in {"operator", "supervisor", "manager", "admin"}:
        raise HTTPException(status_code=403, detail="Недостаточно прав")

    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")

    audit_rows = list(db.scalars(
        select(AuditLog)
        .where(
            ((AuditLog.entity_type == "operator") & (AuditLog.entity_id == operator_id))
            | (AuditLog.operator_id == operator_id)
        )
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ))
    tx_rows = list(db.scalars(
        select(CoinTransaction)
        .where(CoinTransaction.operator_id == operator_id)
        .order_by(CoinTransaction.created_at.desc())
        .limit(100)
    ))
    purchase_rows = list(db.scalars(
        select(ShopPurchase)
        .where(ShopPurchase.operator_id == operator_id)
        .order_by(ShopPurchase.created_at.desc())
        .limit(100)
    ))
    weekly_rows = list(db.scalars(
        select(WeeklyResult)
        .where(WeeklyResult.operator_id == operator_id)
        .order_by(WeeklyResult.week_end.desc(), WeeklyResult.week_start.desc())
        .limit(100)
    ))

    return {
        "operator": _operator_response(db, op),
        "audit_logs": [
            {
                "id": row.id,
                "action": row.action,
                "details": row.details or row.comment,
                "created_at": row.created_at.isoformat(),
                "performed_by_user_id": row.performed_by_user_id or row.actor_user_id,
            }
            for row in audit_rows
        ],
        "transactions": [
            {
                "id": row.id,
                "amount": row.amount,
                "type": row.type,
                "comment": row.comment,
                "created_at": row.created_at.isoformat(),
            }
            for row in tx_rows
        ],
        "purchases": [
            {
                "id": row.id,
                "shop_item_id": row.shop_item_id,
                "price": row.price,
                "status": row.status,
                "created_at": row.created_at.isoformat(),
            }
            for row in purchase_rows
        ],
        "weekly_results": [
            {
                "id": row.id,
                "week_start": row.week_start.isoformat(),
                "week_end": row.week_end.isoformat(),
                "contest_points": row.contest_points,
                "coins_earned": row.coins_earned,
                "rank_position": row.rank_position,
                "final_score": row.final_score,
            }
            for row in weekly_rows
        ],
    }


@router.post("/account/change-password")
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Оператор меняет свой пароль"""
    change_account_password(
        db,
        current_user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        confirmation=payload.confirm_password,
    )
    if current_user.operator_id:
        _audit(db, "password_changed", "user", current_user.id,
               f"Оператор {current_user.full_name} изменил пароль", current_user)
    db.commit()
    settings = get_settings()
    response.delete_cookie(settings.auth_cookie_name, path="/")
    response.delete_cookie("pulse_csrf_token", path="/")
    return {"ok": True, "message": "Пароль изменён. Войдите снова.", "logout": True}


@router.post("/account/change-username")
def change_username(
    payload: ChangeUsernameRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Оператор меняет свой логин"""
    old_username, new_username = change_account_username(
        db,
        current_user,
        current_password=payload.current_password,
        new_username=payload.new_username,
    )
    if current_user.operator_id:
        _audit(db, "username_changed", "user", current_user.id,
               f"Логин изменён: {old_username} → {new_username}", current_user)
    db.commit()
    settings = get_settings()
    response.delete_cookie(settings.auth_cookie_name, path="/")
    response.delete_cookie("pulse_csrf_token", path="/")
    return {
        "ok": True,
        "message": "Логин изменён. Войдите снова.",
        "new_username": new_username,
        "logout": True,
    }
