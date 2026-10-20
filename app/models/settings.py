"""Настройки правил геймификации и журнал аудита действий (п. 4.4.5, п. 5)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Integer, String, Text
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

    #: Курс перевода: сколько баллов конкурса даёт один коин (п. 3.1). 0.5 - балл даёт 2 коина
    #: (экономика 2.24.52, docs/COIN_ECONOMY.md).
    points_per_coin: Mapped[float] = mapped_column(default=0.5, nullable=False)

    #: Бонусы за призовые места конкурса (п. 3.2): месяца, если ``contest_period`` - "month".
    rank1_bonus: Mapped[int] = mapped_column(Integer, default=300)
    rank2_bonus: Mapped[int] = mapped_column(Integer, default=200)
    rank3_bonus: Mapped[int] = mapped_column(Integer, default=150)

    #: Дисциплинарные бонусы недели (п. 3.2).
    no_lateness_bonus: Mapped[int] = mapped_column(Integer, default=25)
    no_forbidden_sites_bonus: Mapped[int] = mapped_column(Integer, default=15)

    #: Бонус за номинацию по умолчанию, если у номинации не задан свой.
    nomination_bonus_default: Mapped[int] = mapped_column(Integer, default=100)
    #: Начисление за благодарность водителя при ручном начислении (п. 3.2).
    driver_gratitude_bonus: Mapped[int] = mapped_column(Integer, default=30)
    #: Сколько благодарностей водителей оплачивается одному оператору за календарный месяц.
    gratitude_monthly_limit: Mapped[int] = mapped_column(Integer, default=5, server_default="5")

    #: Как часто разыгрываются места и номинации: "week" - каждую неделю, "month" - раз в месяц
    #: (неделя относится к месяцу своего четверга). Баллы и дисциплина начисляются каждую неделю.
    contest_period: Mapped[str] = mapped_column(String(8), default="month", server_default="month")

    #: Прямые штрафы при закрытии недели: за каждое опоздание и каждый посторонний сайт.
    #: Не хватает коинов - остаток спишется при следующем закрытии (CoinAccount.fine_debt).
    lateness_fine: Mapped[int] = mapped_column(Integer, default=50, server_default="50")
    forbidden_site_fine: Mapped[int] = mapped_column(Integer, default=30, server_default="30")

    #: Сколько коинов супервайзер может начислить вручную за календарный месяц (всем своим
    #: операторам вместе). 0 - без ограничения. Руководитель и администратор не ограничены.
    manual_monthly_limit: Mapped[int] = mapped_column(Integer, default=1500, server_default="1500")

    #: Сколько тенге стоит коин в магазине и бюджет магазина на месяц: заявки на бонусы с
    #: денежной стоимостью принимаются, пока бюджет месяца не исчерпан. 0 - без бюджета.
    coin_rate_tenge: Mapped[float] = mapped_column(default=5.0, server_default="5")
    shop_monthly_budget_tenge: Mapped[int] = mapped_column(
        Integer, default=50000, server_default="50000"
    )

    #: Коды антипоказателей, участвующих в дисциплинарных бонусах.
    lateness_metric_code: Mapped[str] = mapped_column(String(64), default="lateness")
    forbidden_sites_metric_code: Mapped[str] = mapped_column(
        String(64), default="forbidden_sites"
    )

    #: Ограничение на одну ручную операцию, чтобы опечатка не сломала экономику.
    manual_max_abs_amount: Mapped[int] = mapped_column(Integer, default=200)
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
    #: Приз за место — только с этим средним баллом за неделю: за месяц — сумма баллов, делённая
    #: на рассчитанные недели месяца, в недельном конкурсе — баллы недели. 0 — без порога.
    prize_min_points: Mapped[float] = mapped_column(Float, default=50.0, server_default="50")

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
            "contest_period": self.contest_period,
            "lateness_fine": self.lateness_fine,
            "forbidden_site_fine": self.forbidden_site_fine,
            "forbidden_sites_metric_code": self.forbidden_sites_metric_code,
            "prize_min_points": self.prize_min_points,
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
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

    actor: Mapped[User | None] = relationship("User")
