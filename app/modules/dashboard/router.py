from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import (
    CoinTransaction,
    Operator,
    ShopPurchase,
    User,
    WeeklyAccrualDetail,
    WeeklyResult,
    now_utc,
)
from app.modules.dashboard.schemas import DashboardRead, GroupSummary, OperatorRow, RatingRow
from app.modules.rating.service import rating_rows
from app.modules.weekly_results.accrual_service import (
    calculate_period_accrual,
    latest_weekly_period,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardRead,
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def dashboard(db: Session = Depends(get_db)) -> DashboardRead:
    rating = rating_rows(db)
    rating_by_operator = {row["operator_id"]: row for row in rating}
    latest_period = latest_weekly_period(db)
    weekly_by_operator: dict[int, WeeklyResult] = {}
    if latest_period:
        period_start, period_end = latest_period
        weekly_by_operator = {
            row.operator_id: row
            for row in db.scalars(
                select(WeeklyResult).where(
                    WeeklyResult.week_start == period_start,
                    WeeklyResult.week_end == period_end,
                )
            )
        }

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
            lateness_count=(weekly_by_operator.get(row["operator_id"]).lateness_count
                            if weekly_by_operator.get(row["operator_id"]) else 0),
            violation_count=(weekly_by_operator.get(row["operator_id"]).violation_count
                             if weekly_by_operator.get(row["operator_id"]) else 0),
        )
        for row in rating[:5]
    ]
    coins_this_week = sum(row.get("coins_earned") or 0 for row in rating)
    lateness_week = sum(result.lateness_count or 0 for result in weekly_by_operator.values())
    violations_week = sum(result.violation_count or 0 for result in weekly_by_operator.values())

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

    # Два счётчика операторов одним запросом
    total_ops = db.scalar(select(func.count(Operator.id))) or 0
    active_ops = len(active_operators)  # уже загружены выше

    # Все счётчики покупок одним запросом вместо трёх отдельных COUNT
    purchase_counts: dict = {}
    for row in db.execute(
        select(ShopPurchase.status, func.count(ShopPurchase.id))
        .group_by(ShopPurchase.status)
    ):
        purchase_counts[row[0]] = row[1]
    pending_cnt = (purchase_counts.get("pending") or 0) + (purchase_counts.get("new") or 0)

    return DashboardRead(
        total_operators=total_ops,
        active_operators=active_ops,
        coins_earned_this_week=coins_this_week,
        pending_purchases_count=pending_cnt,
        approved_purchases_count=purchase_counts.get("approved") or 0,
        rejected_purchases_count=purchase_counts.get("rejected") or 0,
        total_lateness_week=lateness_week,
        total_violations_week=violations_week,
        top_5_operators=top_rows,
        latest_coin_transactions=latest_transactions,
        group_summary=group_summary,
        last_updated=now_utc().isoformat(),
    )


@router.get("/operators", response_model=list[OperatorRow],
            dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def admin_operators(db: Session = Depends(get_db)) -> list[OperatorRow]:
    """Расширенная таблица операторов для админ-панели"""
    operators = list(db.scalars(
        select(Operator)
        .order_by(Operator.group_name.asc(), Operator.full_name.asc())
    ))

    rating_map = {row["operator_id"]: row for row in rating_rows(db)}

    # Подгружаем всех связанных пользователей ОДНИМ запросом вместо
    # db.get(User, op.user_id) на каждого оператора в цикле (N+1) —
    # на 50+ операторов это давало 50+ дополнительных запросов к БД
    # при каждом заходе в раздел «Операторы».
    user_ids = [op.user_id for op in operators if op.user_id]
    users_by_id = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))
    } if user_ids else {}

    rows = []
    for op in operators:
        user = users_by_id.get(op.user_id) if op.user_id else None
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


@router.get("/history", response_model=list[dict],
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


@router.get("/admin-summary", dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def admin_summary(
    period_start: date | None = None,
    period_end: date | None = None,
    group_id: int | None = None,
    participation_status: str | None = None,
    position: str | None = None,
    has_lateness: bool | None = None,
    has_violations: bool | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Админская сводка (ТЗ §9). Период по умолчанию — последняя неделя, за
    которую есть хоть один WeeklyResult; если она уже применена — цифры берём
    из зафиксированного WeeklyAccrualDetail, иначе считаем предварительно тем
    же движком, что /weekly-results/preview (согласованность с кабинетом и
    экспортами — везде одни и те же числа)."""
    if period_start is None or period_end is None:
        resolved = latest_weekly_period(db)
        if resolved:
            period_start, period_end = resolved

    supervisor_group_id = supervisor_scope_group_id(db, current_user)
    effective_group_id = group_id if group_id is not None else supervisor_group_id
    # supervisor не может расширить область видимости фильтром на чужую группу
    if supervisor_group_id is not None and group_id is not None and group_id != supervisor_group_id:
        effective_group_id = supervisor_group_id

    operators_q = select(Operator)
    if effective_group_id is not None:
        operators_q = operators_q.where(Operator.group_id == effective_group_id)
    all_operators = {op.id: op for op in db.scalars(operators_q)}

    operators_total = len(all_operators)
    active_competition_operators = sum(
        1 for op in all_operators.values()
        if op.participation_status == "participating" and op.employment_status == "active" and op.is_active
    )
    total_coins_balance = sum(op.current_balance or 0 for op in all_operators.values())

    new_shop_requests_q = select(func.count(ShopPurchase.id)).where(ShopPurchase.status.in_(["pending", "new"]))
    if effective_group_id is not None:
        new_shop_requests_q = new_shop_requests_q.join(Operator, Operator.id == ShopPurchase.operator_id).where(
            Operator.group_id == effective_group_id
        )
    new_shop_requests = db.scalar(new_shop_requests_q) or 0

    week_rows: list[dict] = []
    coins_accrued_this_week = 0
    rank_places: list[int] = []

    if period_start and period_end:
        details = list(db.scalars(
            select(WeeklyAccrualDetail).where(
                WeeklyAccrualDetail.period_start == period_start,
                WeeklyAccrualDetail.period_end == period_end,
            )
        ))
        if details:
            for d in details:
                op = all_operators.get(d.operator_id)
                if not op:
                    continue
                coins_accrued_this_week += d.total_coins
                if d.rank_place:
                    rank_places.append(d.rank_place)
                week_rows.append({
                    "operator": op, "week_points": d.contest_points, "week_coins": d.total_coins,
                    "rank_place": d.rank_place, "lateness_count": None, "violation_count": None,
                    "quality": None, "efficiency": None,
                })
            # Опоздания/нарушения/качество/эффективность в WeeklyAccrualDetail не
            # хранятся (это снимок бонусов, не сырых метрик) — берём из WeeklyResult.
            from app.models.entities import WeeklyResult
            wr_by_op = {
                r.operator_id: r for r in db.scalars(
                    select(WeeklyResult).where(
                        WeeklyResult.week_start == period_start, WeeklyResult.week_end == period_end,
                    )
                )
            }
            for row in week_rows:
                wr = wr_by_op.get(row["operator"].id)
                if wr:
                    row["lateness_count"] = wr.lateness_count
                    row["violation_count"] = wr.violation_count
                    row["quality"] = wr.quality_score
                    row["efficiency"] = wr.efficiency_score
        else:
            accruals = calculate_period_accrual(db, period_start, period_end)
            for a in accruals:
                if a.operator.id not in all_operators:
                    continue
                coins_accrued_this_week += a.total_coins
                if a.rank_place:
                    rank_places.append(a.rank_place)
                week_rows.append({
                    "operator": a.operator, "week_points": a.contest_points, "week_coins": a.total_coins,
                    "rank_place": a.rank_place, "lateness_count": a.weekly_result.lateness_count,
                    "violation_count": a.weekly_result.violation_count,
                    "quality": a.weekly_result.quality_score, "efficiency": a.weekly_result.efficiency_score,
                })

    average_team_rank = round(sum(rank_places) / len(rank_places), 2) if rank_places else None

    def _matches_filters(row: dict) -> bool:
        op = row["operator"]
        if participation_status and op.participation_status != participation_status:
            return False
        if position and op.position != position:
            return False
        if has_lateness is not None:
            if ((row["lateness_count"] or 0) > 0) != has_lateness:
                return False
        if has_violations is not None:
            if ((row["violation_count"] or 0) > 0) != has_violations:
                return False
        return True

    operators_out = [
        {
            "id": row["operator"].id,
            "full_name": row["operator"].full_name,
            "group_name": row["operator"].group_name,
            "participation_status": row["operator"].participation_status,
            "employment_status": row["operator"].employment_status,
            "position": row["operator"].position,
            "week_points": row["week_points"],
            "week_coins": row["week_coins"],
            "total_balance": row["operator"].current_balance,
            "lateness_count": row["lateness_count"],
            "violation_count": row["violation_count"],
            "quality": row["quality"],
            "efficiency": row["efficiency"],
            "rank_place": row["rank_place"],
        }
        for row in week_rows
        if _matches_filters(row)
    ]
    operators_out.sort(key=lambda r: (r["rank_place"] is None, r["rank_place"]))

    return {
        "period_start": str(period_start) if period_start else None,
        "period_end": str(period_end) if period_end else None,
        "operators_total": operators_total,
        "active_competition_operators": active_competition_operators,
        "coins_accrued_this_week": coins_accrued_this_week,
        "new_shop_requests": new_shop_requests,
        "average_team_rank": average_team_rank,
        "total_coins_balance": total_coins_balance,
        "operators": operators_out,
    }
