from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.db import Base


def now_utc() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), index=True)
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operators.id"), nullable=True)
    can_manage_operators: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Optional["Operator"]] = relationship("Operator", foreign_keys=[operator_id], post_update=True)


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), index=True)
    group_name: Mapped[str] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    position: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    employee_id: Mapped[Optional[str]] = mapped_column(String(120), unique=True, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    participation_started_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    admin_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    current_balance: Mapped[int] = mapped_column(Integer, default=0)
    reserved_balance: Mapped[int] = mapped_column(Integer, default=0)
    total_earned: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id], post_update=True)
    created_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by_user_id])
    weekly_results: Mapped[List["WeeklyResult"]] = relationship(back_populates="operator")
    transactions: Mapped[List["CoinTransaction"]] = relationship(back_populates="operator")
    purchases: Mapped[List["ShopPurchase"]] = relationship(back_populates="operator")
    audit_logs: Mapped[List["OperatorAuditLog"]] = relationship(back_populates="operator")

    @property
    def username(self) -> Optional[str]:
        return self.user.username if self.user else None

    @property
    def created_by_name(self) -> Optional[str]:
        return self.created_by.full_name if self.created_by else None


class WeeklyResult(Base):
    __tablename__ = "weekly_results"
    __table_args__ = (UniqueConstraint("operator_id", "week_start", "week_end", name="uq_weekly_operator_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    week_end: Mapped[date] = mapped_column(Date)
    contest_points: Mapped[float] = mapped_column(Float, default=0)
    coins_earned: Mapped[int] = mapped_column(Integer, default=0)
    rank_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    previous_rank_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours_score: Mapped[float] = mapped_column(Float, default=0)
    overtime_score: Mapped[float] = mapped_column(Float, default=0)
    quality_score: Mapped[float] = mapped_column(Float, default=0)
    efficiency_score: Mapped[float] = mapped_column(Float, default=0)
    calls_per_hour_score: Mapped[float] = mapped_column(Float, default=0)
    lateness_count: Mapped[int] = mapped_column(Integer, default=0)
    violation_count: Mapped[int] = mapped_column(Integer, default=0)
    final_score: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship(back_populates="weekly_results")


class CoinTransaction(Base):
    __tablename__ = "coin_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(40), index=True)
    comment: Mapped[str] = mapped_column(Text)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    related_purchase_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shop_purchases.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship(back_populates="transactions")
    created_by: Mapped[Optional[User]] = relationship("User")


class ShopItem(Base):
    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    purchases: Mapped[List["ShopPurchase"]] = relationship(back_populates="shop_item")


class ShopPurchase(Base):
    __tablename__ = "shop_purchases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    shop_item_id: Mapped[int] = mapped_column(ForeignKey("shop_items.id"))
    price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    reject_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    reviewed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    operator: Mapped[Operator] = relationship(back_populates="purchases")
    shop_item: Mapped[ShopItem] = relationship(back_populates="purchases")
    reviewed_by: Mapped[Optional[User]] = relationship("User")


class OperatorAuditLog(Base):
    __tablename__ = "operator_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship(back_populates="audit_logs")
    actor: Mapped[Optional[User]] = relationship("User")

    @property
    def actor_name(self) -> Optional[str]:
        return self.actor.full_name if self.actor else None
