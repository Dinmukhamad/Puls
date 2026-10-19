"""Схемы турнирной таблицы (п. 4.2)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

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
    updated_at: datetime | None = Field(default=None, description="Момент последнего пересчёта")


class RatingProgressPoint(BaseModel):
    week_id: int | None
    label: str
    starts_on: date
    status: WeekStatus | None
    rank: int | None
    points: float | None
    coins: int | None


class RatingProgress(BaseModel):
    points: list[RatingProgressPoint]


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
    winner_hidden: bool = Field(
        default=False, description="Победитель определён, но его личные данные скрыты"
    )


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
    view_mode: Literal["personal", "table"] = "table"
    my_gap_to_podium: float | None = Field(
        default=None, ge=0,
        description="Разница до призового балла; равный балл тоже даёт призовое место",
    )
    my_podium_state: Literal[
        "uncalculated", "not_participating", "on_podium", "outside_podium"
    ] = "not_participating"


# --------------------------------------------------------------------------- #
# «Гонка недели» (services/race.py)
# --------------------------------------------------------------------------- #


class RaceWeek(BaseModel):
    id: int
    label: str
    starts_on: date
    ends_on: date
    status: WeekStatus


class RacePlace(BaseModel):
    """An operator in the week's race; others are named «Имя Ф.»."""

    rank: int
    name: str
    points: float
    gap: float | None = Field(default=None, description="Их баллы минус мои: выше - больше нуля")
    rank_delta: int | None = None
    is_me: bool = False


class RaceBehind(RacePlace):
    lead: float = Field(description="Мой отрыв от ближайшего оператора ниже")


class RaceMe(BaseModel):
    rank: int
    points: float
    rank_delta: int | None = None
    shared_with: list[str] = Field(default_factory=list, description="С кем место поделено поровну")


class RacePodiumPlace(BaseModel):
    place: int
    name: str
    points: float
    gap: float | None = None
    reached: bool = False


class RaceMetric(BaseModel):
    code: str
    title: str
    unit: str | None = None
    direction: str
    value: float | None = None
    target: float
    points: float
    max_points: float
    lost: float = Field(description="Сколько баллов показатель недобирает до максимума")
    reported: bool
    per_unit: float | None = Field(
        default=None, description="Баллов за единицу показателя «больше - лучше» до цели"
    )


class RaceOption(BaseModel):
    code: str
    title: str
    unit: str | None = None
    value: float | None = None
    need: float = Field(description="Значение, которое нужно показать")
    gain: float = Field(description="Сколько баллов это добавит")


class RacePlan(BaseModel):
    reachable: bool
    steps: list[RaceOption]
    gain: float


class RaceNextAdvice(BaseModel):
    rank: int
    name: str
    gap: float
    options: list[RaceOption]
    plan: RacePlan


class RacePodiumAdvice(BaseModel):
    place: int
    name: str
    gap: float
    plan: RacePlan


class RaceAdvice(BaseModel):
    room: float = Field(description="Сколько баллов ещё не набрано по всем показателям")
    next: RaceNextAdvice | None = None
    podium: RacePodiumAdvice | None = None


class RaceOut(BaseModel):
    """«Гонка недели»: место оператора среди всех, отставание и что подтянуть."""

    week: RaceWeek | None = None
    live: bool = Field(default=False, description="Неделя не рассчитана: места по загрузке")
    period: str = Field(description="month - призы раз в месяц, week - за места недели")
    prizes: list[int] = Field(default_factory=list, description="Бонусы за 1-3 места недели")
    participants: int
    max_points: float
    me: RaceMe | None = None
    next: RacePlace | None = None
    behind: RaceBehind | None = None
    podium: list[RacePodiumPlace]
    standings: list[RacePlace]
    metrics: list[RaceMetric]
    advice: RaceAdvice | None = None


class CompareWeek(RaceWeek):
    live: bool = False


class CompareMonth(BaseModel):
    year: int
    month: int
    name: str
    weeks_planned: int


class CompareMark(BaseModel):
    rank: int | None
    points: float


class CompareRow(BaseModel):
    user_id: int
    name: str
    group_id: int | None = None
    group: str | None = None
    rank: int | None
    points: float
    rank_delta: int | None = None
    weeks: int | None = Field(default=None, description="Недель в зачёте месяца")
    prize: int | None = Field(default=None, description="Приз месяца за место и номинации")
    is_me: bool = False
    trail: list[CompareMark | None] = Field(description="Место и баллы в каждой неделе из weeks")


class CompareBest(BaseModel):
    name: str
    points: float
    is_me: bool = False


class CompareTeam(BaseModel):
    group_id: int
    name: str
    rank: int
    members: int
    points: float = Field(description="Средние баллы оператора команды")
    total: float
    best: CompareBest
    is_mine: bool = False
    trail: list[float | None]


class CompareMetric(BaseModel):
    code: str
    title: str
    unit: str | None = None
    direction: str
    target: float
    me: float | None = None
    average: float
    best: float
    reported: int = Field(description="Сколько операторов показали этот показатель")
    place: int | None = Field(default=None, description="Место оператора по этому показателю")
    points: float | None = None
    max_points: float


class CompareOut(BaseModel):
    """«Рейтинг» оператора: таблица, места по неделям, команды и показатели против всех."""

    period: Literal["week", "month"]
    title: str
    status: str
    live: bool = False
    week: CompareWeek | None = None
    month: CompareMonth | None = None
    participants: int
    weeks: list[CompareWeek]
    operators: list[CompareRow]
    teams: list[CompareTeam]
    metrics: list[CompareMetric]
