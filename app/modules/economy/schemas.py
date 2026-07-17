"""Pydantic-схемы модуля экономики (ТЗ §11, §13)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

SEASON_STATUSES = {"draft", "announced", "active", "completed"}
RULE_PERIODS = {"all_time", "week", "month"}


# --- Сезоны -----------------------------------------------------------------

class SeasonCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=200)
    starts_at: datetime
    ends_at: datetime | None = None
    notification_at: datetime | None = None
    status: str = "draft"
    config_json: dict | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in SEASON_STATUSES:
            raise ValueError(f"status должен быть одним из {sorted(SEASON_STATUSES)}")
        return v


class SeasonUpdate(BaseModel):
    name: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    notification_at: datetime | None = None
    status: str | None = None
    config_json: dict | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is not None and v not in SEASON_STATUSES:
            raise ValueError(f"status должен быть одним из {sorted(SEASON_STATUSES)}")
        return v


class SeasonRead(BaseModel):
    id: int
    code: str
    name: str
    status: str
    starts_at: datetime
    ends_at: datetime | None
    notification_at: datetime | None
    config_json: dict | None
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Правила наград ----------------------------------------------------------

class RewardRuleCreate(BaseModel):
    season_id: int | None = None
    source_type: str = Field(min_length=2, max_length=50)
    source_code: str = Field(min_length=2, max_length=120)
    name: str = ""
    amount: int = Field(gt=0)
    threshold: float | None = None
    period: str = "all_time"
    period_limit: int = Field(default=1, ge=0)
    active: bool = True
    valid_from: datetime | None = None
    valid_to: datetime | None = None

    @field_validator("period")
    @classmethod
    def _period(cls, v: str) -> str:
        if v not in RULE_PERIODS:
            raise ValueError(f"period должен быть одним из {sorted(RULE_PERIODS)}")
        return v


class RewardRuleUpdate(BaseModel):
    name: str | None = None
    amount: int | None = Field(default=None, gt=0)
    threshold: float | None = None
    period: str | None = None
    period_limit: int | None = Field(default=None, ge=0)
    active: bool | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None

    @field_validator("period")
    @classmethod
    def _period(cls, v: str | None) -> str | None:
        if v is not None and v not in RULE_PERIODS:
            raise ValueError(f"period должен быть одним из {sorted(RULE_PERIODS)}")
        return v


class RewardRuleRead(BaseModel):
    id: int
    season_id: int | None
    source_type: str
    source_code: str
    name: str
    amount: int
    threshold: float | None
    period: str
    period_limit: int
    active: bool
    valid_from: datetime | None
    valid_to: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Сезонные цены ------------------------------------------------------------

class ItemPriceUpsert(BaseModel):
    shop_item_id: int
    season_id: int
    coin_price: int = Field(gt=0)
    active: bool = True


class ItemPriceRead(BaseModel):
    id: int
    shop_item_id: int
    season_id: int
    coin_price: int
    active: bool
    version: int

    model_config = {"from_attributes": True}
