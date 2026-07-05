"""Pydantic-схемы модуля reports (ТЗ §15.4). Перенос из routers/period_reports.py."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class OperatorMetricsOut(BaseModel):
    full_name: str
    operator_id: int | None = None
    group_name: str | None = None
    quality_avg: float
    quality_calls_count: int
    total_hours: float
    base_hours: float
    tech_issue_hours: float
    training_hours: float
    offline_activity_hours: float
    calls_total: float
    kvz: float
    call_time_hours: float
    efficiency_percent: float
    penalty_sum: float
    penalty_minutes: float
    penalty_points: float
    final_points: float
    warnings: list[str] = []
    # Норма часов
    rate: float | None = None
    individual_norm_hours: float = 0.0
    norm_completion_percent: float = 0.0
    hours_points: float = 0.0
    overtime_hours: float = 0.0
    overtime_percent: float = 0.0
    norm_warnings: list[str] = []


class PeriodWarningsOut(BaseModel):
    site_only: list[str] = []
    file_only: list[str] = []
    norm_warnings: list[str] = []
    no_quality: list[str] = []
    no_base_hours: list[str] = []
    ignored_service_rows: list[str] = []


class PeriodSummaryOut(BaseModel):
    period: dict
    operators: list[OperatorMetricsOut]
    warnings: PeriodWarningsOut
    summary: dict


class SavePeriodReportRequest(BaseModel):
    start_date: date
    end_date: date
    award_coins: bool = False
    coins_per_points: float = 5.0
