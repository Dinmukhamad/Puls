"""Схемы личного кабинета оператора (п. 4.1)."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.enums import MetricKind, TxType
from app.schemas.common import ORMModel


class BalanceBlock(BaseModel):
    """Блок «Мой баланс» (п. 4.1.1)."""

    balance: int = Field(description="Коинов на балансе прямо сейчас")
    reserved: int = Field(description="Зарезервировано под заявки из магазина")
    available: int = Field(description="Доступно к трате")
    earned_this_week: int
    total_earned: int
    total_spent: int
    rank: int | None = None
    participants: int = 0
    previous_rank: int | None = None
    rank_delta: int | None = Field(
        default=None, description="Положительное значение - подъём в рейтинге"
    )


class MetricProgress(BaseModel):
    """Прогресс-бар по одному показателю недели (п. 4.1.2)."""

    code: str
    title: str
    unit: str | None = None
    kind: MetricKind
    value: float
    target: float
    completion: float = Field(description="Доля выполнения плана, 0..1")
    points: float
    max_points: float
    penalty: float = Field(default=0.0, description="Штрафные баллы антипоказателя")


class WeekMetricsBlock(BaseModel):
    """Блок «Показатели недели» (п. 4.1.2)."""

    week_id: int | None = None
    week_label: str | None = None
    week_status: str | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    base_points: float = 0.0
    penalty_points: float = 0.0
    final_points: float = 0.0
    metrics: list[MetricProgress] = Field(default_factory=list)
    coins_from_points: int = 0
    coins_rank_bonus: int = 0
    coins_discipline_bonus: int = 0
    coins_nomination_bonus: int = 0
    coins_total: int = Field(default=0, description="Сколько коинов принесёт неделя")
    is_final: bool = Field(
        default=False, description="True - неделя закрыта, коины уже начислены"
    )


class TransactionOut(ORMModel):
    """Строка истории начислений и списаний (п. 4.1.3)."""

    id: int
    amount: int
    tx_type: TxType
    reason: str
    balance_after: int
    created_at: datetime
    week_id: int | None = None
    shop_request_id: int | None = None
    author_name: str | None = Field(
        default=None, description="ФИО автора ручной операции; пусто - начислено системой"
    )


class BadgeOut(BaseModel):
    """Бейдж на доске достижений (п. 4.1.4)."""

    code: str
    title: str
    description: str | None = None
    icon: str | None = None
    unlocked: bool
    awarded_at: datetime | None = None
    progress_current: float = 0.0
    progress_target: float = 0.0
    progress_percent: float = 0.0
    hint: str = Field(default="", description="Чего не хватает до получения")


class NominationBrief(BaseModel):
    code: str
    title: str
    coins_awarded: int


class DashboardOut(BaseModel):
    """Сводка кабинета: всё, что показывается на главном экране оператора."""

    user_id: int
    full_name: str
    group_name: str | None = None
    balance: BalanceBlock
    week: WeekMetricsBlock
    badges_unlocked: int = 0
    badges_total: int = 0
    my_nominations: list[NominationBrief] = Field(default_factory=list)
    pending_shop_requests: int = 0
    shop_url_hint: str = Field(
        default="/api/v1/shop/items", description="Быстрый переход в магазин (п. 4.1.5)"
    )
