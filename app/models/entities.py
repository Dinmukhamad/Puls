from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint
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
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operators.id"), nullable=True, index=True)
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("groups.id"), nullable=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    can_manage_operators: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Optional["Operator"]] = relationship("Operator", foreign_keys=[operator_id], post_update=True)


class Group(Base):
    """Р“СЂСѓРїРїР° РѕРїРµСЂР°С‚РѕСЂРѕРІ"""
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

    # Р“СЂСѓРїРїР° вЂ” FK Рє С‚Р°Р±Р»РёС†Рµ groups
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("groups.id"), nullable=True, index=True)
    group_name: Mapped[str] = mapped_column(String(120), index=True, default="")  # legacy compat

    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # РЎС‚Р°С‚СѓСЃ СѓС‡Р°СЃС‚РёСЏ: participating | not_participating
    participation_status: Mapped[str] = mapped_column(String(32), default="participating", index=True)
    # РЎС‚Р°С‚СѓСЃ СЂР°Р±РѕС‚С‹: active | dismissed
    employment_status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Legacy compat fields
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Р”РѕР»Р¶РЅРѕСЃС‚СЊ: operator | chat_manager
    position: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Legacy fields kept for DB compat (not used in new forms)
    employee_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # РЎС‚Р°РІРєР°: 0.5 | 0.75 | 1.0 вЂ” РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ СЂР°СЃС‡С‘С‚Р° РЅРѕСЂРјС‹ С‡Р°СЃРѕРІ
    rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Р‘Р°Р»Р°РЅСЃС‹
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


class OperatorLevel(Base):
    """РќР°СЃС‚СЂР°РёРІР°РµРјС‹Р№ РёРіСЂРѕРІРѕР№ СѓСЂРѕРІРµРЅСЊ РѕРїРµСЂР°С‚РѕСЂР°. РќРµ СЃРІСЏР·Р°РЅ СЃ СЂРѕР»СЊСЋ РґРѕСЃС‚СѓРїР°."""
    __tablename__ = "operator_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(32), default="#64748B")
    icon: Mapped[str] = mapped_column(String(64), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    rules: Mapped[List["OperatorLevelRule"]] = relationship(
        back_populates="level", cascade="all, delete-orphan", order_by="OperatorLevelRule.id"
    )


class OperatorLevelRule(Base):
    """РЈСЃР»РѕРІРёРµ СѓСЂРѕРІРЅСЏ: РєР°С‡РµСЃС‚РІРѕ >= 90, С€С‚СЂР°С„С‹ <= 5, СЃС‚Р°Р¶ РјРµР¶РґСѓ 8 Рё 30 Рё С‚.Рї."""
    __tablename__ = "operator_level_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("operator_levels.id"), index=True)
    metric_code: Mapped[str] = mapped_column(String(64), index=True)
    operator: Mapped[str] = mapped_column(String(16))
    value_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    value_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    level: Mapped["OperatorLevel"] = relationship(back_populates="rules")


class OperatorLevelAssignment(Base):
    """РўРµРєСѓС‰РёР№ СѓСЂРѕРІРµРЅСЊ РѕРїРµСЂР°С‚РѕСЂР°: Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёР№ РёР»Рё СЂСѓС‡РЅРѕР№."""
    __tablename__ = "operator_level_assignments"
    __table_args__ = (
        UniqueConstraint("operator_id", name="uq_operator_level_assignments_operator"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("operator_levels.id"), index=True)
    assignment_type: Mapped[str] = mapped_column(String(16), default="auto", index=True)
    calculated_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    calculated_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    manual_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    manual_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    assigned_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    operator: Mapped["Operator"] = relationship("Operator")
    level: Mapped["OperatorLevel"] = relationship("OperatorLevel")
    assigned_by_user: Mapped[Optional["User"]] = relationship("User")


class OperatorLevelHistory(Base):
    """РСЃС‚РѕСЂРёСЏ РёР·РјРµРЅРµРЅРёР№ СѓСЂРѕРІРЅСЏ РґР»СЏ Р°СѓРґРёС‚Р° Рё РѕР±СЉСЏСЃРЅРµРЅРёР№."""
    __tablename__ = "operator_level_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    old_level_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    new_level_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    change_type: Mapped[str] = mapped_column(String(16), index=True)
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    metadata_json: Mapped[Optional[str]] = mapped_column("metadata", Text, nullable=True)

    operator: Mapped["Operator"] = relationship("Operator")
    old_level: Mapped[Optional["OperatorLevel"]] = relationship("OperatorLevel", foreign_keys=[old_level_id])
    new_level: Mapped[Optional["OperatorLevel"]] = relationship("OperatorLevel", foreign_keys=[new_level_id])
    changed_by_user: Mapped[Optional["User"]] = relationship("User")


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
    shop_item_id: Mapped[int] = mapped_column(ForeignKey("shop_items.id"), index=True)
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
    """Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№ вЂ” РµРґРёРЅР°СЏ С‚Р°Р±Р»РёС†Р° audit_logs"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    # РџРѕРґРґРµСЂР¶РёРІР°РµРј РѕР±Р° РєРѕРЅС‚СЂР°РєС‚Р°: РЅРѕРІС‹Р№ (entity_type/entity_id) Рё СЃС‚Р°СЂС‹Р№ (operator_id)
    entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)  # legacy compat
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)         # legacy compat
    performed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True) # legacy compat
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    performed_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[performed_by_user_id])


class PeriodReport(Base):
    """РЎРѕС…СЂР°РЅС‘РЅРЅС‹Р№ СЂР°СЃС‡С‘С‚ РїРѕРєР°Р·Р°С‚РµР»РµР№ РѕРїРµСЂР°С‚РѕСЂР° Р·Р° РІС‹Р±СЂР°РЅРЅС‹Р№ РїРµСЂРёРѕРґ"""
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
    РҐСЂР°РЅРёР»РёС‰Рµ Р·Р°РіСЂСѓР¶РµРЅРЅС‹С… xlsx-С„Р°Р№Р»РѕРІ (Monthly Report / Report) РґР»СЏ СЂР°Р·РґРµР»Р°
    В«Р Р°СЃС‡С‘С‚ РїРµСЂРёРѕРґР°В» Рё В«РђРЅР°Р»РёС‚РёРєР°В». РҐСЂР°РЅРёРј РІ Р‘Р” (РЅРµ in-memory), С‡С‚РѕР±С‹ С„Р°Р№Р»С‹
    РїРµСЂРµР¶РёРІР°Р»Рё СЂРµРґРµРїР»РѕР№ Рё РїРµСЂРµР·Р°РїСѓСЃРє РєРѕРЅС‚РµР№РЅРµСЂР°.
    """
    __tablename__ = "uploaded_report_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_kind: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # "monthly" | "report"
    filename: Mapped[str] = mapped_column(String(255))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class OperatorDailyMetric(Base):
    """
    РџРѕСЃСѓС‚РѕС‡РЅС‹Рµ РїРѕРєР°Р·Р°С‚РµР»Рё РѕРїРµСЂР°С‚РѕСЂР° вЂ” Р·Р°РїРѕР»РЅСЏРµС‚СЃСЏ РћР”РРќ СЂР°Р· РїСЂРё Р·Р°РіСЂСѓР·РєРµ
    Monthly Report / Report (parse_to_daily_metrics), РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ С‚РѕРіРѕ,
    РєР°РєРѕР№ РїРµСЂРёРѕРґ РІС‹Р±РµСЂРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РІ В«РђРЅР°Р»РёС‚РёРєРµВ» РїРѕР·Р¶Рµ.

    РџСЂРѕРёР·РІРѕР»СЊРЅС‹Р№ РґРёР°РїР°Р·РѕРЅ РґР°С‚ СЃС‚СЂРѕРёС‚СЃСЏ С‡РµСЂРµР· SUM() РїРѕ СЌС‚РѕР№ С‚Р°Р±Р»РёС†Рµ вЂ”
    Excel Р±РѕР»СЊС€Рµ РЅРµ РїР°СЂСЃРёС‚СЃСЏ РїРѕРІС‚РѕСЂРЅРѕ РїСЂРё РєР°Р¶РґРѕРј РЅРѕРІРѕРј РІС‹Р±РѕСЂРµ РїРµСЂРёРѕРґР°.
    """
    __tablename__ = "operator_daily_metrics"
    __table_args__ = (
        UniqueConstraint("operator_id", "metric_date", name="uq_daily_metrics_operator_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    operator_name: Mapped[str] = mapped_column(String(255))  # СЃРЅРёРјРѕРє Р¤РРћ РЅР° РјРѕРјРµРЅС‚ РїР°СЂСЃРёРЅРіР° вЂ” РґР»СЏ РґРёР°РіРЅРѕСЃС‚РёРєРё
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("groups.id"), nullable=True)
    metric_date: Mapped[date] = mapped_column(Date, index=True)

    calls_count: Mapped[float] = mapped_column(Float, default=0)

    quality_scores_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON-СЃРїРёСЃРѕРє РѕС†РµРЅРѕРє Р·Р° РґРµРЅСЊ
    quality_sum: Mapped[float] = mapped_column(Float, default=0)
    quality_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_avg: Mapped[float] = mapped_column(Float, default=0)

    kvz: Mapped[float] = mapped_column(Float, default=0)
    efficiency: Mapped[float] = mapped_column(Float, default=0)  # С‡Р°СЃС‹ РІ Р·РІРѕРЅРєРµ Р·Р° РґРµРЅСЊ (Р»РёСЃС‚ "Р­С„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ")

    worked_hours: Mapped[float] = mapped_column(Float, default=0)       # Р»РёСЃС‚ "РћС‚СЂР°Р±РѕС‚Р°РЅРЅС‹Рµ С‡Р°СЃС‹"
    tech_issue_hours: Mapped[float] = mapped_column(Float, default=0)
    training_hours: Mapped[float] = mapped_column(Float, default=0)
    offline_activity_hours: Mapped[float] = mapped_column(Float, default=0)
    base_hours: Mapped[float] = mapped_column(Float, default=0)         # worked - tech - training - offline

    penalty_sum: Mapped[float] = mapped_column(Float, default=0)
    penalty_minutes: Mapped[float] = mapped_column(Float, default=0)
    penalty_points: Mapped[float] = mapped_column(Float, default=0)

    source_monthly_report_id: Mapped[Optional[int]] = mapped_column(ForeignKey("uploaded_report_files.id"), nullable=True)
    source_report_id: Mapped[Optional[int]] = mapped_column(ForeignKey("uploaded_report_files.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# Р РђР—Р”Р•Р› В«РќРћР РњР« Р§РђРЎРћР’В»
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

class WorkNorm(Base):
    """РќРѕСЂРјР° С‡Р°СЃРѕРІ РїРѕ СЃС‚Р°РІРєРµ Р·Р° РєРѕРЅРєСЂРµС‚РЅС‹Р№ РіРѕРґ/РјРµСЃСЏС†."""
    __tablename__ = "work_norms"
    __table_args__ = (
        UniqueConstraint("year", "month", "rate", name="uq_work_norms_year_month_rate"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month_days: Mapped[int] = mapped_column(Integer, nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, index=True)
    monthly_norm_hours: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# Р РђР—Р”Р•Р› В«РўР•РЎРўР«В» вЂ” РІРЅСѓС‚СЂРµРЅРЅРµРµ С‚РµСЃС‚РёСЂРѕРІР°РЅРёРµ РѕРїРµСЂР°С‚РѕСЂРѕРІ РїРѕ РїСЂРёРЅС†РёРїСѓ Р•РќРў
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

class Test(Base):
    """РўРµСЃС‚: РєРѕРЅСЃС‚СЂСѓРєС‚РѕСЂ + РЅР°СЃС‚СЂРѕР№РєРё РІСЂРµРјРµРЅРё/РЅР°РіСЂР°РґС‹/РїСЂРѕС…РѕРґРЅРѕРіРѕ РїСЂРѕС†РµРЅС‚Р°."""
    __tablename__ = "tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    instruction: Mapped[str] = mapped_column(Text, default="")

    # draft | scheduled | open | finished | archived
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)

    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=30)
    opens_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closes_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    passing_percent: Mapped[float] = mapped_column(Float, default=70.0)
    show_result_after_finish: Mapped[bool] = mapped_column(Boolean, default=True)
    show_correct_answers: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_retake: Mapped[bool] = mapped_column(Boolean, default=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1)

    # none | points | coins | points_and_coins
    reward_type: Mapped[str] = mapped_column(String(32), default="none")
    reward_points: Mapped[float] = mapped_column(Float, default=0)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    reward_min_percent: Mapped[float] = mapped_column(Float, default=70.0)
    # fixed | proportional вЂ” СЂРµР¶РёРј РЅР°С‡РёСЃР»РµРЅРёСЏ РЅР°РіСЂР°РґС‹ (СЃРј. РўР— Рї.10.3)
    reward_mode: Mapped[str] = mapped_column(String(32), default="fixed")

    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    questions: Mapped[List["TestQuestion"]] = relationship(back_populates="test", cascade="all, delete-orphan", order_by="TestQuestion.sort_order")
    assignments: Mapped[List["TestAssignment"]] = relationship(back_populates="test", cascade="all, delete-orphan")
    attempts: Mapped[List["TestAttempt"]] = relationship(back_populates="test", cascade="all, delete-orphan")
    created_by: Mapped[Optional["User"]] = relationship("User")


class TestQuestion(Base):
    """Р’РѕРїСЂРѕСЃ С‚РµСЃС‚Р°: С‚РµРєСЃС‚, С‚РёРї (РѕРґРёРЅ/РЅРµСЃРєРѕР»СЊРєРѕ РѕС‚РІРµС‚РѕРІ), РІРµСЃ РІ Р±Р°Р»Р»Р°С…."""
    __tablename__ = "test_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"), index=True)
    question_text: Mapped[str] = mapped_column(Text)
    # single_choice | multiple_choice
    question_type: Mapped[str] = mapped_column(String(32), default="single_choice")
    points: Mapped[float] = mapped_column(Float, default=1.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    test: Mapped["Test"] = relationship(back_populates="questions")
    answers: Mapped[List["TestAnswerOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="TestAnswerOption.sort_order")


class TestAnswerOption(Base):
    """Р’Р°СЂРёР°РЅС‚ РѕС‚РІРµС‚Р° РЅР° РІРѕРїСЂРѕСЃ. is_correct РќРРљРћР“Р”Рђ РЅРµ РѕС‚РґР°С‘С‚СЃСЏ РѕРїРµСЂР°С‚РѕСЂСѓ РґРѕ Р·Р°РІРµСЂС€РµРЅРёСЏ С‚РµСЃС‚Р°."""
    __tablename__ = "test_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("test_questions.id"), index=True)
    answer_text: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    question: Mapped["TestQuestion"] = relationship(back_populates="answers")


class TestAssignment(Base):
    """
    РќР°Р·РЅР°С‡РµРЅРёРµ С‚РµСЃС‚Р°: РєРѕРјСѓ РѕРЅ РІРёРґРµРЅ/РґРѕСЃС‚СѓРїРµРЅ.
    target_type=all  -> target_id РёРіРЅРѕСЂРёСЂСѓРµС‚СЃСЏ (РІРёРґРµРЅ РІСЃРµРј РѕРїРµСЂР°С‚РѕСЂР°Рј)
    target_type=group -> target_id = groups.id
    target_type=operator -> target_id = operators.id
    """
    __tablename__ = "test_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(16))  # all | group | operator
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    test: Mapped["Test"] = relationship(back_populates="assignments")


class TestAttempt(Base):
    """
    РџРѕРїС‹С‚РєР° РїСЂРѕС…РѕР¶РґРµРЅРёСЏ С‚РµСЃС‚Р° РѕРґРЅРёРј РѕРїРµСЂР°С‚РѕСЂРѕРј. started_at/expires_at
    С„РёРєСЃРёСЂСѓСЋС‚СЃСЏ РЅР° СЃРµСЂРІРµСЂРµ РїСЂРё СЃС‚Р°СЂС‚Рµ вЂ” СЌС‚Рѕ Рё РµСЃС‚СЊ Р·Р°С‰РёС‚Р° РѕС‚ "РїРµСЂРµР·Р°РїСѓСЃРєР°
    С‚Р°Р№РјРµСЂР° С‡РµСЂРµР· F5" (СЃРј. РўР— Рї.7.3): С„СЂРѕРЅС‚РµРЅРґ РІСЃРµРіРґР° РІС‹С‡РёСЃР»СЏРµС‚ РѕСЃС‚Р°С‚РѕРє
    РІСЂРµРјРµРЅРё РєР°Рє expires_at - now(), Р° РЅРµ С…СЂР°РЅРёС‚ С‚Р°Р№РјРµСЂ Р»РѕРєР°Р»СЊРЅРѕ.
    """
    __tablename__ = "test_attempts"
    __table_args__ = (
        UniqueConstraint("test_id", "operator_id", "attempt_number", name="uq_test_attempt_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)

    # not_started | in_progress | finished | expired | cancelled
    status: Mapped[str] = mapped_column(String(32), default="in_progress", index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    score_points: Mapped[float] = mapped_column(Float, default=0)
    max_points: Mapped[float] = mapped_column(Float, default=0)
    score_percent: Mapped[float] = mapped_column(Float, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    questions_count: Mapped[int] = mapped_column(Integer, default=0)

    reward_points: Mapped[float] = mapped_column(Float, default=0)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    reward_transaction_id: Mapped[Optional[int]] = mapped_column(ForeignKey("coin_transactions.id"), nullable=True)

    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    test: Mapped["Test"] = relationship(back_populates="attempts")
    operator: Mapped["Operator"] = relationship("Operator")
    answers: Mapped[List["TestAttemptAnswer"]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class TestAttemptAnswer(Base):
    """
    Р§РµСЂРЅРѕРІРёРє/С„РёРЅР°Р»СЊРЅС‹Р№ РѕС‚РІРµС‚ РѕРїРµСЂР°С‚РѕСЂР° РЅР° РєРѕРЅРєСЂРµС‚РЅС‹Р№ РІРѕРїСЂРѕСЃ РІРЅСѓС‚СЂРё РїРѕРїС‹С‚РєРё.
    selected_answer_ids С…СЂР°РЅРёС‚СЃСЏ РєР°Рє JSON-СЃРїРёСЃРѕРє ID РІР°СЂРёР°РЅС‚РѕРІ вЂ” РїРѕР·РІРѕР»СЏРµС‚
    РєР°Рє single_choice (1 СЌР»РµРјРµРЅС‚), С‚Р°Рє Рё multiple_choice (РЅРµСЃРєРѕР»СЊРєРѕ).
    РЎРѕС…СЂР°РЅСЏРµС‚СЃСЏ РїРѕ РєР°Р¶РґРѕРјСѓ "Р”Р°Р»РµРµ" вЂ” СЌС‚Рѕ Рё РµСЃС‚СЊ draft_answers РёР· РўР— Рї.7.3.
    """
    __tablename__ = "test_attempt_answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_attempt_question"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("test_attempts.id"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("test_questions.id"), index=True)
    selected_answer_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # None РґРѕ РїСЂРѕРІРµСЂРєРё
    points_awarded: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    attempt: Mapped["TestAttempt"] = relationship(back_populates="answers")
    question: Mapped["TestQuestion"] = relationship("TestQuestion")
