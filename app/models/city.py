"""City curriculum and immutable, once-per-operator mission rewards."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CitySettings(Base):
    __tablename__ = "city_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(default=1)
    missions: Mapped[dict] = mapped_column(JSON)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class CityAward(Base):
    __tablename__ = "city_awards"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    mission_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    xp: Mapped[int]
    coins: Mapped[int]
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
