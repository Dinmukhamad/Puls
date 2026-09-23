"""One Work Sites approval per authenticated browser session."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WorkSitesAccess(Base):
    __tablename__ = "work_sites_access"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("user_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
