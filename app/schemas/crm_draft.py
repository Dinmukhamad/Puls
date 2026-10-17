"""Bounded snapshots allow incomplete forms without accepting arbitrary JSON."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Task = Literal[
    "crm_first",
    "crm_phone",
    "crm_closed",
    "crm_intro_v2",
    "crm_phone_v2",
    "crm_mismatch_v2",
    "crm_rework_v2",
    "crm_practice_v2",
]


class DraftForm(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    request_id: str | None = Field(default=None, max_length=36)
    channel: str | None = Field(default=None, max_length=12)
    phone: str | None = Field(default=None, max_length=40)
    license_number: str | None = Field(default=None, max_length=80)
    driver_id: str | None = Field(default=None, max_length=80)
    contacted_at: str | None = Field(default=None, max_length=80)
    park: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    category_ids: list[str] | None = Field(default=None, max_length=10)
    details: dict[str, str] | None = Field(default=None, max_length=15)
    comment: str | None = Field(default=None, max_length=10000)
    is_ticket: bool | None = None

    @field_validator("category_ids")
    @classmethod
    def bounded_categories(cls, value):
        if value is not None and any(len(item) > 64 for item in value):
            raise ValueError("Некорректная категория")
        return value

    @field_validator("details")
    @classmethod
    def bounded_details(cls, value):
        # Share the final-form whitelist, while allowing blank partial values.
        from app.schemas.crm import AppealInput

        return AppealInput.bound_details(value) if value is not None else value


class DraftPutInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    task: Task | None = None
    draft_key: str | None = Field(default=None, min_length=1, max_length=36)
    revision: int = Field(ge=0)
    form: DraftForm
    remove_attachment_ids: list[int] = Field(default_factory=list, max_length=5)
    appeal_id: int | None = Field(default=None, gt=0)
    remove_appeal_attachment_ids: list[int] = Field(default_factory=list, max_length=5)

    @field_validator("remove_attachment_ids", "remove_appeal_attachment_ids")
    @classmethod
    def positive_unique_ids(cls, value):
        if any(item <= 0 for item in value) or len(set(value)) != len(value):
            raise ValueError("Некорректные идентификаторы вложений")
        return value
