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
