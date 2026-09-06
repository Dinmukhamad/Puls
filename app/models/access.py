"""Наследуемые правила доступа к разделам, независимые от должностной роли."""

from sqlalchemy import CheckConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccessPolicy(Base):
    __tablename__ = "access_policy"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class AccessRule(Base):
    __tablename__ = "access_rules"
    __table_args__ = (
        UniqueConstraint("target_type", "target_id", "section", name="uq_access_target_section"),
        CheckConstraint("effect IN ('allow', 'deny')", name="valid_effect"),
        CheckConstraint("target_type IN ('all', 'role', 'group', 'user')", name="valid_target"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[str] = mapped_column(String(80))
    section: Mapped[str] = mapped_column(String(64))
    effect: Mapped[str] = mapped_column(String(8))
