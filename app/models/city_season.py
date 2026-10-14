"""Seasons of the team districts (docs/CITY_SEASONS.md): built from a start until a reset ends them.

One row has no `ended_at`: the season going on, whose `period` and `ends_at` are the schedule both
cities share. A reset closes it with what everyone saw of both cities that day and their totals,
and opens the next. Training is not part of a season: missions, rewards, experience and coins stay.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CitySeason(Base):
    __tablename__ = "city_seasons"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    #: week, 2weeks, month, 2months, 3months; None: the city is not reset by itself.
    period: Mapped[str | None] = mapped_column(String(10), nullable=True)
    #: When the schedule ends the season; None without a schedule.
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Who reset the city; None when the schedule did.
    ended_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Both cities' districts as anyone saw them at the end: {"support": {...}, "sales": {...}}.
    snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    totals: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    #: Guards the schedule against two editors saving at once.
    revision: Mapped[int] = mapped_column(default=1)
    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
