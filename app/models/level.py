"""Уровни оператора (п. 6.2 ТЗ: Новичок -> Профи -> Эксперт -> Легенда)."""
from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class LevelDefinition(Base, TimestampMixin):
    """
    Ступень прогресса, привязанная к накопленным коинам.

    Порог считается по ``total_earned`` - сумме всех начислений за всё время.
    Она не уменьшается при тратах, поэтому покупка в магазине не понижает
    уровень: оператор не должен выбирать между наградой и статусом.
    """

    __tablename__ = "level_definitions"
    __table_args__ = (CheckConstraint("min_earned >= 0", name="min_earned_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Минимум накопленных за всё время коинов для этой ступени.
    min_earned: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
