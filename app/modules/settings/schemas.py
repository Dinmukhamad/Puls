from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CoinRuleRead(BaseModel):
    id: int
    points_per_coin: int
    rounding_mode: str
    min_points_for_accrual: float
    top_1_bonus: int
    top_2_bonus: int
    top_3_bonus: int
    no_late_bonus: int
    no_violation_bonus: int
    nomination_bonus: int
    driver_thanks_bonus: int
    nomination_calls_enabled: bool
    nomination_quality_enabled: bool
    nomination_efficiency_enabled: bool
    nomination_progress_enabled: bool
    nomination_thanks_enabled: bool
    accrue_to_fired: bool
    accrue_to_inactive: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    updated_by_user_id: int | None = None
    updated_by_name: str | None = None

    model_config = {"from_attributes": True}


class CoinRuleUpdate(BaseModel):
    """Все поля опциональны — обновляются только переданные (ТЗ 4.5, PUT /settings/coin-rules)."""

    points_per_coin: int | None = Field(default=None, gt=0)
    rounding_mode: str | None = Field(default=None, pattern="^(floor|ceil|round)$")
    min_points_for_accrual: float | None = Field(default=None, ge=0)
    top_1_bonus: int | None = Field(default=None, ge=0)
    top_2_bonus: int | None = Field(default=None, ge=0)
    top_3_bonus: int | None = Field(default=None, ge=0)
    no_late_bonus: int | None = Field(default=None, ge=0)
    no_violation_bonus: int | None = Field(default=None, ge=0)
    nomination_bonus: int | None = Field(default=None, ge=0)
    driver_thanks_bonus: int | None = Field(default=None, ge=0)
    nomination_calls_enabled: bool | None = None
    nomination_quality_enabled: bool | None = None
    nomination_efficiency_enabled: bool | None = None
    nomination_progress_enabled: bool | None = None
    nomination_thanks_enabled: bool | None = None
    accrue_to_fired: bool | None = None
    accrue_to_inactive: bool | None = None
