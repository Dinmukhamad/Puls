from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.cabinet import BadgeOut
from app.schemas.common import ORMModel


class ProgressLevelOut(ORMModel):
    id: int
    title: str
    min_coins: int
    description: str | None
    is_active: bool


class ProgressLevelIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    min_coins: int = Field(ge=0, le=100000000)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool = True


class ProgressSummary(BaseModel):
    total: int
    available: int
    current: ProgressLevelOut | None
    next: ProgressLevelOut | None
    level_number: int
    remaining: int
    progress: float
    levels: list[ProgressLevelOut]
    achievements: list[BadgeOut]


class NotificationOut(ORMModel):
    id: int
    title: str
    body: str
    kind: str
    link: str | None
    read_at: datetime | None
    created_at: datetime
