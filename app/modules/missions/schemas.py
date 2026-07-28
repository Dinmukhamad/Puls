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
    can_start: bool = False
    can_replay: bool = False
    active_attempt_id: int | None = None
    current_step_key: str | None = None
    attempts_count: int = 0
    completed_attempts_count: int = 0
    reward_claimed: bool = False
    reward_eligible: bool = False
    reward_state: str = "not_available"
    best_score: float | None = None
    completed_at: datetime | None = None
    action_label: str


class MissionMapRead(BaseModel):
    missions: list[MissionCardRead]
    completed: int
    total: int
    percent: int
    earned_coins: int


class LearningWorldRead(BaseModel):
    id: int
    code: str
    title: str
    description: str
    icon: str
    illustration_key: str
    accent_color: str
    sort_order: int
    availability: str
    completed_count: int
    total_count: int
    percent: int
    coins_available: int
    reward_total: int
    reward_earned: int
    reward_available: int


class LearningWorldMapRead(BaseModel):
    worlds: list[LearningWorldRead]
    completed: int
    total: int
    percent: int
    reward_total: int
    reward_earned: int
    reward_available: int


class LearningWorldRouteRead(LearningWorldRead):
    missions: list[MissionCardRead]


class AdminWorldMissionRead(BaseModel):
    id: int
    code: str
    title: str
    world_sort_order: int

    model_config = {"from_attributes": True}


class LearningWorldAdminRead(BaseModel):
    id: int
    code: str
    title: str
    description: str
    icon: str
    illustration_key: str
    accent_color: str
    sort_order: int
    is_active: bool
    availability: str
    created_at: datetime
    updated_at: datetime
    missions: list[AdminWorldMissionRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class LearningWorldCreate(BaseModel):
    code: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    icon: str = Field(default="map", max_length=80)
    illustration_key: str = Field(default="city", max_length=80)
    accent_color: str = Field(default="#4F46E5", max_length=16)
    sort_order: int = 0
    availability: str = "available"
    is_active: bool = True


class LearningWorldPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    icon: str | None = Field(default=None, max_length=80)
    illustration_key: str | None = Field(default=None, max_length=80)
    accent_color: str | None = Field(default=None, max_length=16)
    sort_order: int | None = None
    availability: str | None = None
    is_active: bool | None = None


class MissionWorldAssignment(BaseModel):
    world_id: int = Field(ge=1)
    world_sort_order: int = Field(ge=0)


class MissionSettingRead(BaseModel):
    id: int
    mission_id: int
    key: str
    value: dict[str, Any]
    version: int
    effective_from: datetime
    is_active: bool
    updated_by: int | None
    updated_at: datetime


class ProviderWindowUpdate(BaseModel):
    start_day: int = Field(ge=1, le=31)
    end_day: int = Field(ge=1, le=31)
    timezone: str = "Asia/Almaty"
    operator_message: str = Field(min_length=1, max_length=1000)
    effective_from: datetime | None = None
    is_active: bool = True


class ProviderWindowPreview(BaseModel):
    year: int
    month: int
    start_day: int
    end_day: int
    timezone: str
    days: list[dict[str, Any]]


class DocumentSigningWindowUpdate(BaseModel):
    start_day: int = Field(default=5, ge=1, le=31)
    end_day: int = Field(default=15, ge=1, le=31)
    timezone: str = "Asia/Almaty"
    exception_end_day: int | None = Field(default=None, ge=1, le=31)
    exception_year_month: str | None = Field(default=None, max_length=7)
    operator_message: str = Field(min_length=1, max_length=1000)
    effective_from: datetime | None = None


class DocumentSigningWindowPreview(BaseModel):
    year: int
    month: int
    start_day: int
    base_end_day: int
    effective_end_day: int
    effective_end_date: str
    timezone: str
    target_period: dict[str, Any]
    days: list[dict[str, Any]]


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
    display_number: int
    mission_version: int
    attempt_number: int
    status: AttemptStatus
    current_step: MissionStepRead
    progress_percent: int
    reward_coins: int
    reward_eligible: bool
    reward_awarded: bool
    reward_received: int | None = None
    reward_currency: str = "₡"
    active_duration_seconds: int | None = None
    reward_message: str | None = None
    score: float | None = None
    max_score: float | None = None
    best_score: float | None = None
    best_score_snapshot: float | None = None
    is_new_best: bool = False
    replay_of_attempt_id: int | None = None
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
    median_active_duration_seconds: float = 0
    anomalous_duration_count: int = 0
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
    active_duration_seconds: int | None = None
    duration_anomalous: bool = False


class MissionAttemptAdminList(BaseModel):
    items: list[MissionAttemptAdminRead]
    total: int
