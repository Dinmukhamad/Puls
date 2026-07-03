from __future__ import annotations

from datetime import datetime

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


class WheelStatus(BaseModel):
    campaign: WheelCampaignBrief | None
    available_tickets: int
    spins_used_today: int
    max_spins_per_day: int
    spins_used_this_week: int
    max_spins_per_week: int
    next_ticket_reason: str | None = None


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
