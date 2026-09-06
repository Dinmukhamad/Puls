"""Независимый от коинов опыт и персональные уведомления."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class XpAccount(Base):
    __tablename__ = "xp_accounts"
    __table_args__ = (CheckConstraint("total >= 0", name="xp_non_negative"),)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    total: Mapped[int] = mapped_column(Integer, default=0)


class XpEntry(Base, TimestampMixin):
    __tablename__ = "xp_entries"
    __table_args__ = (CheckConstraint("amount > 0", name="xp_positive"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    total_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(180), unique=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class XpLevel(Base, TimestampMixin):
    __tablename__ = "xp_levels"
    __table_args__ = (CheckConstraint("min_xp >= 0", name="xp_threshold_non_negative"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    min_xp: Mapped[int] = mapped_column(Integer, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(32), default="info")
    link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
