"""Account-owned, versioned voice practice; audio is not persisted."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class VoiceTrainingAttempt(Base, TimestampMixin):
    __tablename__ = "voice_training_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    scenario_key: Mapped[str] = mapped_column(String(40), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    persona: Mapped[str] = mapped_column(String(20))
    state: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)
    stage: Mapped[str] = mapped_column(String(20), default="opening")
    turn: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict] = mapped_column(JSON)
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    practice: Mapped[dict] = mapped_column(JSON, default=dict)
    requests: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    review: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    retry_of: Mapped[int | None] = mapped_column(
        ForeignKey("voice_training_attempts.id"), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
