from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, computed_field


class ShopItemCreate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=100)
    title: str
    description: str = ""
    category: str = Field(default="other", pattern="^(quick|workday|recognition|gifts|other)$")
    prize_type: str = Field(default="physical", pattern="^(physical|digital|privilege)$")
    image_url: str | None = Field(default=None, max_length=500)
    issue_policy: str = ""
    issue_days: int = Field(default=14, ge=1, le=365)
    price: int = Field(gt=0)
    min_level_id: int | None = None
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    stock_limit: int = Field(default=0, ge=0)
    purchase_limit_per_operator: int = Field(default=0, ge=0)


class ShopItemUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=100)
    title: str | None = None
    description: str | None = None
    category: str | None = Field(default=None, pattern="^(quick|workday|recognition|gifts|other)$")
    prize_type: str | None = Field(default=None, pattern="^(physical|digital|privilege)$")
    image_url: str | None = Field(default=None, max_length=500)
    issue_policy: str | None = None
    issue_days: int | None = Field(default=None, ge=1, le=365)
    price: int | None = Field(default=None, gt=0)
    min_level_id: int | None = None
    is_active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    stock_limit: int | None = Field(default=None, ge=0)
    purchase_limit_per_operator: int | None = Field(default=None, ge=0)


class ShopItemRead(BaseModel):
    id: int
    code: str | None = None
    title: str
    description: str
    category: str = "other"
    prize_type: str = "physical"
    image_url: str | None = None
    issue_policy: str = ""
    issue_days: int = 14
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

    # Сезонная цена (ТЗ «Экономика коинов» §7, §9): price выше — БАЗОВАЯ цена;
    # effective_price — цена продажи сейчас. При is_seasonal_price=True карточка
    # обязана показать метку «Стартовая цена», regular_price и season_ends_at.
    effective_price: int | None = None
    regular_price: int | None = None
    is_seasonal_price: bool = False
    season_id: int | None = None
    season_code: str | None = None
    season_name: str | None = None
    season_ends_at: datetime | None = None

    @computed_field
    @property
    def name(self) -> str:
        """Имя в точном контракте `/store/prizes`; `title` сохранён для SPA."""
        return self.title

    model_config = {"from_attributes": True}


class PurchaseCreate(BaseModel):
    shop_item_id: int
    discount_coupon_id: int | None = None
    # Idempotency-Key (ТЗ «Экономика коинов» §14): клиент генерирует ключ на
    # открытие формы; повторная отправка не создаёт второй заказ.
    idempotency_key: str | None = Field(default=None, max_length=200)


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
    season_id: int | None = None
    status: str
    reject_reason: str | None
    created_at: datetime
    reviewed_by_user_id: int | None
    reviewed_at: datetime | None
    completed_at: datetime | None
    issued_by_user_id: int | None = None
    expires_at: datetime | None = None

    @computed_field
    @property
    def order_number(self) -> str:
        return f"PULS-{self.id:06d}"

    @computed_field
    @property
    def workflow_status(self) -> str:
        """Статус из ТЗ при сохранении legacy-значений для старого интерфейса."""
        return {
            "pending": "created",
            "new": "reserved",
            "approved": "ready",
            "completed": "issued",
            "rejected": "cancelled",
        }.get(self.status, self.status)

    @computed_field
    @property
    def reserved_at(self) -> datetime:
        return self.created_at

    @computed_field
    @property
    def ready_at(self) -> datetime | None:
        return self.reviewed_at if self.status in {"approved", "completed"} else None

    @computed_field
    @property
    def issued_at(self) -> datetime | None:
        return self.completed_at

    model_config = {"from_attributes": True}


class ShopDiscountCouponRead(BaseModel):
    id: int
    title: str
    percent: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
