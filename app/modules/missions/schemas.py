from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

MissionStatus = Literal["available", "in_progress", "completed", "locked"]
AttemptStatus = Literal["in_progress", "completed", "cancelled"]


class MissionCardRead(BaseModel):
    code: str
    title: str
    description: str
    mission_type: str
    sort_order: int
    reward_coins: int
    estimated_minutes: int
    version: int
    status: MissionStatus
    current_step_key: str | None = None
    attempts_count: int = 0
    reward_claimed: bool = False
    action_label: str


class MissionMapRead(BaseModel):
    missions: list[MissionCardRead]
    completed: int
    total: int
    percent: int
    earned_coins: int


class MissionMetadataRead(BaseModel):
    code: str
    title: str
    description: str
    mission_type: str
    reward_coins: int
    estimated_minutes: int
    version: int
    steps_count: int


class MissionStepRead(BaseModel):
    step_key: str
    step_order: int
    total_steps: int
    step_type: str
    screen_key: str
    action_key: str
    content: dict[str, Any]
    hint_available: bool
    completed_targets: list[str] = Field(default_factory=list)
    required_target: str | None = None


class MissionAttemptRead(BaseModel):
    id: int
    mission_code: str
    mission_title: str
    mission_version: int
    attempt_number: int
    status: AttemptStatus
    current_step: MissionStepRead
    progress_percent: int
    reward_coins: int
    reward_eligible: bool
    reward_awarded: bool
    reward_message: str | None = None
    score: float | None = None
    max_score: float | None = None
    best_score: float | None = None
    state: dict[str, Any] = Field(default_factory=dict)
    license_identity: dict[str, str] = Field(default_factory=dict)
    errors_count: int
    hints_used: int
    started_at: datetime
    completed_at: datetime | None = None
    autosave_state: str = "Сохранено"


class MissionActionRequest(BaseModel):
    action_key: str = Field(min_length=1, max_length=80)
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def validate_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 8:
            raise ValueError("Слишком много полей действия")
        allowed_types = (str, int, float, bool, type(None))
        if any(not isinstance(item, allowed_types) for item in value.values()):
            raise ValueError("Недопустимый тип данных действия")
        if any(len(str(item)) > 120 for item in value.values()):
            raise ValueError("Слишком длинное значение действия")
        return value


class MissionActionResult(BaseModel):
    attempt: MissionAttemptRead
    accepted: bool
    feedback: str


class MissionHintRead(BaseModel):
    hint: str
    attempt: MissionAttemptRead


class MissionStatsRead(BaseModel):
    mission_code: str | None = None
    started_operators: int
    completed_operators: int
    conversion_percent: float
    average_duration_seconds: float
    repeat_operators: int
    awarded_coins: int
    drop_off_by_step: dict[str, int]
    average_score: float = 0
    best_score: float = 0
    errors_by_type: dict[str, int] = Field(default_factory=dict)
    problem_slots: dict[str, int] = Field(default_factory=dict)


class MissionAttemptAdminRead(BaseModel):
    id: int
    mission_code: str
    mission_title: str
    operator_id: int
    operator_name: str
    status: str
    current_step_key: str
    attempt_number: int
    errors_count: int
    hints_used: int
    reward_awarded: bool
    started_at: datetime
    completed_at: datetime | None
    duration_seconds: int | None


class MissionAttemptAdminList(BaseModel):
    items: list[MissionAttemptAdminRead]
    total: int
