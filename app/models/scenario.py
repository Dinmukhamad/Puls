"""Versioned consultation runs with server-verified Work Sites practice."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ScenarioAttempt(Base, TimestampMixin):
    __tablename__ = "scenario_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    scenario_key: Mapped[str] = mapped_column(String(40), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)
    phase: Mapped[str] = mapped_column(String(20), default="dialogue")
    practice: Mapped[dict] = mapped_column(JSON, default=dict)
    is_preview: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    awarded_coins: Mapped[int] = mapped_column(Integer, default=0)
    reward_already_claimed: Mapped[bool] = mapped_column(Boolean, default=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
