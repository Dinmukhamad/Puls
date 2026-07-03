from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.operator_levels import OperatorLevelBadge


class OperatorCreate(BaseModel):
    full_name: str
    group_id: int
    participation_status: str = "participating"
    position: str
    email: str | None = None


class OperatorUpdate(BaseModel):
    full_name: str | None = None
    group_id: int | None = None
    group_name: str | None = None
    participation_status: str | None = None
    employment_status: str | None = None
    status: str | None = None
    is_active: bool | None = None
    position: str | None = None
    email: str | None = None
    username: str | None = None


class OperatorRead(BaseModel):
    id: int
    full_name: str
    group_id: int | None = None
    group_name: str
    participation_status: str = "participating"
    employment_status: str = "active"
    status: str
    is_active: bool
    position: str | None = None
    email: str | None = None
    username: str | None = None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    created_at: datetime
    updated_at: datetime | None = None
    dismissed_at: datetime | None = None
    level: OperatorLevelBadge | None = None
    start_date: date | None = None
    tenure_days: int | None = None
    rate: float | None = None

    model_config = {"from_attributes": True}
