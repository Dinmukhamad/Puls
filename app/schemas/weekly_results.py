from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class WeeklyResultCreate(BaseModel):
    operator_id: int
    week_start: date
    week_end: date
    hours_score: float = 0
    overtime_score: float = 0
    quality_score: float = 0
    efficiency_score: float = 0
    calls_per_hour_score: float = 0
    lateness_count: int = 0
    violation_count: int = 0
    final_score: Optional[float] = None


class WeeklyCalculateRequest(BaseModel):
    week_start: date
    week_end: date


class WeeklyResultRead(BaseModel):
    id: int
    operator_id: int
    week_start: date
    week_end: date
    contest_points: float
    coins_earned: int
    rank_position: Optional[int]
    previous_rank_position: Optional[int]
    hours_score: float
    overtime_score: float
    quality_score: float
    efficiency_score: float
    calls_per_hour_score: float
    lateness_count: int
    violation_count: int
    final_score: float
    created_at: datetime

    model_config = {"from_attributes": True}
