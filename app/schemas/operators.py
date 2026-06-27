from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OperatorCreate(BaseModel):
    full_name: str
    group_name: str
    user_id: Optional[int] = None
    is_active: bool = True


class OperatorUpdate(BaseModel):
    full_name: Optional[str] = None
    group_name: Optional[str] = None
    user_id: Optional[int] = None
    is_active: Optional[bool] = None


class OperatorRead(BaseModel):
    id: int
    full_name: str
    group_name: str
    user_id: Optional[int]
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    created_at: datetime
    is_active: bool

    model_config = {"from_attributes": True}
