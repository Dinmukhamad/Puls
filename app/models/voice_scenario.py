"""Voice call scenarios written by staff: a draft being edited and the version operators play."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class VoiceScenario(Base, TimestampMixin):
    __tablename__ = "voice_scenarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(140))
    # The draft is what the editor saves; `published` is what operators play, `revision` its number.
    draft: Mapped[dict] = mapped_column(JSON)
    draft_version: Mapped[int] = mapped_column(Integer, default=1)
    published: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    published_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
