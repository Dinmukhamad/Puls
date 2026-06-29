from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Operator, WeeklyResult


def latest_period(db: Session) -> Optional[Tuple[date, date]]:
    result = db.execute(
        select(WeeklyResult.week_start, WeeklyResult.week_end)
        .order_by(WeeklyResult.week_end.desc(), WeeklyResult.week_start.desc())
        .limit(1)
    ).first()
    return tuple(result) if result else None


def recalculate_period_ranks(db: Session, week_start: date, week_end: date) -> List[WeeklyResult]:
    rows = list(
        db.scalars(
            select(WeeklyResult)
            .join(Operator, Operator.id == WeeklyResult.operator_id)
            .where(WeeklyResult.week_start == week_start, WeeklyResult.week_end == week_end)
            .where(
                Operator.participation_status == "participating",
                Operator.employment_status == "active",
                Operator.is_active.is_(True),
            )
            .order_by(WeeklyResult.contest_points.desc(), WeeklyResult.final_score.desc(), WeeklyResult.id.asc())
        )
    )
    for position, row in enumerate(rows, start=1):
        previous = db.scalar(
            select(WeeklyResult.rank_position)
            .where(
                WeeklyResult.operator_id == row.operator_id,
                WeeklyResult.week_end < week_start,
                WeeklyResult.rank_position.is_not(None),
            )
            .order_by(WeeklyResult.week_end.desc())
            .limit(1)
        )
        row.previous_rank_position = previous
        row.rank_position = position
    return rows


def rating_rows(db: Session, week_start: Optional[date] = None, week_end: Optional[date] = None) -> List[Dict]:
    if week_start is None or week_end is None:
        period = latest_period(db)
        if not period:
            return []
        week_start, week_end = period

    rows = list(
        db.execute(
            select(WeeklyResult, Operator)
            .join(Operator, Operator.id == WeeklyResult.operator_id)
            .where(WeeklyResult.week_start == week_start, WeeklyResult.week_end == week_end)
            .where(
                Operator.participation_status == "participating",
                Operator.employment_status == "active",
                Operator.is_active.is_(True),
            )
            .order_by(WeeklyResult.rank_position.asc().nulls_last(), WeeklyResult.contest_points.desc())
        )
    )
    output = []
    for result, operator in rows:
        rank_delta = None
        if result.rank_position is not None and result.previous_rank_position is not None:
            rank_delta = result.previous_rank_position - result.rank_position
        output.append(
            {
                "operator_id": operator.id,
                "operator_name": operator.full_name,
                "group_name": operator.group_name,
                "contest_points": result.contest_points,
                "final_score": result.final_score,
                "quality_score": result.quality_score,
                "efficiency_score": result.efficiency_score,
                "coins_earned": result.coins_earned,
                "total_balance": operator.current_balance or 0,
                "rank_position": result.rank_position,
                "rank_delta": rank_delta,
            }
        )
    return output
