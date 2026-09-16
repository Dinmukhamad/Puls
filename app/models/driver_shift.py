"""Единая учебная смена и обращение в Telegram, отдельно от экономики Puls."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class DriverShift(Base):
    __tablename__ = "driver_shifts"
    __table_args__ = (
        UniqueConstraint("user_id", "active_slot"),
        CheckConstraint("mode IN ('free','assessment')", name="mode"),
        CheckConstraint("active_slot IS NULL OR active_slot = 1", name="active_slot"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    active_slot: Mapped[int | None] = mapped_column(nullable=True)
    mode: Mapped[str] = mapped_column(String(16))
    config: Mapped[dict] = mapped_column(JSON)
    data: Mapped[dict] = mapped_column(JSON)
    events: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_preview: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    content_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_contents.id"), nullable=True, index=True
    )


class DriverSupportCase(Base):
    __tablename__ = "driver_support_cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shift_id: Mapped[str] = mapped_column(
        ForeignKey("driver_shifts.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    topic: Mapped[str] = mapped_column(String(40))
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    telegram_version: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(16), default="pending")
    step: Mapped[int] = mapped_column(default=0)
    answers: Mapped[list] = mapped_column(JSON, default=list)
    config: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
