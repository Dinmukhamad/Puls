from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ShopItemCreate(BaseModel):
    title: str
    description: str = ""
    price: int = Field(gt=0)
    is_active: bool = True


class ShopItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = Field(default=None, gt=0)
    is_active: Optional[bool] = None


class ShopItemRead(BaseModel):
    id: int
    title: str
    description: str
    price: int
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PurchaseCreate(BaseModel):
    shop_item_id: int


class RejectPurchaseRequest(BaseModel):
    reason: str = Field(min_length=3)


class ShopPurchaseRead(BaseModel):
    id: int
    operator_id: int
    shop_item_id: int
    price: int
    status: str
    reject_reason: Optional[str]
    created_at: datetime
    reviewed_by_user_id: Optional[int]
    reviewed_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}
