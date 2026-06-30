from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
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
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    can_manage_operators: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Optional["Operator"]] = relationship("Operator", foreign_keys=[operator_id], post_update=True)


class Group(Base):
    """Группа операторов"""
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | inactive
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    operators: Mapped[List["Operator"]] = relationship(back_populates="group")


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), index=True)

    # Группа — FK к таблице groups
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("groups.id"), nullable=True, index=True)
    group_name: Mapped[str] = mapped_column(String(120), index=True, default="")  # legacy compat

    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Статус участия: participating | not_participating
    participation_status: Mapped[str] = mapped_column(String(32), default="participating", index=True)
    # Статус работы: active | dismissed
    employment_status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Legacy compat fields
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Должность: operator | chat_manager
    position: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Legacy fields kept for DB compat (not used in new forms)
    employee_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Балансы
    current_balance: Mapped[int] = mapped_column(Integer, default=0)
    reserved_balance: Mapped[int] = mapped_column(Integer, default=0)
    total_earned: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id], post_update=True)
    created_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by_user_id])
    group: Mapped[Optional["Group"]] = relationship("Group", back_populates="operators")
    weekly_results: Mapped[List["WeeklyResult"]] = relationship(back_populates="operator")
    transactions: Mapped[List["CoinTransaction"]] = relationship(back_populates="operator")
    purchases: Mapped[List["ShopPurchase"]] = relationship(back_populates="operator")


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


class AuditLog(Base):
    """Журнал действий — единая таблица audit_logs"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    # Поддерживаем оба контракта: новый (entity_type/entity_id) и старый (operator_id)
    entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # legacy compat
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)         # legacy compat
    performed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True) # legacy compat
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    performed_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[performed_by_user_id])


class PeriodReport(Base):
    """Сохранённый расчёт показателей оператора за выбранный период"""
    __tablename__ = "period_reports"
    __table_args__ = (
        UniqueConstraint("operator_id", "period_start", "period_end", name="uq_period_reports_operator_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date, index=True)

    quality_avg: Mapped[float] = mapped_column(Float, default=0)
    quality_calls_count: Mapped[int] = mapped_column(Integer, default=0)

    total_hours: Mapped[float] = mapped_column(Float, default=0)
    base_hours: Mapped[float] = mapped_column(Float, default=0)
    tech_issue_hours: Mapped[float] = mapped_column(Float, default=0)
    training_hours: Mapped[float] = mapped_column(Float, default=0)
    offline_activity_hours: Mapped[float] = mapped_column(Float, default=0)

    calls_total: Mapped[float] = mapped_column(Float, default=0)
    kvz: Mapped[float] = mapped_column(Float, default=0)
    call_time_hours: Mapped[float] = mapped_column(Float, default=0)
    efficiency_percent: Mapped[float] = mapped_column(Float, default=0)

    penalty_sum: Mapped[float] = mapped_column(Float, default=0)
    penalty_minutes: Mapped[float] = mapped_column(Float, default=0)
    penalty_points: Mapped[float] = mapped_column(Float, default=0)

    final_points: Mapped[float] = mapped_column(Float, default=0)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    operator: Mapped["Operator"] = relationship("Operator")


class UploadedReportFile(Base):
    """
    Хранилище загруженных xlsx-файлов (Monthly Report / Report) для раздела
    «Расчёт периода» и «Аналитика». Храним в БД (не in-memory), чтобы файлы
    переживали редеплой и перезапуск контейнера.
    """
    __tablename__ = "uploaded_report_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_kind: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # "monthly" | "report"
    filename: Mapped[str] = mapped_column(String(255))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
