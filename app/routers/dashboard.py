from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, ShopPurchase, User
from app.schemas.dashboard import DashboardRead, GroupSummary, OperatorRow, RatingRow
from app.services.rating import rating_rows

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardRead,
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def dashboard(db: Session = Depends(get_db)) -> DashboardRead:
    rating = rating_rows(db)
    rating_by_operator = {row["operator_id"]: row for row in rating}

    top_rows = [
        RatingRow(
            operator_id=row["operator_id"],
            full_name=row["operator_name"],
            group_name=row["group_name"],
            rank_position=row["rank_position"],
            previous_rank_position=None,
            rank_delta=row.get("rank_delta"),
            final_score=row.get("final_score") or row.get("contest_points") or 0,
            coins_earned=row.get("coins_earned") or 0,
            current_balance=row.get("total_balance") or 0,
            lateness_count=0,
            violation_count=0,
        )
        for row in rating[:5]
    ]
    coins_this_week = sum(row.get("coins_earned") or 0 for row in rating)
    lateness_week = 0
    violations_week = 0

    active_operators = list(db.scalars(
        select(Operator)
        .where(
            Operator.participation_status == "participating",
            Operator.employment_status == "active",
            Operator.is_active.is_(True),
        )
        .order_by(Operator.group_name.asc(), Operator.full_name.asc())
    ))
    group_stats: dict[str, dict] = {}
    for operator in active_operators:
        group_name = operator.group_name or "Без группы"
        stat = group_stats.setdefault(group_name, {"count": 0, "balance": 0, "scores": []})
        stat["count"] += 1
        stat["balance"] += operator.current_balance or 0
        rating_row = rating_by_operator.get(operator.id)
        if rating_row:
            stat["scores"].append(rating_row.get("final_score") or rating_row.get("contest_points") or 0)

    group_summary = [
        GroupSummary(
            group_name=name,
            operators_count=stat["count"],
            total_balance=stat["balance"],
            average_score=round(sum(stat["scores"]) / len(stat["scores"]), 2) if stat["scores"] else 0,
        )
        for name, stat in sorted(group_stats.items())
    ]

    # Последние транзакции с именами
    tx_rows = list(db.execute(
        select(CoinTransaction, Operator, User)
        .join(Operator, Operator.id == CoinTransaction.operator_id)
        .outerjoin(User, User.id == CoinTransaction.created_by_user_id)
        .order_by(CoinTransaction.created_at.desc())
        .limit(15)
    ))

    latest_transactions = [
        {
            "id": tx.id,
            "operator_id": tx.operator_id,
            "operator_name": op.full_name,
            "group_name": op.group_name,
            "amount": tx.amount,
            "type": tx.type,
            "comment": tx.comment,
            "created_by_name": user.full_name if user else None,
            "created_at": tx.created_at.isoformat(),
        }
        for tx, op, user in tx_rows
    ]

    total_ops = db.scalar(select(func.count(Operator.id))) or 0
    active_ops = db.scalar(
        select(func.count(Operator.id)).where(
            Operator.participation_status == "participating",
            Operator.employment_status == "active",
            Operator.is_active.is_(True),
        )
    ) or 0

    return DashboardRead(
        total_operators=total_ops,
        active_operators=active_ops,
        coins_earned_this_week=coins_this_week,
        pending_purchases_count=db.scalar(
            select(func.count(ShopPurchase.id)).where(ShopPurchase.status == "pending")
        ) or 0,
        approved_purchases_count=db.scalar(
            select(func.count(ShopPurchase.id)).where(ShopPurchase.status == "approved")
        ) or 0,
        rejected_purchases_count=db.scalar(
            select(func.count(ShopPurchase.id)).where(ShopPurchase.status == "rejected")
        ) or 0,
        total_lateness_week=lateness_week,
        total_violations_week=violations_week,
        top_5_operators=top_rows,
        latest_coin_transactions=latest_transactions,
        group_summary=group_summary,
        last_updated=datetime.utcnow().isoformat(),
    )


@router.get("/operators", response_model=List[OperatorRow],
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def admin_operators(db: Session = Depends(get_db)) -> List[OperatorRow]:
    """Расширенная таблица операторов для админ-панели"""
    operators = list(db.scalars(
        select(Operator)
        .order_by(Operator.group_name.asc(), Operator.full_name.asc())
    ))

    rating_map = {row["operator_id"]: row for row in rating_rows(db)}

    rows = []
    for op in operators:
        user = op.user or (db.get(User, op.user_id) if op.user_id else None)
        rating_row = rating_map.get(op.id)
        rows.append(OperatorRow(
            id=op.id,
            full_name=op.full_name,
            group_id=op.group_id,
            group_name=op.group_name,
            participation_status=op.participation_status,
            employment_status=op.employment_status,
            status=op.status,
            position=op.position,
            email=op.email,
            username=user.username if user else None,
            current_balance=op.current_balance,
            reserved_balance=op.reserved_balance,
            total_earned=op.total_earned,
            total_spent=op.total_spent,
            is_active=op.is_active,
            rank_position=rating_row["rank_position"] if rating_row else None,
            rank_delta=rating_row.get("rank_delta") if rating_row else None,
            final_score=(rating_row.get("final_score") or rating_row.get("contest_points") or 0) if rating_row else 0,
            coins_earned_week=(rating_row.get("coins_earned") or 0) if rating_row else 0,
            lateness_count=0,
            violation_count=0,
            dismissed_at=op.dismissed_at,
        ))
    return rows


@router.get("/history", response_model=List[dict],
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def transaction_history(
    skip: int = 0,
    limit: int = 50,
    operator_id: int | None = None,
    db: Session = Depends(get_db),
) -> list:
    """История всех транзакций с именами"""
    q = (
        select(CoinTransaction, Operator, User)
        .join(Operator, Operator.id == CoinTransaction.operator_id)
        .outerjoin(User, User.id == CoinTransaction.created_by_user_id)
        .order_by(CoinTransaction.created_at.desc())
    )
    if operator_id:
        q = q.where(CoinTransaction.operator_id == operator_id)
    q = q.offset(skip).limit(limit)

    return [
        {
            "id": tx.id,
            "operator_id": tx.operator_id,
            "operator_name": op.full_name,
            "group_name": op.group_name,
            "amount": tx.amount,
            "type": tx.type,
            "comment": tx.comment,
            "created_by_name": user.full_name if user else "Система",
            "created_at": tx.created_at.isoformat(),
        }
        for tx, op, user in db.execute(q)
    ]
