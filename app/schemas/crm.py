from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AppealInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    channel: Literal["Звонок", "Чат"] = "Звонок"
    phone: str = Field(min_length=5, max_length=40)
    license_number: str = Field(min_length=1, max_length=80)
    driver_id: str = Field(default="", max_length=80)
    contacted_at: datetime
    park: str = Field(max_length=100)
    city: str = Field(max_length=100)
    category_ids: list[str] = Field(min_length=1, max_length=10)
    details: dict[str, str] = Field(default_factory=dict, max_length=10)
    comment: str = Field(default="", max_length=10000)
    is_ticket: bool = False
    training_task: Literal["crm_first", "crm_phone", "crm_closed"] | None = None
    draft_key: str | None = Field(default=None, min_length=1, max_length=36)
    draft_revision: int | None = Field(default=None, ge=0)
    revision: int | None = Field(default=None, ge=1)
    remove_attachment_ids: list[int] = Field(default_factory=list, max_length=5)

    @field_validator("remove_attachment_ids")
    @classmethod
    def own_attachment_ids(cls, value):
        if any(item <= 0 for item in value) or len(value) != len(set(value)):
            raise ValueError("Некорректные идентификаторы вложений")
        return value

    @field_validator("contacted_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("Дата обращения должна содержать часовой пояс")
        return value.astimezone(UTC)

    @field_validator("details")
    @classmethod
    def bound_details(cls, value):
        allowed = {
            "company",
            "callback",
            "service",
            "employee",
            "transaction",
            "conditions",
            "error_description",
            "scenario_attempt",
            "scenario_checks",
            "scenario_outcome",
            "scenario_next_action",
            "scenario_diagnostics",
            "scenario_office",
            "scenario_visit_time",
        }
        if set(value) - allowed or any(len(v) > 2000 for v in value.values()):
            raise ValueError("Некорректные дополнительные поля")
        return {k: v.strip() for k, v in value.items()}


class CategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    parent_id: str | None = Field(default=None, max_length=64)
    label: str = Field(min_length=1, max_length=160)
    hint: str = Field(default="", max_length=2000)


class StatusInput(BaseModel):
    status: Literal["new", "in_progress", "closed"]


class InstructionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=6000)
    steps: list[str] = Field(default_factory=list, max_length=12)
    revision: int = Field(ge=0)

    @field_validator("steps")
    @classmethod
    def valid_steps(cls, value):
        if any(not step.strip() or len(step) > 600 for step in value):
            raise ValueError("Каждый шаг должен содержать от 1 до 600 символов")
        return [step.strip() for step in value]
