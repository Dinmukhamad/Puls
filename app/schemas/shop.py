"""Схемы магазина бонусов (п. 4.3, 4.4.4)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import ShopRequestStatus
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class ShopItemOut(ORMModel):
    id: int
    code: str
    title: str
    description: str | None = None
    price: int
    is_active: bool
    stock_limit: int | None = None
    per_user_monthly_limit: int | None = None
    requires_approval: bool = True
    sort_order: int = 100


class ShopItemForOperator(ShopItemOut):
    """Позиция каталога с расчётом доступности для конкретного оператора."""

    can_buy: bool
    missing_coins: int = Field(
        default=0, description="Сколько коинов не хватает; 0 - хватает"
    )
    blocked_reason: str | None = Field(
        default=None, description="Причина недоступности, если покупка невозможна"
    )


class ShopCatalogOut(BaseModel):
    balance: int
    available: int
    items: list[ShopItemForOperator]


class ShopItemCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    price: int = Field(gt=0)
    description: str | None = None
    stock_limit: int | None = Field(default=None, ge=0)
    per_user_monthly_limit: int | None = Field(default=None, ge=1)
    requires_approval: bool = True
    is_active: bool = True
    sort_order: int = 100


class ShopItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    price: int | None = Field(default=None, gt=0)
    description: str | None = None
    stock_limit: int | None = Field(default=None, ge=0)
    per_user_monthly_limit: int | None = Field(default=None, ge=1)
    requires_approval: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ShopRequestCreate(BaseModel):
    item_id: int
    comment: str | None = Field(default=None, max_length=500)


class ShopDecision(BaseModel):
    comment: str | None = Field(default=None, max_length=500)


class ShopRejection(BaseModel):
    comment: str = Field(
        min_length=3, max_length=500, description="Причина отказа, видна оператору"
    )


class ShopRequestOut(ORMModel):
    id: int
    status: ShopRequestStatus
    price: int
    comment: str | None = None
    decision_comment: str | None = None
    created_at: datetime
    decided_at: datetime | None = None
    fulfilled_at: datetime | None = None
    item: ShopItemOut
    user: UserBrief | None = None
    decided_by: UserBrief | None = None
