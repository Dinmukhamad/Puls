from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RatingRow(BaseModel):
    operator_id: int
    full_name: str
    group_name: str
    rank_position: int | None
    previous_rank_position: int | None
    rank_delta: int | None
    final_score: float
    coins_earned: int
    current_balance: int
    lateness_count: int = 0
    violation_count: int = 0


class GroupSummary(BaseModel):
    group_name: str
    operators_count: int
    total_balance: int
    average_score: float


class OperatorRow(BaseModel):
    """Строка таблицы операторов для админ-панели"""
    id: int
    full_name: str
    group_id: int | None = None
    group_name: str
    participation_status: str = "participating"
    employment_status: str = "active"
    status: str
    position: str | None = None
    email: str | None = None
    username: str | None = None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    is_active: bool
    # Из текущего рейтинга на основе PeriodReport
    rank_position: int | None = None
    rank_delta: int | None = None
    final_score: float = 0
    coins_earned_week: int = 0
    lateness_count: int = 0
    violation_count: int = 0
    dismissed_at: datetime | None = None


class TransactionRow(BaseModel):
    id: int
    operator_id: int
    operator_name: str
    group_name: str
    amount: int
    type: str
    comment: str
    created_by_name: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class DashboardRead(BaseModel):
    total_operators: int
    active_operators: int
    coins_earned_this_week: int
    pending_purchases_count: int
    approved_purchases_count: int
    rejected_purchases_count: int
    total_lateness_week: int
    total_violations_week: int
    top_5_operators: list[RatingRow]
    latest_coin_transactions: list[dict]
    group_summary: list[GroupSummary]
    last_updated: str | None = None
