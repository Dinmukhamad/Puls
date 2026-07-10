from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RaffleWinnerRead(BaseModel):
    operator_id: int
    operator_name: str = ""
    tickets_at_draw: int
    prize_coins: int

    model_config = {"from_attributes": True}


class RaffleRead(BaseModel):
    id: int
    title: str
    description: str
    prize_coins: int
    prize_description: str
    winners_count: int
    status: str
    ends_at: datetime | None
    created_at: datetime
    drawn_at: datetime | None
    participants: int = 0
    total_tickets: int = 0
    winners: list[RaffleWinnerRead] = []
    my_tickets_in: int = 0  # сколько своих билетов вложил текущий оператор

    model_config = {"from_attributes": True}


class RaffleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    prize_coins: int = Field(default=0, ge=0)
    prize_description: str = Field(default="", max_length=300)
    winners_count: int = Field(default=1, ge=1, le=100)
    ends_at: datetime | None = None


class RaffleEnterRequest(BaseModel):
    tickets: int = Field(ge=1, le=1000)


class OperatorRaffleView(BaseModel):
    raffle_tickets: int
    raffles: list[RaffleRead]
