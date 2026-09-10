"""Один черновик на пользователя и временное состояние активной поездки, без GPS-журнала."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DriverRouteDraft(Base):
    __tablename__ = "driver_route_drafts"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(36), unique=True)
    data: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DriverNavigation(Base):
    __tablename__ = "driver_navigation"
    order_id: Mapped[str] = mapped_column(
        ForeignKey("driver_orders.id", ondelete="CASCADE"), primary_key=True
    )
    route: Mapped[dict] = mapped_column(JSON)
    current: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    data: Mapped[dict] = mapped_column(JSON)


class DriverMapRate(Base):
    __tablename__ = "driver_map_rates"
    provider: Mapped[str] = mapped_column(String(20), primary_key=True)
    next_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
