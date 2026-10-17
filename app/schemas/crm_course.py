from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

CourseTask = Literal[
    "crm_intro_v2", "crm_phone_v2", "crm_mismatch_v2", "crm_rework_v2", "crm_practice_v2"
]


class CourseAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["list", "appeal", "ticket", "inspect", "advice"]
    driver_id: str | None = Field(default=None, max_length=80)
    choices: list[str] = Field(default_factory=list, max_length=5)


class TicketAction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    revision: int = Field(ge=1)
    action: Literal["moderate", "rework", "comment"]
    comment: str = Field(default="", max_length=10000)
    draft_key: str | None = Field(default=None, max_length=36)
    draft_revision: int | None = Field(default=None, ge=0)
