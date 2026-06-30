from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class RatingRow(BaseModel):
    operator_id: int
    full_name: str
    group_name: str
    rank_position: Optional[int]
    previous_rank_position: Optional[int]
    rank_delta: Optional[int]
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
    group_id: Optional[int] = None
    group_name: str
    participation_status: str = "participating"
    employment_status: str = "active"
    status: str
    position: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    is_active: bool
    # Из текущего рейтинга на основе PeriodReport
    rank_position: Optional[int] = None
    rank_delta: Optional[int] = None
    final_score: float = 0
    coins_earned_week: int = 0
    lateness_count: int = 0
    violation_count: int = 0
    dismissed_at: Optional[datetime] = None


class TransactionRow(BaseModel):
    id: int
    operator_id: int
    operator_name: str
    group_name: str
    amount: int
    type: str
    comment: str
    created_by_name: Optional[str] = None
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
    top_5_operators: List[RatingRow]
    latest_coin_transactions: List[Dict]
    group_summary: List[GroupSummary]
    last_updated: Optional[str] = None
