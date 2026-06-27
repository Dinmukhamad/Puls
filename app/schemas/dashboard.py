from __future__ import annotations

from typing import Dict, List, Optional

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


class GroupSummary(BaseModel):
    group_name: str
    operators_count: int
    total_balance: int
    average_score: float


class DashboardRead(BaseModel):
    total_operators: int
    coins_earned_this_week: int
    pending_purchases_count: int
    top_3_operators: List[RatingRow]
    latest_coin_transactions: List[Dict]
    group_summary: List[GroupSummary]
