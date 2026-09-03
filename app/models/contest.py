"""Конкурсные недели, показатели, результаты и номинации."""
from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.coin import JSONType
from app.models.enums import MetricDirection, MetricKind, WeekStatus

if TYPE_CHECKING:
    from app.models.user import User


class ContestWeek(Base, TimestampMixin):
    """Отчётная неделя конкурса. Уникальна по паре (ISO-год, ISO-неделя)."""

    __tablename__ = "contest_weeks"
    __table_args__ = (UniqueConstraint("iso_year", "iso_week", name="uq_week_year_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    iso_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    iso_week: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(255), default="Байга ОТП")
    status: Mapped[WeekStatus] = mapped_column(
        String(16), default=WeekStatus.OPEN, nullable=False, index=True
    )
    calculated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Снимок правил начисления на момент закрытия: прошлые недели не должны
    #: пересчитываться при последующем изменении настроек.
    rules_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    results: Mapped[list[OperatorWeekResult]] = relationship(
        "OperatorWeekResult", back_populates="week", cascade="all, delete-orphan"
    )
    metrics: Mapped[list[OperatorWeekMetric]] = relationship(
        "OperatorWeekMetric", back_populates="week", cascade="all, delete-orphan"
    )

    @property
    def label(self) -> str:
        return f"{self.iso_year}-W{self.iso_week:02d}"

    @property
    def is_closed(self) -> bool:
        return self.status == WeekStatus.CLOSED


class MetricDefinition(Base, TimestampMixin):
    """
    Настраиваемое правило перевода показателя недели в баллы конкурса.

    Логика начисления баллов вынесена в конфигурацию, а не в код: руководитель
    меняет веса и цели через админ-панель без релиза (п. 4.4.5).
    """

    __tablename__ = "metric_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[MetricKind] = mapped_column(String(16), default=MetricKind.POSITIVE)
    direction: Mapped[MetricDirection] = mapped_column(
        String(24), default=MetricDirection.HIGHER_IS_BETTER
    )
    #: Плановое значение, соответствующее полному выполнению показателя.
    target_value: Mapped[float] = mapped_column(Float, default=1.0)
    #: Максимум баллов, который даёт показатель при выполнении плана.
    max_points: Mapped[float] = mapped_column(Float, default=0.0)
    #: Штраф за единицу антипоказателя (для kind=anti).
    penalty_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    #: Учитывать перевыполнение (баллы всё равно ограничены max_points).
    allow_overachievement: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class OperatorWeekMetric(Base, TimestampMixin):
    """Фактическое значение одного показателя оператора за неделю (шаг 2 п. 7)."""

    __tablename__ = "operator_week_metrics"
    __table_args__ = (
        UniqueConstraint("week_id", "user_id", "metric_code", name="uq_week_user_metric"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[int] = mapped_column(
        ForeignKey("contest_weeks.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    metric_code: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[float] = mapped_column(Float, default=0.0)
    #: Источник данных: manual, import, integration.
    source: Mapped[str] = mapped_column(String(32), default="manual")

    week: Mapped[ContestWeek] = relationship("ContestWeek", back_populates="metrics")
    user: Mapped[User] = relationship("User")


class OperatorWeekResult(Base, TimestampMixin):
    """Итог оператора за неделю: баллы, место, начисленные коины (шаги 3-5 п. 7)."""

    __tablename__ = "operator_week_results"
    __table_args__ = (UniqueConstraint("week_id", "user_id", name="uq_week_user_result"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[int] = mapped_column(
        ForeignKey("contest_weeks.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    base_points: Mapped[float] = mapped_column(Float, default=0.0)
    penalty_points: Mapped[float] = mapped_column(Float, default=0.0)
    final_points: Mapped[float] = mapped_column(Float, default=0.0, index=True)

    rank: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    previous_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Положительное значение означает подъём в рейтинге относительно прошлой недели.
    rank_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    coins_from_points: Mapped[int] = mapped_column(Integer, default=0)
    coins_rank_bonus: Mapped[int] = mapped_column(Integer, default=0)
    coins_discipline_bonus: Mapped[int] = mapped_column(Integer, default=0)
    coins_nomination_bonus: Mapped[int] = mapped_column(Integer, default=0)
    coins_total: Mapped[int] = mapped_column(Integer, default=0)

    lateness_count: Mapped[float] = mapped_column(Float, default=0.0)
    forbidden_sites_count: Mapped[float] = mapped_column(Float, default=0.0)
    #: Разбивка баллов по показателям для прогресс-баров кабинета (п. 4.1.2).
    breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    week: Mapped[ContestWeek] = relationship("ContestWeek", back_populates="results")
    user: Mapped[User] = relationship("User")


class NominationDefinition(Base, TimestampMixin):
    """Номинация недели (п. 4.2.3). Победитель определяется автоматически."""

    __tablename__ = "nomination_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Код показателя-критерия либо служебный __progress__ (прирост баллов к прошлой неделе).
    metric_code: Mapped[str] = mapped_column(String(64))
    direction: Mapped[MetricDirection] = mapped_column(
        String(24), default=MetricDirection.HIGHER_IS_BETTER
    )
    #: Требовать нулевое значение метрики (номинация «Без опозданий»).
    require_zero: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Минимальное значение показателя, ниже которого номинация не присуждается.
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    coins_reward: Mapped[int] = mapped_column(Integer, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)


class NominationWinner(Base, TimestampMixin):
    """Победитель номинации за конкретную неделю."""

    __tablename__ = "nomination_winners"
    __table_args__ = (UniqueConstraint("week_id", "nomination_id", name="uq_week_nomination"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[int] = mapped_column(
        ForeignKey("contest_weeks.id", ondelete="CASCADE"), index=True
    )
    nomination_id: Mapped[int] = mapped_column(
        ForeignKey("nomination_definitions.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    value: Mapped[float] = mapped_column(Float, default=0.0)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0)

    nomination: Mapped[NominationDefinition] = relationship("NominationDefinition")
    user: Mapped[User] = relationship("User")
    week: Mapped[ContestWeek] = relationship("ContestWeek")
