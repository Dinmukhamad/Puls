"""Схемы турнирной таблицы (п. 4.2)."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.enums import WeekStatus
from app.schemas.common import ORMModel


class WeekOut(ORMModel):
    id: int
    iso_year: int
    iso_week: int
    label: str
    title: str
    starts_on: date
    ends_on: date
    status: WeekStatus
    calculated_at: datetime | None = None
    closed_at: datetime | None = None


class RatingHeader(BaseModel):
    """Шапка конкурса (п. 4.2.1)."""

    contest_title: str
    week_id: int
    week_label: str
    period_start: date
    period_end: date
    status: WeekStatus
    participants: int
    updated_at: datetime | None = Field(
        default=None, description="Момент последнего пересчёта"
    )


class RatingRowOut(BaseModel):
    """Строка общей таблицы (п. 4.2.4)."""

    rank: int | None
    user_id: int
    full_name: str
    group_name: str | None = None
    points: float
    coins_week: int
    balance: int | None = Field(
        default=None, description="Общий баланс; скрыт, если просмотр чужих данных запрещён"
    )
    rank_delta: int | None = None
    is_me: bool = False


class PodiumEntry(RatingRowOut):
    """Место на пьедестале (п. 4.2.2)."""

    medal: str = Field(description="gold / silver / bronze")


class NominationOut(BaseModel):
    """Номинация недели с победителем (п. 4.2.3)."""

    code: str
    title: str
    description: str | None = None
    winner_id: int | None = None
    winner_name: str | None = None
    winner_group: str | None = None
    value: float = 0.0
    coins_awarded: int = 0


class RatingOut(BaseModel):
    """Полный ответ вкладки «Рейтинг»."""

    header: RatingHeader
    podium: list[PodiumEntry]
    nominations: list[NominationOut]
    rows: list[RatingRowOut]
    total: int
    page: int
    size: int
    my_row: RatingRowOut | None = None
