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
    #: line or chat (a team's hours, calls or chats, fines), quality (reviewers' scores) or
    #: unknown.
    kind: Literal["line", "chat", "quality", "unknown"]
    people: int


class ReportNoteOut(BaseModel):
    """Data the reports could not place, and whose it is."""

    code: str
    title: str
    names: list[str] = Field(default_factory=list)


class ReportWeekOut(BaseModel):
    label: str
    starts_on: str
    ends_on: str
    status: str
    operators: int


class ReportPendingOut(BaseModel):
    """A week touching the month that waits for days not reported yet."""

    label: str
    starts_on: str
    ends_on: str
    operators: int
    #: «ждёт отчёта за октябрь», «ждёт выгрузки после 18.10».
    reason: str


class ReportPreviewOut(BaseModel):
    month: str
    files: list[ReportFileOut]
    matched: int
    matched_names: list[str] = Field(default_factory=list)
    unmatched: list[str] = Field(default_factory=list)
    without_data: int = 0
    day_values: int = 0
    #: The last day the team reports cover, by channel (line, chat); absent — no team report.
    reported_to: dict[str, str] = Field(default_factory=dict)
    notes: list[ReportNoteOut] = Field(default_factory=list)
    weeks: list[ReportWeekOut] = Field(default_factory=list)
    pending: list[ReportPendingOut] = Field(default_factory=list)
    detail: str | None = None
