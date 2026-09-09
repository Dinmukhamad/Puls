"""Учебный профиль водителя, настройки парков и сохраняемые заказы."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, utcnow


class DriverSettings(Base):
    __tablename__ = "driver_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    parks: Mapped[list] = mapped_column(JSON, default=list)


class DriverProfile(Base, TimestampMixin):
    __tablename__ = "driver_profiles"
    __table_args__ = (
        CheckConstraint(
            "stage IN ('services', 'cooperation', 'phone', 'loading', 'offline')", name="stage"
        ),
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stage: Mapped[str] = mapped_column(String(20), default="services")
    service: Mapped[str | None] = mapped_column(String(20), nullable=True)
    park: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DriverOrder(Base):
    """Отдельные учебные поездки; не связаны с кошельком и наградами Puls."""

    __tablename__ = "driver_orders"
    __table_args__ = (
        UniqueConstraint("user_id", "active_slot"),
        CheckConstraint("active_slot IS NULL OR active_slot = 1", name="active_slot"),
        CheckConstraint(
            "stage IN ('searching','offer','pickup','waiting',"
            "'trip','payment','complete','cancelled')",
            name="stage",
        ),
        CheckConstraint("payment IN ('cash','card')", name="payment"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    active_slot: Mapped[int | None] = mapped_column(nullable=True)
    stage: Mapped[str] = mapped_column(String(20))
    origin: Mapped[str] = mapped_column(String(160))
    destination: Mapped[str] = mapped_column(String(160))
    payment: Mapped[str] = mapped_column(String(10))
    fare: Mapped[int] = mapped_column()
    commission: Mapped[int] = mapped_column()
    park: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(default=0)
    events: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    stage_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
