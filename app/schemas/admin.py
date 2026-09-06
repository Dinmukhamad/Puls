"""Схемы административной панели и настроек (п. 4.4)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, FiniteFloat, model_validator

from app.models.enums import BadgeRule, MetricDirection, MetricKind
from app.schemas.common import ORMModel


class SummaryOut(BaseModel):
    """Сводная статистика (п. 4.4.1)."""

    operators_total: int
    operators_active: int
    coins_awarded_this_week: int
    new_shop_requests: int
    average_rank: float | None = None
    week_label: str | None = None
    week_status: str | None = None


class OperatorRowOut(BaseModel):
    """Строка таблицы операторов (п. 4.4.2)."""

    user_id: int
    full_name: str
    login: str
    group_name: str | None = None
    rank: int | None = None
    points: float
    coins_week: int
    balance: int
    reserved: int
    total_earned: int
    total_spent: int
    lateness: float
    forbidden_sites: float


class ManualCoinsIn(BaseModel):
    """Ручное начисление или списание (п. 3.3, 4.4.3)."""

    user_id: int
    amount: int = Field(description="Положительное - начисление, отрицательное - списание")
    reason: str = Field(min_length=1, max_length=500, description="Обязательный комментарий")
    request_id: str | None = Field(default=None, min_length=16, max_length=80)

    @model_validator(mode="after")
    def _non_zero(self) -> ManualCoinsIn:
        if self.amount == 0:
            raise ValueError("Количество коинов не может быть нулевым")
        return self


class ManualCoinsBulkIn(BaseModel):
    """Пакетное ручное начисление нескольким операторам одной причиной."""

    user_ids: list[int] = Field(min_length=1)
    amount: int
    reason: str = Field(min_length=1, max_length=500)


class GratitudeIn(BaseModel):
    """Благодарность от водителя фиксированным бонусом (п. 3.2)."""

    user_id: int
    request_id: str | None = Field(default=None, min_length=16, max_length=80)
    driver_ref: str | None = Field(
        default=None, max_length=64, description="Номер водителя или заявки"
    )


# --------------------------------------------------------------------------- #
# Недели и показатели
# --------------------------------------------------------------------------- #


class WeekCreate(BaseModel):
    any_day: date = Field(
        description="Любая дата внутри недели; границы вычисляются по ISO-календарю"
    )
    title: str | None = None


class MetricValueIn(BaseModel):
    user_id: int = Field(gt=0)
    metric_code: str = Field(min_length=1, max_length=64)
    value: FiniteFloat


class MetricsBulkIn(BaseModel):
    """Загрузка показателей недели (шаг 2 п. 7)."""

    values: list[MetricValueIn] = Field(min_length=1, max_length=100000)
    source: str = Field(default="import", max_length=32)
    replace: bool = Field(
        default=False,
        description="Удалить показатели недели перед загрузкой вместо обновления",
    )


class WeekCloseReportOut(BaseModel):
    week_id: int
    week_label: str
    participants: int
    coins_awarded: int
    nominations_awarded: int
    badges_awarded: int
    already_closed: bool = False


class WeekPreviewRow(BaseModel):
    user_id: int
    full_name: str
    rank: int | None
    final_points: float
    coins_total: int
    coins_from_points: int
    coins_rank_bonus: int
    coins_discipline_bonus: int
    coins_nomination_bonus: int
    missing_metrics: list[str] = Field(default_factory=list)


class WeekPreviewOut(BaseModel):
    week_id: int
    week_label: str
    status: str
    participants: int
    coins_total: int
    missing_metrics: list[str] = Field(
        default_factory=list, description="Показатели, не выгруженные ни по одному оператору"
    )
    rows: list[WeekPreviewRow] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Настройки правил (п. 4.4.5)
# --------------------------------------------------------------------------- #


class RulesOut(ORMModel):
    points_per_coin: float
    rank1_bonus: int
    rank2_bonus: int
    rank3_bonus: int
    no_lateness_bonus: int
    no_forbidden_sites_bonus: int
    nomination_bonus_default: int
    driver_gratitude_bonus: int
    lateness_metric_code: str
    forbidden_sites_metric_code: str
    manual_max_abs_amount: int
    manual_reason_min_length: int
    discipline_requires_reported: bool
    rating_show_balance_to_operators: bool
    nomination_min_participants: int


class RulesUpdate(BaseModel):
    points_per_coin: float | None = Field(default=None, gt=0)
    rank1_bonus: int | None = Field(default=None, ge=0)
    rank2_bonus: int | None = Field(default=None, ge=0)
    rank3_bonus: int | None = Field(default=None, ge=0)
    no_lateness_bonus: int | None = Field(default=None, ge=0)
    no_forbidden_sites_bonus: int | None = Field(default=None, ge=0)
    nomination_bonus_default: int | None = Field(default=None, ge=0)
    driver_gratitude_bonus: int | None = Field(default=None, ge=0)
    lateness_metric_code: str | None = None
    forbidden_sites_metric_code: str | None = None
    manual_max_abs_amount: int | None = Field(default=None, ge=1)
    manual_reason_min_length: int | None = Field(default=None, ge=0)
    discipline_requires_reported: bool | None = None
    rating_show_balance_to_operators: bool | None = None
    nomination_min_participants: int | None = Field(default=None, ge=0)


class MetricOut(ORMModel):
    id: int
    code: str
    title: str
    unit: str | None = None
    kind: MetricKind
    direction: MetricDirection
    target_value: float
    max_points: float
    penalty_per_unit: float
    allow_overachievement: bool
    is_active: bool
    sort_order: int
    description: str | None = None


class MetricCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    unit: str | None = None
    kind: MetricKind = MetricKind.POSITIVE
    direction: MetricDirection = MetricDirection.HIGHER_IS_BETTER
    target_value: float = 1.0
    max_points: float = 0.0
    penalty_per_unit: float = 0.0
    allow_overachievement: bool = True
    is_active: bool = True
    sort_order: int = 100
    description: str | None = None


class MetricUpdate(BaseModel):
    title: str | None = None
    unit: str | None = None
    kind: MetricKind | None = None
    direction: MetricDirection | None = None
    target_value: float | None = None
    max_points: float | None = Field(default=None, ge=0)
    penalty_per_unit: float | None = Field(default=None, ge=0)
    allow_overachievement: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    description: str | None = None


class NominationOut(ORMModel):
    id: int
    code: str
    title: str
    description: str | None = None
    metric_code: str
    direction: MetricDirection
    require_zero: bool
    min_value: float | None = None
    coins_reward: int
    is_active: bool
    sort_order: int


class NominationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    metric_code: str = Field(min_length=1, max_length=64)
    description: str | None = None
    direction: MetricDirection = MetricDirection.HIGHER_IS_BETTER
    require_zero: bool = False
    min_value: float | None = None
    coins_reward: int = Field(default=5, ge=0)
    is_active: bool = True
    sort_order: int = 100


class NominationUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    metric_code: str | None = None
    direction: MetricDirection | None = None
    require_zero: bool | None = None
    min_value: float | None = None
    coins_reward: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None


class LevelOut(ORMModel):
    id: int
    code: str
    title: str
    description: str | None = None
    min_earned: int
    is_active: bool
    sort_order: int


class LevelCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    min_earned: int = Field(ge=0, description="Порог в накопленных за всё время коинах")
    description: str | None = None
    is_active: bool = True
    sort_order: int = 100


class LevelUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    min_earned: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None


class BadgeOut(ORMModel):
    id: int
    code: str
    title: str
    description: str | None = None
    icon: str | None = None
    rule_type: BadgeRule
    rule_params: dict
    is_repeatable: bool
    is_active: bool
    sort_order: int


class BadgeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    rule_type: BadgeRule
    rule_params: dict = Field(default_factory=dict)
    description: str | None = None
    icon: str | None = None
    is_repeatable: bool = False
    is_active: bool = True
    sort_order: int = 100


class BadgeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    icon: str | None = None
    rule_type: BadgeRule | None = None
    rule_params: dict | None = None
    is_repeatable: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None
