from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Operator, User, WeeklyResult
from app.modules.rating.service import rating_cache_invalidate, recalculate_period_ranks
from app.modules.wallet.service import add_transaction, points_to_coins
from app.modules.weekly_results.accrual_service import (
    apply_period_accrual,
    calculate_period_accrual,
    run_history,
)
from app.modules.weekly_results.schemas import (
    WeeklyAccrualApplyRequest,
    WeeklyAccrualOperatorPreview,
    WeeklyAccrualPreviewResponse,
    WeeklyAccrualRunRead,
    WeeklyCalculateRequest,
    WeeklyResultCreate,
    WeeklyResultRead,
)

router = APIRouter(prefix="/weekly-results", tags=["weekly-results"])


@router.get("", response_model=list[WeeklyResultRead])
def list_weekly_results(
    limit: int | None = None,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: object = Depends(require_roles("supervisor", "manager", "admin")),
) -> list[WeeklyResult]:
    q = select(WeeklyResult).order_by(WeeklyResult.week_end.desc(), WeeklyResult.rank_position.asc().nulls_last())
    if limit is not None:
        q = q.offset(offset).limit(limit)
    return list(db.scalars(q))


@router.post("", response_model=WeeklyResultRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def upsert_weekly_result(payload: WeeklyResultCreate, db: Session = Depends(get_db)) -> WeeklyResult:
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    if (
        operator.participation_status != "participating"
        or operator.employment_status != "active"
        or not operator.is_active
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оператор не участвует в текущем рейтинге")
    if payload.week_end < payload.week_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Дата окончания раньше даты начала")

    final_score = payload.final_score
    if final_score is None:
        final_score = (
            payload.hours_score
            + payload.overtime_score
            + payload.quality_score
            + payload.efficiency_score
            + payload.calls_per_hour_score
            - payload.lateness_count
            - payload.violation_count
        )
    coins = points_to_coins(final_score, db)
    row = db.scalar(
        select(WeeklyResult).where(
            WeeklyResult.operator_id == payload.operator_id,
            WeeklyResult.week_start == payload.week_start,
            WeeklyResult.week_end == payload.week_end,
        )
    )
    previous_coins = row.coins_earned if row else 0
    if not row:
        row = WeeklyResult(operator_id=payload.operator_id, week_start=payload.week_start, week_end=payload.week_end)
        db.add(row)

    for key, value in payload.model_dump(exclude={"final_score"}).items():
        setattr(row, key, value)
    row.final_score = final_score
    row.contest_points = final_score
    row.coins_earned = coins

    delta = coins - previous_coins
    if delta:
        add_transaction(db, operator, delta, "weekly_accrual", f"Перерасчет коинов за {payload.week_start} - {payload.week_end}")

    recalculate_period_ranks(db, payload.week_start, payload.week_end)
    db.commit()
    rating_cache_invalidate()
    db.refresh(row)
    return row


@router.post("/recalculate", response_model=list[WeeklyResultRead], dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def recalculate_weekly_results(payload: WeeklyCalculateRequest, db: Session = Depends(get_db)) -> list[WeeklyResult]:
    rows = recalculate_period_ranks(db, payload.week_start, payload.week_end)
    db.commit()
    return rows


# ── Автоматический еженедельный расчёт (ТЗ §3.6) ────────────────────────────

@router.get(
    "/preview",
    response_model=WeeklyAccrualPreviewResponse,
    dependencies=[Depends(require_roles("supervisor", "manager", "admin"))],
)
def preview_weekly_accrual(
    period_start: date,
    period_end: date,
    db: Session = Depends(get_db),
) -> WeeklyAccrualPreviewResponse:
    """Предварительный расчёт без начисления — можно вызывать сколько угодно раз."""
    if period_end < period_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Дата окончания раньше даты начала")
    accruals = calculate_period_accrual(db, period_start, period_end)
    items = [
        WeeklyAccrualOperatorPreview(
            operator_id=a.operator.id,
            operator_name=a.operator.full_name,
            group_name=a.operator.group_name or None,
            contest_points=a.contest_points,
            base_coins=a.base_coins,
            bonus_top_coins=a.bonus_top_coins,
            bonus_no_late_coins=a.bonus_no_late_coins,
            bonus_no_violation_coins=a.bonus_no_violation_coins,
            bonus_nomination_coins=a.bonus_nomination_coins,
            bonus_thanks_coins=a.bonus_thanks_coins,
            total_coins=a.total_coins,
            rank_place=a.rank_place,
            previous_rank_place=a.previous_rank_place,
            rank_delta=a.rank_delta,
            already_accrued=a.already_accrued,
        )
        for a in accruals
    ]
    return WeeklyAccrualPreviewResponse(
        period_start=period_start,
        period_end=period_end,
        operators=items,
        total_operators=len(items),
        total_base_coins=sum(i.base_coins for i in items if not i.already_accrued),
        total_bonus_coins=sum(i.total_coins - i.base_coins for i in items if not i.already_accrued),
        total_coins=sum(i.total_coins for i in items if not i.already_accrued),
    )


@router.post(
    "/apply",
    response_model=WeeklyAccrualRunRead,
    dependencies=[Depends(require_roles("manager", "admin"))],
)
def apply_weekly_accrual(
    payload: WeeklyAccrualApplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WeeklyAccrualRunRead:
    """Фактическое начисление. Доступ — только manager/admin (ТЗ 3.6)."""
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Дата окончания раньше даты начала")
    run = apply_period_accrual(db, payload.period_start, payload.period_end, current_user, payload.mode)
    rating_cache_invalidate()
    return WeeklyAccrualRunRead.model_validate(run)


@router.get(
    "/runs",
    response_model=list[WeeklyAccrualRunRead],
    dependencies=[Depends(require_roles("supervisor", "manager", "admin"))],
)
def list_accrual_runs(db: Session = Depends(get_db)) -> list[WeeklyAccrualRunRead]:
    return [WeeklyAccrualRunRead.model_validate(r) for r in run_history(db)]
