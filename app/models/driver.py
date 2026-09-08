"""Учебный профиль водителя: вход и просмотр приложения без поездок."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class DriverSettings(Base):
    __tablename__ = "driver_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    parks: Mapped[list] = mapped_column(JSON, default=list)


class DriverProfile(Base, TimestampMixin):
    __tablename__ = "driver_profiles"
    __table_args__ = (
        CheckConstraint("stage IN ('services', 'cooperation', 'loading', 'offline')", name="stage"),
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stage: Mapped[str] = mapped_column(String(20), default="services")
    service: Mapped[str | None] = mapped_column(String(20), nullable=True)
    park: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
