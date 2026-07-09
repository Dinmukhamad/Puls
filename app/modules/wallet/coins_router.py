from __future__ import annotations

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc
from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, ShopItem, ShopPurchase, User
from app.modules.rating.service import rating_cache_invalidate
from app.modules.wallet.service import (
    add_transaction,
    approve_purchase,
    complete_purchase,
    reject_purchase,
)

router = APIRouter(prefix="/coins", tags=["coins"])


ADMIN_DEP = Depends(require_roles("supervisor", "manager", "admin"))


def _supervisor_group_id(db: Session, user: User) -> int | None:
    return supervisor_scope_group_id(db, user)


class CoinManualOperation(BaseModel):
    operator_id: int
    operation: str = Field(pattern="^(credit|debit)$")
    amount: int = Field(gt=0)
    reason: str = Field(min_length=1)
    comment: str = ""


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3)


def _tx_row(tx: CoinTransaction, op: Operator, user: User | None) -> dict:
    return {
        "id": tx.id,
        "operator_id": tx.operator_id,
        "operator_name": op.full_name,
        "group_id": op.group_id,
        "group_name": op.group_name,
        "amount": tx.amount,
        "type": tx.type,
        "comment": tx.comment,
        "created_by_user_id": tx.created_by_user_id,
        "created_by_name": user.full_name if user else "Система",
        "related_purchase_id": tx.related_purchase_id,
        "source_type": tx.source_type,
        "source_id": tx.source_id,
        "metadata": tx.metadata_json,
        "created_at": tx.created_at.isoformat(),
    }


def _request_row(purchase: ShopPurchase, op: Operator, item: ShopItem | None) -> dict:
    return {
        "id": purchase.id,
        "operator_id": purchase.operator_id,
        "operator_name": op.full_name,
        "group_id": op.group_id,
        "group_name": op.group_name,
        "shop_item_id": purchase.shop_item_id,
        "bonus_name": item.title if item else f"Бонус #{purchase.shop_item_id}",
        "price": purchase.price,
        "coin_price": purchase.price,
        "status": purchase.status,
        "reject_reason": purchase.reject_reason,
        "created_at": purchase.created_at.isoformat(),
        "reviewed_by_user_id": purchase.reviewed_by_user_id,
        "reviewed_at": purchase.reviewed_at.isoformat() if purchase.reviewed_at else None,
        "completed_at": purchase.completed_at.isoformat() if purchase.completed_at else None,
    }


@router.get("/overview", dependencies=[ADMIN_DEP])
def overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    # «Сегодня» — локальный бизнес-день Asia/Almaty, переведённый в UTC-границы
    # для сравнения с created_at (naive UTC в БД). Раньше использовался
    # date.today() сервера (UTC на Railway), и операции до 05:00 по Алматы
    # попадали во «вчера» (ТЗ P1.1).
    group_id = _supervisor_group_id(db, current_user)
    today_start, today_end = local_day_bounds_utc()
    today_txs_q = select(CoinTransaction).where(
        CoinTransaction.created_at >= today_start,
        CoinTransaction.created_at <= today_end,
    )
    tx_list_q = (
        select(CoinTransaction, Operator, User)
        .join(Operator, Operator.id == CoinTransaction.operator_id)
        .outerjoin(User, User.id == CoinTransaction.created_by_user_id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
    )
    requests_q = (
        select(ShopPurchase, Operator, ShopItem)
        .join(Operator, Operator.id == ShopPurchase.operator_id)
        .outerjoin(ShopItem, ShopItem.id == ShopPurchase.shop_item_id)
        .order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
    )
    new_requests_q = select(func.count(ShopPurchase.id)).where(ShopPurchase.status.in_(["pending", "new"]))
    approved_requests_q = select(func.count(ShopPurchase.id)).where(ShopPurchase.status == "approved")
    reserved_coins_q = select(func.coalesce(func.sum(Operator.reserved_balance), 0))
    total_operations_q = select(func.count(CoinTransaction.id))

    if group_id is not None:
        today_txs_q = today_txs_q.join(Operator, Operator.id == CoinTransaction.operator_id).where(
            Operator.group_id == group_id
        )
        tx_list_q = tx_list_q.where(Operator.group_id == group_id)
        requests_q = requests_q.where(Operator.group_id == group_id)
        new_requests_q = new_requests_q.join(Operator, Operator.id == ShopPurchase.operator_id).where(
            Operator.group_id == group_id
        )
        approved_requests_q = approved_requests_q.join(Operator, Operator.id == ShopPurchase.operator_id).where(
            Operator.group_id == group_id
        )
        reserved_coins_q = reserved_coins_q.where(Operator.group_id == group_id)
        total_operations_q = total_operations_q.join(Operator, Operator.id == CoinTransaction.operator_id).where(
            Operator.group_id == group_id
        )

    today_txs = list(db.scalars(today_txs_q))
    latest_transactions = [
        _tx_row(tx, op, user) for tx, op, user in db.execute(tx_list_q.limit(10))
    ]
    latest_requests = [
        _request_row(p, op, item) for p, op, item in db.execute(requests_q.limit(10))
    ]
    return {
        "today_operations": len(today_txs),
        "today_credited": sum(tx.amount for tx in today_txs if tx.amount > 0),
        "today_debited": abs(sum(tx.amount for tx in today_txs if tx.amount < 0)),
        "new_requests": db.scalar(new_requests_q) or 0,
        "approved_requests": db.scalar(approved_requests_q) or 0,
        "reserved_coins": db.scalar(reserved_coins_q) or 0,
        "total_operations": db.scalar(total_operations_q) or 0,
        "latest_transactions": latest_transactions,
        "latest_requests": latest_requests,
    }


@router.post("/manual-operation", dependencies=[ADMIN_DEP])
def manual_operation(
    payload: CoinManualOperation,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    if not operator.is_active or (operator.employment_status or "active") == "dismissed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оператор неактивен")
    group_id = _supervisor_group_id(db, current_user)
    if group_id is not None and operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Оператор вне вашей группы")

    amount = payload.amount if payload.operation == "credit" else -payload.amount
    tx_type = "manual_accrual" if amount > 0 else "manual_deduction"
    comment = payload.reason.strip()
    if payload.comment.strip():
        comment = f"{comment}: {payload.comment.strip()}"
    tx = add_transaction(db, operator, amount, tx_type, comment, created_by=current_user)
    db.commit()
    rating_cache_invalidate()  # ручное начисление/списание меняет баланс в рейтинге
    db.refresh(tx)
    return {"ok": True, "transaction": _tx_row(tx, operator, current_user)}


@router.get("/requests", dependencies=[ADMIN_DEP])
def requests(
    status_filter: str = Query("all", alias="status"),
    group_id: str = "all",
    bonus_id: str = "all",
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = (
        select(ShopPurchase, Operator, ShopItem)
        .join(Operator, Operator.id == ShopPurchase.operator_id)
        .outerjoin(ShopItem, ShopItem.id == ShopPurchase.shop_item_id)
        .order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
    )
    if status_filter == "new":
        q = q.where(ShopPurchase.status.in_(["pending", "new"]))
    elif status_filter != "all":
        q = q.where(ShopPurchase.status == status_filter)
    if group_id != "all":
        q = q.where(Operator.group_id == int(group_id))
    if bonus_id != "all":
        q = q.where(ShopPurchase.shop_item_id == int(bonus_id))
    supervisor_group_id = _supervisor_group_id(db, current_user)
    if supervisor_group_id is not None:
        q = q.where(Operator.group_id == supervisor_group_id)

    total = db.scalar(select(func.count()).select_from(q.with_only_columns(ShopPurchase.id).subquery())) or 0
    if limit is not None:
        q = q.offset(offset).limit(limit)
    rows = [_request_row(p, op, item) for p, op, item in db.execute(q)]
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


def _assert_purchase_in_scope(db: Session, purchase: ShopPurchase, current_user: User) -> None:
    group_id = _supervisor_group_id(db, current_user)
    if group_id is None:
        return
    operator = db.get(Operator, purchase.operator_id)
    if not operator or operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Заявка вне вашей группы")


@router.post("/requests/{request_id}/approve", dependencies=[ADMIN_DEP])
def approve_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    purchase = db.get(ShopPurchase, request_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    approve_purchase(db, purchase, current_user)
    db.commit()
    rating_cache_invalidate()
    return {"ok": True}


@router.post("/requests/{request_id}/reject", dependencies=[ADMIN_DEP])
def reject_request(request_id: int, payload: RejectRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    purchase = db.get(ShopPurchase, request_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    reject_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    rating_cache_invalidate()
    return {"ok": True}


@router.post("/requests/{request_id}/complete", dependencies=[ADMIN_DEP])
def complete_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    purchase = db.get(ShopPurchase, request_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    complete_purchase(db, purchase, current_user)
    db.commit()
    return {"ok": True}


def _build_transactions_query(
    db: Session,
    current_user: User,
    type: str,
    operator_id: str,
    start_date: date | None,
    end_date: date | None,
    source: str,
    created_by: str,
):
    q = (
        select(CoinTransaction, Operator, User)
        .join(Operator, Operator.id == CoinTransaction.operator_id)
        .outerjoin(User, User.id == CoinTransaction.created_by_user_id)
    )
    if type != "all":
        q = q.where(CoinTransaction.type == type)
    if operator_id != "all":
        q = q.where(CoinTransaction.operator_id == int(operator_id))
    if start_date:
        q = q.where(CoinTransaction.created_at >= datetime.combine(start_date, time.min))
    if end_date:
        q = q.where(CoinTransaction.created_at <= datetime.combine(end_date, time.max))
    if source != "all":
        q = q.where(CoinTransaction.source_type == source)
    if created_by != "all":
        q = q.where(CoinTransaction.created_by_user_id == int(created_by))
    group_id = _supervisor_group_id(db, current_user)
    if group_id is not None:
        q = q.where(Operator.group_id == group_id)
    return q


@router.get("/transactions", dependencies=[ADMIN_DEP])
def transactions(
    type: str = "all",
    operator_id: str = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    source: str = "all",
    created_by: str = "all",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = _build_transactions_query(db, current_user, type, operator_id, start_date, end_date, source, created_by)
    total = db.scalar(select(func.count()).select_from(q.with_only_columns(CoinTransaction.id).subquery())) or 0
    q = q.order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc()).limit(limit).offset(offset)
    rows = [_tx_row(tx, op, user) for tx, op, user in db.execute(q)]
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@router.get("/transactions/export", dependencies=[ADMIN_DEP])
def export_transactions(
    type: str = "all",
    operator_id: str = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    source: str = "all",
    created_by: str = "all",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    q = _build_transactions_query(db, current_user, type, operator_id, start_date, end_date, source, created_by)
    q = q.order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
    rows = [_tx_row(tx, op, user) for tx, op, user in db.execute(q)]
    header = ["Дата", "Оператор", "Группа", "Тип", "Коины", "Причина", "Автор"]

    def cell(value) -> str:
        return '"' + str(value if value is not None else "").replace('"', '""') + '"'

    csv_rows = [",".join(cell(v) for v in header)]
    for row in rows:
        csv_rows.append(",".join(cell(v) for v in [
            row["created_at"],
            row["operator_name"],
            row["group_name"],
            row["type"],
            row["amount"],
            row["comment"],
            row["created_by_name"],
        ]))
    return Response(
        "\ufeff" + "\n".join(csv_rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=pulse_coin_transactions.csv"},
    )
