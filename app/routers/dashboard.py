from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, ShopPurchase, WeeklyResult
from app.schemas.dashboard import DashboardRead, GroupSummary, RatingRow
from app.services.rating import latest_period

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def dashboard(db: Session = Depends(get_db)) -> DashboardRead:
    period = latest_period(db)
    top_rows = []
    coins_this_week = 0
    if period:
        week_start, week_end = period
        coins_this_week = db.scalar(
            select(func.coalesce(func.sum(WeeklyResult.coins_earned), 0)).where(
                WeeklyResult.week_start == week_start,
                WeeklyResult.week_end == week_end,
            )
        )
        rows = list(
            db.execute(
                select(WeeklyResult, Operator)
                .join(Operator, Operator.id == WeeklyResult.operator_id)
                .where(WeeklyResult.week_start == week_start, WeeklyResult.week_end == week_end)
                .order_by(WeeklyResult.rank_position.asc().nulls_last())
                .limit(3)
            )
        )
        for result, operator in rows:
            rank_delta = None
            if result.rank_position is not None and result.previous_rank_position is not None:
                rank_delta = result.previous_rank_position - result.rank_position
            top_rows.append(
                RatingRow(
                    operator_id=operator.id,
                    full_name=operator.full_name,
                    group_name=operator.group_name,
                    rank_position=result.rank_position,
                    previous_rank_position=result.previous_rank_position,
                    rank_delta=rank_delta,
                    final_score=result.final_score,
                    coins_earned=result.coins_earned,
                    current_balance=operator.current_balance,
                )
            )

    group_summary = [
        GroupSummary(group_name=name, operators_count=count, total_balance=balance, average_score=score or 0)
        for name, count, balance, score in db.execute(
            select(
                Operator.group_name,
                func.count(Operator.id),
                func.coalesce(func.sum(Operator.current_balance), 0),
                func.avg(WeeklyResult.final_score),
            )
            .outerjoin(WeeklyResult, WeeklyResult.operator_id == Operator.id)
            .group_by(Operator.group_name)
            .order_by(Operator.group_name.asc())
        )
    ]

    latest_transactions = [
        {
            "id": item.id,
            "operator_id": item.operator_id,
            "amount": item.amount,
            "type": item.type,
            "comment": item.comment,
            "created_at": item.created_at.isoformat(),
        }
        for item in db.scalars(select(CoinTransaction).order_by(CoinTransaction.created_at.desc()).limit(10))
    ]

    return DashboardRead(
        total_operators=db.scalar(select(func.count(Operator.id))) or 0,
        coins_earned_this_week=coins_this_week or 0,
        pending_purchases_count=db.scalar(select(func.count(ShopPurchase.id)).where(ShopPurchase.status == "pending")) or 0,
        top_3_operators=top_rows,
        latest_coin_transactions=latest_transactions,
        group_summary=group_summary,
    )
