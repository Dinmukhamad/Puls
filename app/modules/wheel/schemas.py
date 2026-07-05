from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class WheelPrizeRead(BaseModel):
    id: int
    title: str
    type: str
    amount: int
    color: str


class WheelCampaignBrief(BaseModel):
    id: int
    title: str


class LastPrize(BaseModel):
    title: str
    type: str | None = None
    value: int | None = None
    at: str | None = None


class WheelStatus(BaseModel):
    campaign: WheelCampaignBrief | None
    available_tickets: int
    spins_used_today: int
    max_spins_per_day: int
    spins_used_this_week: int
    max_spins_per_week: int
    next_ticket_reason: str | None = None
    can_spin: bool = False
    reason_if_cannot_spin: str | None = None
    last_prize: LastPrize | None = None


class SpinPrize(BaseModel):
    id: int
    title: str
    type: str
    amount: int
    color: str


class SpinResult(BaseModel):
    spin_id: int
    prize: SpinPrize
    reason: str | None = None
    message: str


class MySpinRow(BaseModel):
    date: str
    reason: str | None
    prize: str
    prize_type: str
    amount: int
    status: str


class AdminSpinRow(BaseModel):
    id: int
    date: str
    operator_id: int
    operator_name: str
    group_name: str | None
    reason: str | None
    prize: str
    prize_type: str
    amount: int
    status: str


class IssueTicketRequest(BaseModel):
    operator_id: int
    campaign_id: int | None = None
    reason_text: str = Field(min_length=1, max_length=500)
    ttl_days: int | None = Field(default=None, ge=1, le=30)


class TicketIssuedResponse(BaseModel):
    ticket_id: int
    operator_id: int
    status: str
    expires_at: datetime | None


# ── Админка: правила (ТЗ 8.3, 14) ────────────────────────────────────────────

class RuleBase(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    source_module: str = Field(max_length=40)
    rule_type: str = Field(max_length=48)
    metric_key: str = ""
    operator: str = "gte"
    threshold_value: float = 0
    threshold_value_max: float | None = None
    period_type: str = "daily"
    max_tokens_per_period: int = Field(default=1, ge=0)
    token_ttl_hours: int = Field(default=24, ge=1, le=8760)
    is_active: bool = True
    priority: int = 0


class RuleCreate(RuleBase):
    campaign_id: int | None = None


class RuleUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    source_module: str | None = None
    rule_type: str | None = None
    metric_key: str | None = None
    operator: str | None = None
    threshold_value: float | None = None
    threshold_value_max: float | None = None
    period_type: str | None = None
    max_tokens_per_period: int | None = Field(default=None, ge=0)
    token_ttl_hours: int | None = Field(default=None, ge=1, le=8760)
    is_active: bool | None = None
    priority: int | None = None


class RuleRead(RuleBase):
    id: int
    campaign_id: int


# ── Админка: призы (ТЗ 8.2, 14) ──────────────────────────────────────────────

class PrizeBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    prize_type: str = Field(max_length=32)
    amount: int = 0
    weight: int = Field(default=1, ge=0)
    color: str = "#38BDF8"
    is_active: bool = True
    max_wins_total: int = Field(default=0, ge=0)
    max_wins_per_operator: int = Field(default=0, ge=0)
    daily_limit: int = Field(default=0, ge=0)
    weekly_limit: int = Field(default=0, ge=0)
    monthly_limit: int = Field(default=0, ge=0)
    per_operator_daily_limit: int = Field(default=0, ge=0)
    per_operator_weekly_limit: int = Field(default=0, ge=0)
    sort_order: int = 0


class PrizeCreate(PrizeBase):
    campaign_id: int | None = None


class PrizeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    prize_type: str | None = None
    amount: int | None = None
    weight: int | None = Field(default=None, ge=0)
    color: str | None = None
    is_active: bool | None = None
    max_wins_total: int | None = Field(default=None, ge=0)
    max_wins_per_operator: int | None = Field(default=None, ge=0)
    daily_limit: int | None = Field(default=None, ge=0)
    weekly_limit: int | None = Field(default=None, ge=0)
    monthly_limit: int | None = Field(default=None, ge=0)
    per_operator_daily_limit: int | None = Field(default=None, ge=0)
    per_operator_weekly_limit: int | None = Field(default=None, ge=0)
    sort_order: int | None = None


class PrizeRead(PrizeBase):
    id: int
    campaign_id: int


# ── Админка: токены и логи (ТЗ 8.5, 8.7, 14) ─────────────────────────────────

class TokenRow(BaseModel):
    id: int
    operator_id: int
    operator_name: str
    rule_id: int | None
    reason_type: str
    reason_text: str
    source_module: str | None
    source_entity_id: int | None
    status: str
    created_at: str
    expires_at: str | None
    used_at: str | None


class GrantTokenRequest(BaseModel):
    operator_id: int
    campaign_id: int | None = None
    tokens_count: int = Field(default=1, ge=1, le=20)
    reason: str = Field(min_length=1, max_length=200)
    comment: str = ""
    ttl_hours: int | None = Field(default=None, ge=1, le=8760)


class EvaluationLogRow(BaseModel):
    id: int
    operator_id: int
    operator_name: str
    rule_id: int | None
    source_module: str
    source_entity_id: int | None
    metric_value: float | None
    threshold_value: float | None
    operator: str
    is_eligible: bool
    reason: str
    created_token_id: int | None
    created_at: str


# ── Админка: кампания (ТЗ 11.1, 12.1) ────────────────────────────────────────

class CampaignBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    is_active: bool = True
    start_date: date | None = None
    end_date: date | None = None
    max_spins_per_day: int = Field(default=1, ge=0, le=50)
    max_spins_per_week: int = Field(default=3, ge=0, le=200)
    ticket_ttl_days: int = Field(default=3, ge=1, le=90)


class CampaignCreate(CampaignBase):
    pass


class CampaignUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    is_active: bool | None = None
    start_date: date | None = None
    end_date: date | None = None
    max_spins_per_day: int | None = Field(default=None, ge=0, le=50)
    max_spins_per_week: int | None = Field(default=None, ge=0, le=200)
    ticket_ttl_days: int | None = Field(default=None, ge=1, le=90)


class CampaignRead(CampaignBase):
    id: int
    created_at: str | None = None
    updated_at: str | None = None


# ── Победитель дня (ТЗ 10) ───────────────────────────────────────────────────

class WinnerRow(BaseModel):
    operator_id: int
    operator_name: str
    group_name: str | None = None
    prize: str
    prize_type: str
    amount: int
    reason: str | None = None
    at: str


class WinnersToday(BaseModel):
    date: str
    count: int
    top: WinnerRow | None = None
    items: list[WinnerRow] = []
