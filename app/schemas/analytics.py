"""Analytics over recorded weekly values; absent observations remain null."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.models.enums import MetricDirection, MetricKind
from app.schemas.rating import WeekOut


class MetricSummary(BaseModel):
    code: str
    title: str
    unit: str | None
    direction: MetricDirection
    kind: MetricKind
    target: float
    value: float | None
    previous: float | None
    delta: float | None
    improved: bool | None
    reported: int
    total: int
    coverage: float | None
    below_target: int


class TrendPoint(BaseModel):
    week_id: int | None
    label: str
    starts_on: date
    value: float | None
    reported: int


class ComparisonSeries(BaseModel):
    id: int
    name: str
    value: float | None
    previous: float | None
    delta: float | None
    improved: bool | None
    reported: int
    total: int
    values: list[float | None]


class AnalyticsOperator(BaseModel):
    user_id: int
    full_name: str
    group_id: int | None
    group_name: str | None
    value: float | None
    previous: float | None
    delta: float | None
    improved: bool | None
    target_met: bool | None
    points: float | None
    rank: int | None
    missing_metrics: list[str]
    values: dict[str, float | None]
    trend: list[float | None]


class AnalyticsOut(BaseModel):
    week: WeekOut | None
    #: day, week or month: what one point of the trend and the selected period mean.
    grain: str = "week"
    period_label: str | None = None
    period_from: date | None = None
    period_to: date | None = None
    metric_code: str | None
    operator_count: int
    operators_with_data: int
    pending_requests: int
    coins_awarded: int
    metrics: list[MetricSummary] = Field(default_factory=list)
    trend: list[TrendPoint] = Field(default_factory=list)
    groups: list[ComparisonSeries] = Field(default_factory=list)
    comparisons: list[ComparisonSeries] = Field(default_factory=list)
    operators: list[AnalyticsOperator] = Field(default_factory=list)
    methodology: str = (
        "Среднее по загруженным значениям действующих операторов. "
        "Группы и состав команды — текущие. Цели — действующие настройки. "
        "Пропуски не считаются нулями. Число отдельных проверок качества не хранится."
    )
