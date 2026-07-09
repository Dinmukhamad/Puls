from __future__ import annotations

from datetime import date, datetime

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
    thanks_count: int = 0
    final_score: float | None = None


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
    rank_position: int | None
    previous_rank_position: int | None
    hours_score: float
    overtime_score: float
    quality_score: float
    efficiency_score: float
    calls_per_hour_score: float
    lateness_count: int
    violation_count: int
    thanks_count: int
    final_score: float
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Автоматический еженедельный расчёт (ТЗ §3) ──────────────────────────────

class WeeklyAccrualOperatorPreview(BaseModel):
    """Один оператор в preview/apply-ответе — прозрачная разбивка коинов (ТЗ 3.6, 5.5)."""
    operator_id: int
    operator_name: str
    group_name: str | None = None
    contest_points: float
    base_coins: int
    bonus_top_coins: int
    bonus_no_late_coins: int
    bonus_no_violation_coins: int
    bonus_nomination_coins: int
    bonus_thanks_coins: int
    total_coins: int
    rank_place: int | None = None
    previous_rank_place: int | None = None
    rank_delta: int | None = None
    already_accrued: bool = False  # True — за этот период уже было начисление, пропущен (ТЗ 3.4)


class WeeklyAccrualPreviewResponse(BaseModel):
    period_start: date
    period_end: date
    operators: list[WeeklyAccrualOperatorPreview]
    total_operators: int
    total_base_coins: int
    total_bonus_coins: int
    total_coins: int


class WeeklyAccrualApplyRequest(BaseModel):
    period_start: date
    period_end: date
    mode: str = "manual"


class WeeklyAccrualRunRead(BaseModel):
    id: int
    period_start: date
    period_end: date
    mode: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    created_by: str
    operators_count: int
    skipped_existing_count: int
    total_base_coins: int
    total_bonus_coins: int
    total_coins: int
    error_message: str | None

    model_config = {"from_attributes": True}
