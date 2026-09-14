"""Бейджи и достижения оператора (п. 4.1.4)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utcnow
from app.models.coin import JSONType
from app.models.enums import BadgeRule

if TYPE_CHECKING:
    from app.models.user import User


class BadgeDefinition(Base, TimestampMixin):
    """
    Описание бейджа и правила его получения.

    Правило хранится как пара ``rule_type`` + ``rule_params``, поэтому новые
    бейджи добавляются через админку без изменения кода.
    """

    __tablename__ = "badge_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rule_type: Mapped[BadgeRule] = mapped_column(String(32), nullable=False)
    rule_params: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    #: Разовый бейдж выдаётся один раз; повторяемый может выдаваться каждую неделю.
    is_repeatable: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    coins_reward: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    awards: Mapped[list[UserBadge]] = relationship(
        "UserBadge", back_populates="badge", cascade="all, delete-orphan"
    )


class UserBadge(Base):
    """Факт выдачи бейджа оператору."""

    __tablename__ = "user_badges"
    __table_args__ = (
        UniqueConstraint("user_id", "badge_id", "week_id", name="uq_user_badge_week"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    badge_id: Mapped[int] = mapped_column(
        ForeignKey("badge_definitions.id", ondelete="CASCADE"), index=True
    )
    #: Неделя, по итогам которой выдан бейдж. NULL - выдан вне недельного расчёта.
    week_id: Mapped[int | None] = mapped_column(
        ForeignKey("contest_weeks.id", ondelete="SET NULL"), nullable=True
    )
    awarded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    user: Mapped[User] = relationship("User", back_populates="badges")
    badge: Mapped[BadgeDefinition] = relationship("BadgeDefinition", back_populates="awards")
    award_key: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
