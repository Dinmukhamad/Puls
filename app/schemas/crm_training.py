"""Clients submit identifiers only; checklist evidence is always server-owned."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CrmTrainingStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID | None = None


class CrmTrainingCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    appeal_id: int = Field(gt=0)
    request_id: UUID
