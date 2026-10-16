"""Persistent ordinary CRM practice, separate from appeal business statuses."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CrmTrainingAttempt(Base):
    __tablename__ = "crm_training_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "task_key"),
        UniqueConstraint("appeal_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    task_key: Mapped[str] = mapped_column(String(40))
    revision: Mapped[int] = mapped_column(default=1)
    snapshot: Mapped[dict] = mapped_column(JSON)
    phase: Mapped[str] = mapped_column(String(20), default="started")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    appeal_id: Mapped[int | None] = mapped_column(ForeignKey("crm_appeals.id"), nullable=True)
    checks: Mapped[list] = mapped_column(JSON, default=list)


class CrmTrainingCheck(Base):
    __tablename__ = "crm_training_checks"
    __table_args__ = (UniqueConstraint("user_id", "request_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    task_key: Mapped[str] = mapped_column(String(40))
    appeal_id: Mapped[int] = mapped_column(ForeignKey("crm_appeals.id"))
    result: Mapped[dict] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
