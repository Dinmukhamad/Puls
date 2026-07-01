from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class OperatorLevelRuleBase(BaseModel):
    metric_code: str
    operator: str = Field(pattern="^(gte|lte|eq|between)$")
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    is_required: bool = True


class OperatorLevelRuleCreate(OperatorLevelRuleBase):
    pass


class OperatorLevelRuleUpdate(BaseModel):
    metric_code: Optional[str] = None
    operator: Optional[str] = Field(default=None, pattern="^(gte|lte|eq|between)$")
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    is_required: Optional[bool] = None


class OperatorLevelRuleRead(OperatorLevelRuleBase):
    id: int
    level_id: int
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


class OperatorLevelCreate(OperatorLevelBase):
    pass


class OperatorLevelUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class OperatorLevelRead(OperatorLevelBase):
    id: int
    created_at: datetime
    updated_at: datetime
    rules: list[OperatorLevelRuleRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class OperatorLevelBadge(BaseModel):
    id: Optional[int] = None
    code: str = "trainee"
    name: str = "Стажёр"
    color: str = "#64748B"
    icon: str = ""
    sort_order: int = 10


class OperatorLevelGap(BaseModel):
    metric_code: str
    label: str
    operator: str
    required_min: Optional[float] = None
    required_max: Optional[float] = None
    current: Optional[float] = None
    ok: bool


class OperatorLevelSummary(BaseModel):
    operator_id: int
    assignment_type: str = "auto"
    is_manual: bool = False
    level: OperatorLevelBadge
    next_level: Optional[OperatorLevelBadge] = None
    metrics: dict
    gaps: list[OperatorLevelGap] = Field(default_factory=list)
    calculated_from: Optional[date] = None
    calculated_to: Optional[date] = None
    manual_reason: Optional[str] = None
    manual_comment: Optional[str] = None
    assigned_at: Optional[datetime] = None


class OperatorLevelRecalculateRequest(BaseModel):
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    mode: str = "all"


class OperatorManualLevelRequest(BaseModel):
    level_id: int
    reason: str
    comment: Optional[str] = ""


class OperatorLevelHistoryRead(BaseModel):
    id: int
    operator_id: int
    operator_name: Optional[str] = None
    old_level: Optional[OperatorLevelBadge] = None
    new_level: Optional[OperatorLevelBadge] = None
    change_type: str
    reason: Optional[str] = None
    comment: Optional[str] = None
    changed_by_name: Optional[str] = None
    changed_at: datetime
    metadata: Optional[dict] = None
