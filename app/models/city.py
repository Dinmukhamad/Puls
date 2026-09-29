"""City curriculum and immutable, once-per-operator mission rewards."""

from datetime import date, datetime

from sqlalchemy import JSON, CheckConstraint, Date, DateTime, ForeignKey, String
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


class CityBuild(Base):
    """A building an operator bought for a plot of their own district: paid once, kept."""

    __tablename__ = "city_builds"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    plot_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    item_key: Mapped[str] = mapped_column(String(40))
    price: Mapped[int]
    built_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CityQuest(Base):
    """A daily situation on the map: the question is frozen when the day's quests are dealt."""

    __tablename__ = "city_quests"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    slot: Mapped[int] = mapped_column(primary_key=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    answer: Mapped[int | None] = mapped_column(nullable=True)
    correct: Mapped[bool | None] = mapped_column(nullable=True)
    coins: Mapped[int] = mapped_column(default=0)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CityEconomy(Base):
    """The game's numbers as the head set them: prices, points, quarter costs, the daily reward."""

    __tablename__ = "city_economy"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(default=1)
    values: Mapped[dict] = mapped_column(JSON)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class CitySituations(Base):
    """The daily situations' own set, as trainers edit it (passed tests' questions go first)."""

    __tablename__ = "city_situations"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(default=1)
    items: Mapped[list] = mapped_column(JSON)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
