"""Accepted actions in an individual's simulated Oktell workspace."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class OktellEvent(Base):
    __tablename__ = "oktell_events"
    __table_args__ = (UniqueConstraint("user_id", "request_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(24))
    # Only accepted, non-secret training inputs. Login passwords are never recorded.
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    completed: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
