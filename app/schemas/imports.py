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


class ReportFileOut(BaseModel):
    filename: str
    #: team (hours, calls, efficiency), quality (reviewers' scores) or unknown.
    kind: Literal["team", "quality", "unknown"]
    people: int


class ReportWeekOut(BaseModel):
    label: str
    starts_on: str
    ends_on: str
    status: str
    operators: int


class ReportPreviewOut(BaseModel):
    month: str
    files: list[ReportFileOut]
    matched: int
    matched_names: list[str] = Field(default_factory=list)
    unmatched: list[str] = Field(default_factory=list)
    without_data: int = 0
    day_values: int = 0
    weeks: list[ReportWeekOut] = Field(default_factory=list)
    detail: str | None = None
