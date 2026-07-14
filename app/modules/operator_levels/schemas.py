from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

OperatorLevelMetricCode = Literal[
    "tenure_days",
    "quality",
    "kvz",
    "efficiency",
    "penalty_minutes",
    "final_points",
    "test_percent",
    "total_xp",
]


class OperatorLevelRuleBase(BaseModel):
    metric_code: OperatorLevelMetricCode
    operator: str = Field(pattern="^(gte|lte|eq|between)$")
    value_min: float | None = None
    value_max: float | None = None
    is_required: bool = True


class OperatorLevelRuleCreate(OperatorLevelRuleBase):
    pass


class OperatorLevelRuleUpdate(BaseModel):
    metric_code: OperatorLevelMetricCode | None = None
    operator: str | None = Field(default=None, pattern="^(gte|lte|eq|between)$")
    value_min: float | None = None
    value_max: float | None = None
    is_required: bool | None = None


class OperatorLevelRuleRead(OperatorLevelRuleBase):
    id: int
    level_id: int
    metric_label: str = ""
    operator_label: str = ""
    condition_text: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OperatorLevelBase(BaseModel):
    code: str
    name: str
    description: str = ""
    color: str = "#64748B"
    icon: str = ""
    sort_order: int = 0
    is_active: bool = True
    min_total_xp: int = Field(default=0, ge=0)
    reward_coins: int = Field(default=0, ge=0)
    reward_once: bool = True
    coin_multiplier_percent: float = 0
    shop_discount_percent: float = 0


class OperatorLevelCreate(OperatorLevelBase):
    pass


class OperatorLevelUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    min_total_xp: int | None = Field(default=None, ge=0)
    reward_coins: int | None = Field(default=None, ge=0)
    reward_once: bool | None = None
    coin_multiplier_percent: float | None = None
    shop_discount_percent: float | None = None


class OperatorLevelRead(OperatorLevelBase):
    id: int
    stage_number: int = 0
    rules_count: int = 0
    reward_label: str = "Без награды за повышение"
    created_at: datetime
    updated_at: datetime
    rules: list[OperatorLevelRuleRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class OperatorLevelBadge(BaseModel):
    id: int | None = None
    code: str = "trainee"
    name: str = "Стажёр"
    color: str = "#64748B"
    icon: str = ""
    sort_order: int = 10
    reward_coins: int = 0
    reward_once: bool = True
    min_total_xp: int = 0


class OperatorLevelGap(BaseModel):
    metric_code: str
    label: str
    operator: str
    required_min: float | None = None
    required_max: float | None = None
    current: float | None = None
    ok: bool


class OperatorLevelSummary(BaseModel):
    operator_id: int
    assignment_type: str = "auto"
    is_manual: bool = False
    level: OperatorLevelBadge
    next_level: OperatorLevelBadge | None = None
    metrics: dict
    gaps: list[OperatorLevelGap] = Field(default_factory=list)
    calculated_from: date | None = None
    calculated_to: date | None = None
    manual_reason: str | None = None
    manual_comment: str | None = None
    assigned_at: datetime | None = None
    current_level_reward: dict | None = None
    next_level_reward: dict | None = None


class OperatorLevelRecalculateRequest(BaseModel):
    period_start: date | None = None
    period_end: date | None = None
    mode: str = "all"


class OperatorManualLevelRequest(BaseModel):
    level_id: int
    reason: str
    comment: str | None = ""


class OperatorLevelHistoryRead(BaseModel):
    id: int
    operator_id: int
    operator_name: str | None = None
    old_level: OperatorLevelBadge | None = None
    new_level: OperatorLevelBadge | None = None
    change_type: str
    reason: str | None = None
    comment: str | None = None
    changed_by_name: str | None = None
    changed_at: datetime
    metadata: dict | None = None
    reward_coins: int = 0
    coin_transaction_id: int | None = None
