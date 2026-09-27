"""City performance reports from the 3D city (city TZ §8.4, §10): kept 90 days, no personal data."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CityPerfReport(Base):
    """One aggregate the city sends every 60 s and on leave; append-only, purged daily."""

    __tablename__ = "city_perf_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Indexed for the retention purge; no updated_at: a report is never changed.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True
    )
    backend: Mapped[str] = mapped_column(String(16))
    gpu: Mapped[str] = mapped_column(String(128), default="")
    width: Mapped[int]
    height: Mapped[int]
    dpr: Mapped[float] = mapped_column(Float)
    tier: Mapped[str] = mapped_column(String(16))
    fps_avg: Mapped[float] = mapped_column(Float)
    fps_p1: Mapped[float] = mapped_column(Float)
    first_frame_ms: Mapped[int | None]
    concessions: Mapped[list[str]] = mapped_column(JSON, default=list)
