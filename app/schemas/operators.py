from __future__ import annotations

from datetime import datetime, date
from typing import Optional

from pydantic import BaseModel

from app.schemas.operator_levels import OperatorLevelBadge


class OperatorCreate(BaseModel):
    full_name: str
    group_id: int
    participation_status: str = "participating"
    position: str
    email: Optional[str] = None


class OperatorUpdate(BaseModel):
    full_name: Optional[str] = None
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    participation_status: Optional[str] = None
    employment_status: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None
    position: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None


class OperatorRead(BaseModel):
    id: int
    full_name: str
    group_id: Optional[int] = None
    group_name: str
    participation_status: str = "participating"
    employment_status: str = "active"
    status: str
    is_active: bool
    position: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    level: Optional[OperatorLevelBadge] = None
    start_date: Optional[date] = None
    tenure_days: Optional[int] = None
    rate: Optional[float] = None

    model_config = {"from_attributes": True}
