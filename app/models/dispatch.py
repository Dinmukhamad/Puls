"""The operator's own changes in the training fleet cabinet «Диспетчерская»."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class DispatchEvent(Base):
    """One accepted action. The cabinet is the shipped seed with these events applied in order."""

    __tablename__ = "dispatch_events"
    __table_args__ = (UniqueConstraint("user_id", "request_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(20))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # The mascot's call this action solved, decided on the server when it was accepted.
    solved: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
