from __future__ import annotations

import re
import secrets
import string
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, hash_password, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, OperatorAuditLog, ShopPurchase, User
from app.schemas.operators import (
    OPERATOR_STATUSES,
    OperatorAccountRead,
    OperatorCardRead,
    OperatorCreate,
    OperatorCreateResult,
    OperatorDuplicateRead,
    OperatorRead,
    OperatorUpdate,
    PasswordResetResult,
)

router = APIRouter(prefix="/operators", tags=["operators"])

MANAGE_ROLES = ("supervisor", "manager", "admin")
ADMIN_ROLES = ("manager", "admin")


def normalize_optional(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def normalize_email(value: str | None) -> str | None:
    text = normalize_optional(value)
    return text.lower() if text else None


def normalize_status(value: str | None) -> str:
    status_value = (value or "active").strip().lower()
    if status_value not in OPERATOR_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый статус оператора")
    return status_value


def transliterate(value: str) -> str:
    mapping = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
        "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
        "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
        "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
        "я": "ya",
    }
    lowered = value.lower()
    converted = "".join(mapping.get(ch, ch) for ch in lowered)
    cleaned = re.sub(r"[^a-z0-9_]+", "_", converted).strip("_")
    return cleaned or secrets.token_hex(3)


def generate_unique_username(db: Session, full_name: str) -> str:
    first_part = full_name.split()[0] if full_name.split() else full_name
    base = f"user_{transliterate(first_part)}"
    for index in range(20):
        candidate = base if index == 0 else f"{base}{index + 1}"
        if not db.scalar(select(User.id).where(User.username == candidate)):
            return candidate
    while True:
        candidate = f"user_{secrets.token_hex(3)}"
        if not db.scalar(select(User.id).where(User.username == candidate)):
            return candidate


def generate_temporary_password() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(10))


def find_possible_duplicates(db: Session, payload: OperatorCreate) -> List[Operator]:
    filters = [func.lower(Operator.full_name) == payload.full_name.strip().lower()]
    employee_id = normalize_optional(payload.employee_id)
    email = normalize_email(payload.email)
    if employee_id:
        filters.append(func.lower(Operator.employee_id) == employee_id.lower())
    if email:
        filters.append(func.lower(Operator.email) == email)
    return list(db.scalars(select(Operator).where(or_(*filters)).limit(10)))


def add_audit(db: Session, operator: Operator, action: str, comment: str, actor: User | None) -> None:
    db.add(OperatorAuditLog(
        operator_id=operator.id,
        action=action,
        comment=comment,
        actor_user_id=actor.id if actor else None,
    ))


def sync_operator_account_status(operator: Operator) -> None:
    operator.is_active = operator.status != "archive"
    if operator.user:
        operator.user.is_active = operator.status != "archive"


def account_result(operator: Operator, temporary_password: str) -> OperatorAccountRead:
    return OperatorAccountRead(
        full_name=operator.full_name,
        group_name=operator.group_name,
        status=operator.status,
        username=operator.user.username if operator.user else "",
        temporary_password=temporary_password,
    )


def require_operator_management(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role in ADMIN_ROLES or current_user.can_manage_operators:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления операторами")


@router.get("", response_model=List[OperatorRead])
def list_operators(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
) -> List[Operator]:
    return list(db.scalars(select(Operator).order_by(Operator.group_name.asc(), Operator.full_name.asc())))


@router.get("/me", response_model=OperatorRead)
def my_operator(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Operator:
    if current_user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь не привязан к оператору")
    operator = db.get(Operator, current_user.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator


@router.post("", response_model=OperatorCreateResult)
def create_operator(
    payload: OperatorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management),
) -> OperatorCreateResult:
    full_name = payload.full_name.strip()
    group_name = payload.group_name.strip()
    operator_status = normalize_status(payload.status)
    if not full_name or not group_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ФИО, группа и статус обязательны")

    possible_duplicates = find_possible_duplicates(db, payload)
    if possible_duplicates and not payload.confirm_duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "possible_duplicate",
                "message": "Похожий оператор уже существует. Проверьте данные перед сохранением.",
                "duplicates": [OperatorDuplicateRead.model_validate(item).model_dump() for item in possible_duplicates],
            },
        )

    operator = Operator(
        full_name=full_name,
        group_name=group_name,
        status=operator_status,
        position=normalize_optional(payload.position),
        employee_id=normalize_optional(payload.employee_id),
        email=normalize_email(payload.email),
        participation_started_at=payload.participation_started_at,
        admin_comment=normalize_optional(payload.admin_comment),
        created_by_user_id=current_user.id,
    )
    sync_operator_account_status(operator)
    db.add(operator)
    db.flush()

    username = generate_unique_username(db, full_name)
    temporary_password = generate_temporary_password()
    user = User(
        full_name=full_name,
        username=username,
        password_hash=hash_password(temporary_password),
        role="operator",
        operator_id=operator.id,
        is_active=operator_status != "archive",
    )
    db.add(user)
    db.flush()
    operator.user_id = user.id

    add_audit(db, operator, "operator_created", "Оператор создан вручную через административную панель", current_user)
    add_audit(db, operator, "account_created", f"Аккаунт создан автоматически: {username}", current_user)
    db.commit()
    db.refresh(operator)
    return OperatorCreateResult(
        operator=operator,
        account=account_result(operator, temporary_password),
        possible_duplicates=possible_duplicates,
    )


@router.patch("/{operator_id}", response_model=OperatorRead)
def update_operator(
    operator_id: int,
    payload: OperatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management),
) -> Operator:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    changes = []
    data = payload.model_dump(exclude_unset=True)
    if "status" in data:
        data["status"] = normalize_status(data["status"])
    if "full_name" in data and not (data["full_name"] or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ФИО не может быть пустым")
    if "group_name" in data and not (data["group_name"] or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Группа не может быть пустой")
    if "email" in data:
        data["email"] = normalize_email(data["email"])
    if "employee_id" in data:
        data["employee_id"] = normalize_optional(data["employee_id"])

    for key, value in data.items():
        old_value = getattr(operator, key)
        if old_value == value:
            continue
        setattr(operator, key, value)
        changes.append(f"{key}: {old_value or '-'} -> {value or '-'}")

    if "status" in data:
        sync_operator_account_status(operator)
    if "full_name" in data and operator.user:
        operator.user.full_name = operator.full_name

    if changes:
        add_audit(db, operator, "operator_updated", "; ".join(changes), current_user)
    db.commit()
    db.refresh(operator)
    return operator


@router.post("/{operator_id}/reset-password", response_model=PasswordResetResult)
def reset_operator_password(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator_management),
) -> PasswordResetResult:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    if not operator.user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="У оператора нет аккаунта")

    temporary_password = generate_temporary_password()
    operator.user.password_hash = hash_password(temporary_password)
    operator.user.is_active = operator.status != "archive"
    add_audit(db, operator, "password_reset", "Пароль оператора сброшен", current_user)
    db.commit()
    db.refresh(operator)
    return PasswordResetResult(operator=operator, account=account_result(operator, temporary_password))


@router.get("/{operator_id}/card", response_model=OperatorCardRead)
def operator_card(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorCardRead:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к этому оператору")
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    transactions = list(db.execute(
        select(CoinTransaction)
        .where(CoinTransaction.operator_id == operator_id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .limit(50)
    ).scalars())
    purchases = list(db.execute(
        select(ShopPurchase)
        .where(ShopPurchase.operator_id == operator_id)
        .order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
        .limit(50)
    ).scalars())
    audit_log = list(db.execute(
        select(OperatorAuditLog)
        .where(OperatorAuditLog.operator_id == operator_id)
        .order_by(OperatorAuditLog.created_at.desc(), OperatorAuditLog.id.desc())
        .limit(50)
    ).scalars())

    return OperatorCardRead(
        operator=operator,
        transactions=[
            {
                "id": item.id,
                "amount": item.amount,
                "type": item.type,
                "comment": item.comment,
                "created_by_user_id": item.created_by_user_id,
                "related_purchase_id": item.related_purchase_id,
                "created_at": item.created_at.isoformat(),
            }
            for item in transactions
        ],
        purchases=[
            {
                "id": item.id,
                "shop_item_id": item.shop_item_id,
                "price": item.price,
                "status": item.status,
                "reject_reason": item.reject_reason,
                "created_at": item.created_at.isoformat(),
                "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
                "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            }
            for item in purchases
        ],
        audit_log=audit_log,
    )


@router.get("/{operator_id}", response_model=OperatorRead)
def get_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Operator:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к этому оператору")
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator
