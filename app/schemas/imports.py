"""Read-only validation result for a period import."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.admin import MetricValueIn


class ImportIssue(BaseModel):
    row: int | None = None
    field: str | None = None
    code: str
    message: str


class ImportPreviewOut(BaseModel):
    filename: str
    format: Literal["long", "wide"] = "long"
    total_rows: int = 0
    operator_count: int = 0
    valid_values: int = 0
    values: list[MetricValueIn] = Field(default_factory=list)
    errors: list[ImportIssue] = Field(default_factory=list)
    warnings: list[ImportIssue] = Field(default_factory=list)
    can_apply: bool = False
