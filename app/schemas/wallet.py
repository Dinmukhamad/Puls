from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ManualTransactionCreate(BaseModel):
    operator_id: int
    amount: int
    comment: str = Field(min_length=3)


class CoinTransactionRead(BaseModel):
    id: int
    operator_id: int
    amount: int
    type: str
    comment: str
    created_by_user_id: Optional[int]
    related_purchase_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class WalletRead(BaseModel):
    operator_id: int
    full_name: str
    group_name: str
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    transactions: List[CoinTransactionRead]
