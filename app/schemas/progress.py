from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class XpLevelOut(ORMModel):
    id: int
    title: str
    min_xp: int
    description: str | None
    is_active: bool


class XpLevelIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    min_xp: int = Field(ge=0)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool = True


class XpSummary(BaseModel):
    total: int
    current: XpLevelOut | None
    next: XpLevelOut | None
    remaining: int
    progress: float
    levels: list[XpLevelOut]


class XpEntryOut(ORMModel):
    id: int
    user_id: int
    amount: int
    total_after: int
    reason: str
    source: str
    created_at: datetime
    full_name: str | None = None


class XpGrant(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    user_id: int = Field(gt=0)
    amount: int = Field(gt=0, le=100000)
    reason: str = Field(min_length=5, max_length=500)
    request_id: str = Field(min_length=16, max_length=80)


class NotificationOut(ORMModel):
    id: int
    title: str
    body: str
    kind: str
    link: str | None
    read_at: datetime | None
    created_at: datetime
