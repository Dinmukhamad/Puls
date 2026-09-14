from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class WheelConfig(Base):
    __tablename__ = "wheel_config"
    id: Mapped[int] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_spins: Mapped[int] = mapped_column(Integer, default=1)
    segments: Mapped[list] = mapped_column(JSON, default=list)


class WheelSpin(Base, TimestampMixin):
    __tablename__ = "wheel_spins"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    request_key: Mapped[str] = mapped_column(String(180), unique=True)
    segment: Mapped[int] = mapped_column(Integer)
    reward: Mapped[dict] = mapped_column(JSON)
    segments: Mapped[list] = mapped_column(JSON)


class Raffle(Base, TimestampMixin):
    __tablename__ = "raffles"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    prize: Mapped[str] = mapped_column(String(180))
    closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    legacy_reward: Mapped[int] = mapped_column("xp_reward", Integer, default=0)
    coins_reward: Mapped[int] = mapped_column(Integer, default=0)
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    drawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RaffleEntry(Base, TimestampMixin):
    __tablename__ = "raffle_entries"
    __table_args__ = (UniqueConstraint("raffle_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    raffle_id: Mapped[int] = mapped_column(ForeignKey("raffles.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
