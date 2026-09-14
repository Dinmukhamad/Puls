"""Учебные материалы и попытки с зафиксированной версией заданий."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class LearningContent(Base, TimestampMixin):
    __tablename__ = "learning_contents"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    world: Mapped[str] = mapped_column(String(80), default="Общее")
    difficulty: Mapped[str] = mapped_column(String(20), default="basic")
    minutes: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allow_back: Mapped[bool] = mapped_column(Boolean, default=True)
    pass_percent: Mapped[int] = mapped_column(Integer, default=80)
    legacy_reward: Mapped[int] = mapped_column("xp_reward", Integer, default=0)
    coins_reward: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    steps: Mapped[list] = mapped_column(JSON, default=list)


class LearningAttempt(Base, TimestampMixin):
    __tablename__ = "learning_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content_id: Mapped[int] = mapped_column(ForeignKey("learning_contents.id"), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    state: Mapped[str] = mapped_column(String(32), default="in_progress")
    sim_stage: Mapped[str] = mapped_column(String(32), default="registration")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    correct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    legacy_awarded: Mapped[int] = mapped_column("awarded_xp", Integer, default=0)
    awarded_coins: Mapped[int] = mapped_column(Integer, default=0)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LearningAward(Base):
    __tablename__ = "learning_awards"
    __table_args__ = (UniqueConstraint("user_id", "content_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content_id: Mapped[int] = mapped_column(ForeignKey("learning_contents.id"))
    attempt_id: Mapped[int] = mapped_column(ForeignKey("learning_attempts.id"), unique=True)
