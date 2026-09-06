from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class WheelSegment(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=100)
    weight: int = Field(ge=1, le=10000)
    xp: int = Field(default=0, ge=0, le=10000)
    coins: int = Field(default=0, ge=0, le=1000)


class WheelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    daily_spins: int = Field(ge=1, le=10)
    segments: list[WheelSegment] = Field(min_length=2, max_length=12)


class SpinInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: str = Field(min_length=16, max_length=80)


class RaffleInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    prize: str = Field(min_length=1, max_length=180)
    closes_at: datetime
    status: Literal["draft", "published"] = "draft"
    xp_reward: int = Field(default=0, ge=0, le=100000)
    coins_reward: int = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def aware_deadline(self):
        if self.closes_at.tzinfo is None:
            raise ValueError("Укажите часовой пояс срока розыгрыша")
        return self
