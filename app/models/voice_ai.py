"""What each call to the AI model cost: the monthly budget is the sum of these rows."""

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class VoiceAIUsage(Base, TimestampMixin):
    __tablename__ = "voice_ai_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    # "driver" — a driver's line, "grade" — the review of a finished call.
    purpose: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(60))
    attempt_id: Mapped[int | None] = mapped_column(
        ForeignKey("voice_training_attempts.id"), nullable=True, index=True
    )
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
