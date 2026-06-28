from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, ShopPurchase, User, WeeklyResult
from app.schemas.dashboard import (
    DashboardRead, GroupSummary, OperatorRow, RatingRow, TransactionRow
)
from app.services.rating import latest_period

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardRead,
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def dashboard(db: Session = Depends(get_db)) -> DashboardRead:
    period = latest_period(db)
    top_rows = []
    coins_this_week = 0
    lateness_week = 0
    violations_week = 0

    if period:
        week_start, week_end = period
        coins_this_week = db.scalar(
            select(func.coalesce(func.sum(WeeklyResult.coins_earned), 0)).where(
                WeeklyResult.week_start == week_start,
                WeeklyResult.week_end == week_end,
            )
        ) or 0

        lateness_week = db.scalar(
            select(func.coalesce(func.sum(WeeklyResult.lateness_count), 0)).where(
                WeeklyResult.week_start == week_start,
                WeeklyResult.week_end == week_end,
            )
        ) or 0

        violations_week = db.scalar(
            select(func.coalesce(func.sum(WeeklyResult.violation_count), 0)).where(
                WeeklyResult.week_start == week_start,
                WeeklyResult.week_end == week_end,
            )
        ) or 0

        rows = list(db.execute(
            select(WeeklyResult, Operator)
            .join(Operator, Operator.id == WeeklyResult.operator_id)
            .where(WeeklyResult.week_start == week_start, WeeklyResult.week_end == week_end)
            .order_by(WeeklyResult.rank_position.asc().nulls_last())
            .limit(5)
        ))

        for result, operator in rows:
            rank_delta = None
            if result.rank_position is not None and result.previous_rank_position is not None:
                rank_delta = result.previous_rank_position - result.rank_position
            top_rows.append(RatingRow(
                operator_id=operator.id,
                full_name=operator.full_name,
                group_name=operator.group_name,
                rank_position=result.rank_position,
                previous_rank_position=result.previous_rank_position,
                rank_delta=rank_delta,
                final_score=result.final_score,
                coins_earned=result.coins_earned,
                current_balance=operator.current_balance,
                lateness_count=result.lateness_count,
                violation_count=result.violation_count,
            ))

    group_summary = [
        GroupSummary(
            group_name=name,
            operators_count=count,
            total_balance=balance,
            average_score=score or 0,
        )
        for name, count, balance, score in db.execute(
            select(
                Operator.group_name,
                func.count(Operator.id),
                func.coalesce(func.sum(Operator.current_balance), 0),
                func.avg(WeeklyResult.final_score),
            )
            .outerjoin(WeeklyResult, WeeklyResult.operator_id == Operator.id)
            .where(Operator.is_active.is_(True))
            .group_by(Operator.group_name)
            .order_by(Operator.group_name.asc())
        )
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
        select(func.count(Operator.id)).where(Operator.is_active.is_(True))
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
    period = latest_period(db)

    operators = list(db.scalars(
        select(Operator)
        .order_by(Operator.group_name.asc(), Operator.full_name.asc())
    ))

    result_map = {}
    if period:
        week_start, week_end = period
        for wr in db.scalars(
            select(WeeklyResult).where(
                WeeklyResult.week_start == week_start,
                WeeklyResult.week_end == week_end,
            )
        ):
            result_map[wr.operator_id] = wr

    rows = []
    for op in operators:
        wr = result_map.get(op.id)
        rank_delta = None
        if wr and wr.rank_position is not None and wr.previous_rank_position is not None:
            rank_delta = wr.previous_rank_position - wr.rank_position
        rows.append(OperatorRow(
            id=op.id,
            full_name=op.full_name,
            group_name=op.group_name,
            current_balance=op.current_balance,
            reserved_balance=op.reserved_balance,
            total_earned=op.total_earned,
            total_spent=op.total_spent,
            is_active=op.is_active,
            rank_position=wr.rank_position if wr else None,
            rank_delta=rank_delta,
            final_score=wr.final_score if wr else 0,
            coins_earned_week=wr.coins_earned if wr else 0,
            lateness_count=wr.lateness_count if wr else 0,
            violation_count=wr.violation_count if wr else 0,
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
