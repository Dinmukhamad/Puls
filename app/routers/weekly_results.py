from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import require_roles
from app.database.db import get_db
from app.models.entities import Operator, WeeklyResult
from app.schemas.weekly_results import WeeklyCalculateRequest, WeeklyResultCreate, WeeklyResultRead
from app.services.coins import add_transaction, points_to_coins
from app.services.rating import recalculate_period_ranks

router = APIRouter(prefix="/weekly-results", tags=["weekly-results"])


@router.get("", response_model=List[WeeklyResultRead])
def list_weekly_results(db: Session = Depends(get_db), _: object = Depends(require_roles("supervisor", "manager", "admin"))) -> List[WeeklyResult]:
    return list(
        db.scalars(
            select(WeeklyResult).order_by(WeeklyResult.week_end.desc(), WeeklyResult.rank_position.asc().nulls_last())
        )
    )


@router.post("", response_model=WeeklyResultRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def upsert_weekly_result(payload: WeeklyResultCreate, db: Session = Depends(get_db)) -> WeeklyResult:
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    if operator.participation_status != "participating" or not operator.is_active:
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
    coins = points_to_coins(final_score)
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
    db.refresh(row)
    return row


@router.post("/recalculate", response_model=List[WeeklyResultRead], dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def recalculate_weekly_results(payload: WeeklyCalculateRequest, db: Session = Depends(get_db)) -> List[WeeklyResult]:
    rows = recalculate_period_ranks(db, payload.week_start, payload.week_end)
    db.commit()
    return rows
