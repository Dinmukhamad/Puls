from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ShopItemCreate(BaseModel):
    title: str
    description: str = ""
    category: str = Field(default="other", pattern="^(quick|workday|recognition|gifts|other)$")
    price: int = Field(gt=0)
    min_level_id: int | None = None
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    stock_limit: int = Field(default=0, ge=0)
    purchase_limit_per_operator: int = Field(default=0, ge=0)


class ShopItemUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = Field(default=None, pattern="^(quick|workday|recognition|gifts|other)$")
    price: int | None = Field(default=None, gt=0)
    min_level_id: int | None = None
    is_active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    stock_limit: int | None = Field(default=None, ge=0)
    purchase_limit_per_operator: int | None = Field(default=None, ge=0)


class ShopItemRead(BaseModel):
    id: int
    title: str
    description: str
    category: str = "other"
    price: int
    min_level_id: int | None = None
    is_active: bool
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    stock_limit: int
    purchase_limit_per_operator: int
    created_at: datetime

    # Персонализированные поля (ТЗ P2) — считаются на момент запроса относительно
    # текущего оператора и текущего времени, не хранятся в БД:
    stock_remaining: int | None = None          # None = без лимита остатка
    operator_purchased_count: int = 0           # сколько раз ЭТОТ оператор уже брал
    operator_limit_reached: bool = False        # достигнут ли personal лимит
    is_available_now: bool = True               # прошло starts_at, не наступил ends_at, остаток > 0

    model_config = {"from_attributes": True}


class PurchaseCreate(BaseModel):
    shop_item_id: int
    discount_coupon_id: int | None = None


class RejectPurchaseRequest(BaseModel):
    reason: str = Field(min_length=3)


class ShopPurchaseRead(BaseModel):
    id: int
    operator_id: int
    shop_item_id: int
    price: int
    original_price: int = 0
    discount_percent: int = 0
    discount_amount: int = 0
    discount_coupon_id: int | None = None
    status: str
    reject_reason: str | None
    created_at: datetime
    reviewed_by_user_id: int | None
    reviewed_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ShopDiscountCouponRead(BaseModel):
    id: int
    title: str
    percent: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
