from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AchievementRead(BaseModel):
    id: int
    code: str
    title: str
    description: str
    icon: str
    condition_type: str
    condition_value: float
    reward_coins: int
    is_repeatable: bool
    is_active: bool

    model_config = {"from_attributes": True}


class AchievementUpdate(BaseModel):
    is_active: bool | None = None
    reward_coins: int | None = None


class OperatorAchievementRead(BaseModel):
    achievement: AchievementRead
    progress_value: float
    is_completed: bool
    times_awarded: int
    completed_at: datetime | None
    last_awarded_at: datetime | None


class OperatorAchievementsResponse(BaseModel):
    """ТЗ 5.7/7.5: кабинет показывает отдельно полученные и ближайшие достижения."""
    completed: list[OperatorAchievementRead]
    in_progress: list[OperatorAchievementRead]


class GrantAchievementRequest(BaseModel):
    operator_id: int
    comment: str | None = None
