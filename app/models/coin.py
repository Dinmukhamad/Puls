"""Журнал операций с коинами - неизменяемый источник истины (п. 5 «Аудит»)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin
from app.models.enums import TxType

if TYPE_CHECKING:
    from app.models.user import User

JSONType = JSON().with_variant(JSONB(), "postgresql")


class CoinTransaction(Base, TimestampMixin):
    """
    Одна операция с коинами.

    Записи append-only: API не предоставляет методов изменения и удаления,
    а на уровне БД навешаны триггеры, отклоняющие UPDATE/DELETE
    (см. :mod:`app.db.init_db`).
    """

    __tablename__ = "coin_transactions"
    __table_args__ = (
        Index("ix_coin_tx_user_created", "user_id", "created_at"),
        Index("ix_coin_tx_week_user", "week_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Положительное - начисление, отрицательное - списание.
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    tx_type: Mapped[TxType] = mapped_column(String(32), nullable=False, index=True)
    #: Причина/комментарий. Для ручных операций обязателен (п. 3.3).
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    #: Баланс оператора сразу после проведения операции.
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)

    week_id: Mapped[int | None] = mapped_column(
        ForeignKey("contest_weeks.id", ondelete="SET NULL"), nullable=True
    )
    shop_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("shop_requests.id", ondelete="SET NULL"), nullable=True
    )
    #: Автор ручной операции; NULL - операция выполнена системой.
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Ключ идемпотентности: защищает от повторного начисления при перезапуске задачи.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(160), unique=True, nullable=True
    )
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    user: Mapped[User] = relationship(
        "User", foreign_keys=[user_id], back_populates="transactions"
    )
    created_by: Mapped[User | None] = relationship("User", foreign_keys=[created_by_id])

    @property
    def is_manual(self) -> bool:
        return self.tx_type in (TxType.MANUAL_CREDIT, TxType.MANUAL_DEBIT)
