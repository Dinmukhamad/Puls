"""Типизированные контракты ответов аналитики (ТЗ §10.4).

Раньше модуль сообщал, что response-моделей нет. Здесь введены явные схемы
для daily-эндпоинтов: они документируют контракт, используются в тестах и
дают единый формат metric-metadata (label, formula, unit, target,
critical_threshold, direction, версия целей).
"""
from __future__ import annotations

from pydantic import BaseModel


class MetricDefinition(BaseModel):
    metric_key: str
    label: str
    definition: str
    formula: str
    unit: str
    target: float | None = None
    critical_threshold: float | None = None
    direction: str
    targets_version: str


class ScopeInfo(BaseModel):
    kind: str
    label: str
    group_id: int | None = None
    operator_id: int | None = None


class PeriodDelta(BaseModel):
    start: str
    end: str
    average: float | None = None
    change: float | None = None


class DailyPoint(BaseModel):
    date: str
    value: float | None = None
    calls: float | None = None
    kvz: float | None = None
    quality: float | None = None
    efficiency: float | None = None
    penalty: float | None = None
    operators_on_line: float | None = None
    has_data: bool


class DailyDynamicsResponse(BaseModel):
    metric: str
    metric_definition: MetricDefinition
    scope: ScopeInfo
    items: list[DailyPoint]
    covered_dates: list[str]
    missing_dates: list[str]
    operators_with_data: int
    previous_period: PeriodDelta
    data_source: str
    empty_reason: str | None = None


class DailyGridCell(BaseModel):
    value: float | None = None
    count: int | None = None


class DailyGridOperator(BaseModel):
    operator_id: int
    full_name: str
    group_id: int | None = None
    values: dict[str, DailyGridCell]


class DailyGridLegend(BaseModel):
    critical: float | None = None
    target: float | None = None
    direction: str


class DailyGridResponse(BaseModel):
    metric: str
    metric_definition: MetricDefinition
    scope: ScopeInfo
    week_start: str
    dates: list[str]
    operators: list[DailyGridOperator]
    legend: DailyGridLegend
    data_source: str
    empty_reason: str | None = None
