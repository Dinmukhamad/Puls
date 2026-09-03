"""Настройки правил геймификации и журнал аудита действий (п. 4.4.5, п. 5)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.coin import JSONType

if TYPE_CHECKING:
    from app.models.user import User

#: Идентификатор единственной строки настроек.
SETTINGS_SINGLETON_ID = 1


class GamificationSettings(Base, TimestampMixin):
    """
    Единственная строка с параметрами начисления.

    Значения по умолчанию соответствуют п. 3.1 и 3.2 ТЗ.
    """

    __tablename__ = "gamification_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("points_per_coin > 0", name="rate_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SETTINGS_SINGLETON_ID)

    #: Курс перевода: сколько баллов конкурса даёт один коин (п. 3.1).
    points_per_coin: Mapped[float] = mapped_column(default=5.0, nullable=False)

    #: Бонусы за призовые места недели (п. 3.2).
    rank1_bonus: Mapped[int] = mapped_column(Integer, default=15)
    rank2_bonus: Mapped[int] = mapped_column(Integer, default=10)
    rank3_bonus: Mapped[int] = mapped_column(Integer, default=7)

    #: Дисциплинарные бонусы (п. 3.2).
    no_lateness_bonus: Mapped[int] = mapped_column(Integer, default=5)
    no_forbidden_sites_bonus: Mapped[int] = mapped_column(Integer, default=3)

    #: Бонус за номинацию по умолчанию, если у номинации не задан свой.
    nomination_bonus_default: Mapped[int] = mapped_column(Integer, default=5)
    #: Начисление за благодарность водителя при ручном начислении (п. 3.2).
    driver_gratitude_bonus: Mapped[int] = mapped_column(Integer, default=3)

    #: Коды антипоказателей, участвующих в дисциплинарных бонусах.
    lateness_metric_code: Mapped[str] = mapped_column(String(64), default="lateness")
    forbidden_sites_metric_code: Mapped[str] = mapped_column(
        String(64), default="forbidden_sites"
    )

    #: Ограничение на одну ручную операцию, чтобы опечатка не сломала экономику.
    manual_max_abs_amount: Mapped[int] = mapped_column(Integer, default=100)
    #: Минимальная длина комментария к ручной операции (п. 3.3 - комментарий обязателен).
    manual_reason_min_length: Mapped[int] = mapped_column(Integer, default=5)

    #: Начислять дисциплинарный бонус только если антипоказатель за неделю
    #: реально выгружен. Иначе отсутствие данных трактуется как «нарушений нет».
    discipline_requires_reported: Mapped[bool] = mapped_column(Boolean, default=True)

    #: Показывать ли операторам общий баланс коллег в рейтинге.
    #: По умолчанию выключено: п. 5 требует скрывать чужие детали.
    rating_show_balance_to_operators: Mapped[bool] = mapped_column(Boolean, default=False)

    #: Минимальное количество участников недели для присуждения номинаций.
    nomination_min_participants: Mapped[int] = mapped_column(Integer, default=3)

    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[User | None] = relationship("User")

    def rank_bonus(self, rank: int | None) -> int:
        """Бонус за место в рейтинге недели."""
        return {1: self.rank1_bonus, 2: self.rank2_bonus, 3: self.rank3_bonus}.get(rank or 0, 0)

    def as_snapshot(self) -> dict[str, Any]:
        """Слепок правил для сохранения вместе с закрытой неделей."""
        return {
            "points_per_coin": self.points_per_coin,
            "rank1_bonus": self.rank1_bonus,
            "rank2_bonus": self.rank2_bonus,
            "rank3_bonus": self.rank3_bonus,
            "no_lateness_bonus": self.no_lateness_bonus,
            "no_forbidden_sites_bonus": self.no_forbidden_sites_bonus,
            "nomination_bonus_default": self.nomination_bonus_default,
            "lateness_metric_code": self.lateness_metric_code,
            "forbidden_sites_metric_code": self.forbidden_sites_metric_code,
        }


class AuditLog(Base, TimestampMixin):
    """Журнал действий персонала: кто, что и когда изменил (п. 5 «Аудит»)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor: Mapped[User | None] = relationship("User")
