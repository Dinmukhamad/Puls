from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.datetime_utils import (
    now_utc,  # noqa: F401 — реэкспорт: from app.models.entities import now_utc
)
from app.database.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), index=True)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("operators.id"), nullable=True, index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    can_manage_operators: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator | None] = relationship("Operator", foreign_keys=[operator_id], post_update=True)


class Group(Base):
    """Группа операторов"""
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | inactive
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    operators: Mapped[list[Operator]] = relationship(back_populates="group")


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), index=True)

    # Группа — FK к таблице groups
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True, index=True)
    group_name: Mapped[str] = mapped_column(String(120), index=True, default="")  # legacy compat

    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Статус участия: participating | not_participating
    participation_status: Mapped[str] = mapped_column(String(32), default="participating", index=True)
    # Статус работы: active | dismissed
    employment_status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Legacy compat fields
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Должность: operator | chat_manager
    position: Mapped[str | None] = mapped_column(String(200), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Legacy fields kept for DB compat (not used in new forms)
    employee_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Ставка: 0.5 | 0.75 | 1.0 — используется для расчёта нормы часов
    rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Балансы
    current_balance: Mapped[int] = mapped_column(Integer, default=0)
    reserved_balance: Mapped[int] = mapped_column(Integer, default=0)
    total_earned: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    user: Mapped[User | None] = relationship("User", foreign_keys=[user_id], post_update=True)
    created_by: Mapped[User | None] = relationship("User", foreign_keys=[created_by_user_id])
    group: Mapped[Group | None] = relationship("Group", back_populates="operators")
    weekly_results: Mapped[list[WeeklyResult]] = relationship(back_populates="operator")
    transactions: Mapped[list[CoinTransaction]] = relationship(back_populates="operator")
    purchases: Mapped[list[ShopPurchase]] = relationship(back_populates="operator")


class OperatorLevel(Base):
    """Настраиваемый игровой уровень оператора. Не связан с ролью доступа."""
    __tablename__ = "operator_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(32), default="#64748B")
    icon: Mapped[str] = mapped_column(String(64), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    min_total_xp: Mapped[int] = mapped_column(Integer, default=0)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    reward_once: Mapped[bool] = mapped_column(Boolean, default=True)
    coin_multiplier_percent: Mapped[float] = mapped_column(Float, default=0)
    shop_discount_percent: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    rules: Mapped[list[OperatorLevelRule]] = relationship(
        back_populates="level", cascade="all, delete-orphan", order_by="OperatorLevelRule.id"
    )


class OperatorLevelRule(Base):
    """Условие уровня: качество >= 90, штрафы <= 5, стаж между 8 и 30 и т.п."""
    __tablename__ = "operator_level_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("operator_levels.id"), index=True)
    metric_code: Mapped[str] = mapped_column(String(64), index=True)
    operator: Mapped[str] = mapped_column(String(16))
    value_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    level: Mapped[OperatorLevel] = relationship(back_populates="rules")


class OperatorLevelAssignment(Base):
    """Текущий уровень оператора: автоматический или ручной."""
    __tablename__ = "operator_level_assignments"
    __table_args__ = (
        UniqueConstraint("operator_id", name="uq_operator_level_assignments_operator"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("operator_levels.id"), index=True)
    assignment_type: Mapped[str] = mapped_column(String(16), default="auto", index=True)
    calculated_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    calculated_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    manual_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    manual_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    operator: Mapped[Operator] = relationship("Operator")
    level: Mapped[OperatorLevel] = relationship("OperatorLevel")
    assigned_by_user: Mapped[User | None] = relationship("User")


class OperatorLevelHistory(Base):
    """История изменений уровня для аудита и объяснений."""
    __tablename__ = "operator_level_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    old_level_id: Mapped[int | None] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    new_level_id: Mapped[int | None] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    change_type: Mapped[str] = mapped_column(String(16), index=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    metadata_json: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)

    operator: Mapped[Operator] = relationship("Operator")
    old_level: Mapped[OperatorLevel | None] = relationship("OperatorLevel", foreign_keys=[old_level_id])
    new_level: Mapped[OperatorLevel | None] = relationship("OperatorLevel", foreign_keys=[new_level_id])
    changed_by_user: Mapped[User | None] = relationship("User")


class WeeklyResult(Base):
    __tablename__ = "weekly_results"
    __table_args__ = (UniqueConstraint("operator_id", "week_start", "week_end", name="uq_weekly_operator_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    week_end: Mapped[date] = mapped_column(Date)
    contest_points: Mapped[float] = mapped_column(Float, default=0)
    coins_earned: Mapped[int] = mapped_column(Integer, default=0)
    rank_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    previous_rank_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    related_purchase_id: Mapped[int | None] = mapped_column(ForeignKey("shop_purchases.id"), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship(back_populates="transactions")
    created_by: Mapped[User | None] = relationship("User")


class ShopItem(Base):
    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(Integer)
    min_level_id: Mapped[int | None] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    purchases: Mapped[list[ShopPurchase]] = relationship(back_populates="shop_item")
    min_level: Mapped[OperatorLevel | None] = relationship("OperatorLevel")


class OperatorLevelReward(Base):
    """Разовая награда коинов за достижение уровня."""
    __tablename__ = "operator_level_rewards"
    __table_args__ = (
        UniqueConstraint("operator_id", "level_id", name="uq_operator_level_reward"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("operator_levels.id"), index=True)
    coin_transaction_id: Mapped[int | None] = mapped_column(ForeignKey("coin_transactions.id"), nullable=True)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    source_type: Mapped[str] = mapped_column(String(50), default="level_up")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship("Operator")
    level: Mapped[OperatorLevel] = relationship("OperatorLevel")
    coin_transaction: Mapped[CoinTransaction | None] = relationship("CoinTransaction")


class ShopPurchase(Base):
    __tablename__ = "shop_purchases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    shop_item_id: Mapped[int] = mapped_column(ForeignKey("shop_items.id"), index=True)
    price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    operator: Mapped[Operator] = relationship(back_populates="purchases")
    shop_item: Mapped[ShopItem] = relationship(back_populates="purchases")
    reviewed_by: Mapped[User | None] = relationship("User")


class AuditLog(Base):
    """Журнал действий — единая таблица audit_logs"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    # Поддерживаем оба контракта: новый (entity_type/entity_id) и старый (operator_id)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)  # legacy compat
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)         # legacy compat
    performed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True) # legacy compat
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    performed_by: Mapped[User | None] = relationship("User", foreign_keys=[performed_by_user_id])


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
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    operator: Mapped[Operator] = relationship("Operator")


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
    uploaded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class OperatorDailyMetric(Base):
    """
    Посуточные показатели оператора — заполняется ОДИН раз при загрузке
    Monthly Report / Report (parse_to_daily_metrics), независимо от того,
    какой период выберет пользователь в «Аналитике» позже.

    Произвольный диапазон дат строится через SUM() по этой таблице —
    Excel больше не парсится повторно при каждом новом выборе периода.
    """
    __tablename__ = "operator_daily_metrics"
    __table_args__ = (
        UniqueConstraint("operator_id", "metric_date", name="uq_daily_metrics_operator_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    operator_name: Mapped[str] = mapped_column(String(255))  # снимок ФИО на момент парсинга — для диагностики
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)
    metric_date: Mapped[date] = mapped_column(Date, index=True)

    calls_count: Mapped[float] = mapped_column(Float, default=0)

    quality_scores_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON-список оценок за день
    quality_sum: Mapped[float] = mapped_column(Float, default=0)
    quality_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_avg: Mapped[float] = mapped_column(Float, default=0)

    kvz: Mapped[float] = mapped_column(Float, default=0)
    efficiency: Mapped[float] = mapped_column(Float, default=0)  # часы в звонке за день (лист "Эффективность")

    worked_hours: Mapped[float] = mapped_column(Float, default=0)       # лист "Отработанные часы"
    tech_issue_hours: Mapped[float] = mapped_column(Float, default=0)
    training_hours: Mapped[float] = mapped_column(Float, default=0)
    offline_activity_hours: Mapped[float] = mapped_column(Float, default=0)
    base_hours: Mapped[float] = mapped_column(Float, default=0)         # worked - tech - training - offline

    penalty_sum: Mapped[float] = mapped_column(Float, default=0)
    penalty_minutes: Mapped[float] = mapped_column(Float, default=0)
    penalty_points: Mapped[float] = mapped_column(Float, default=0)

    source_monthly_report_id: Mapped[int | None] = mapped_column(ForeignKey("uploaded_report_files.id"), nullable=True)
    source_report_id: Mapped[int | None] = mapped_column(ForeignKey("uploaded_report_files.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


# ═══════════════════════════════════════════════════════════════════
# РАЗДЕЛ «НОРМЫ ЧАСОВ»
# ═══════════════════════════════════════════════════════════════════

class WorkNorm(Base):
    """Норма часов по ставке за конкретный год/месяц."""
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
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


# ═══════════════════════════════════════════════════════════════════
# РАЗДЕЛ «ТЕСТЫ» — внутреннее тестирование операторов по принципу ЕНТ
# ═══════════════════════════════════════════════════════════════════

class Test(Base):
    """Тест: конструктор + настройки времени/награды/проходного процента."""
    __tablename__ = "tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    instruction: Mapped[str] = mapped_column(Text, default="")

    # draft | scheduled | open | finished | archived
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)

    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=30)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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
    # fixed | proportional — режим начисления награды (см. ТЗ п.10.3)
    reward_mode: Mapped[str] = mapped_column(String(32), default="fixed")

    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    questions: Mapped[list[TestQuestion]] = relationship(back_populates="test", cascade="all, delete-orphan", order_by="TestQuestion.sort_order")
    assignments: Mapped[list[TestAssignment]] = relationship(back_populates="test", cascade="all, delete-orphan")
    attempts: Mapped[list[TestAttempt]] = relationship(back_populates="test", cascade="all, delete-orphan")
    created_by: Mapped[User | None] = relationship("User")


class TestQuestion(Base):
    """Вопрос теста: текст, тип (один/несколько ответов), вес в баллах."""
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

    test: Mapped[Test] = relationship(back_populates="questions")
    answers: Mapped[list[TestAnswerOption]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="TestAnswerOption.sort_order")


class TestAnswerOption(Base):
    """Вариант ответа на вопрос. is_correct НИКОГДА не отдаётся оператору до завершения теста."""
    __tablename__ = "test_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("test_questions.id"), index=True)
    answer_text: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    question: Mapped[TestQuestion] = relationship(back_populates="answers")


class TestAssignment(Base):
    """
    Назначение теста: кому он виден/доступен.
    target_type=all  -> target_id игнорируется (виден всем операторам)
    target_type=group -> target_id = groups.id
    target_type=operator -> target_id = operators.id
    """
    __tablename__ = "test_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(16))  # all | group | operator
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    test: Mapped[Test] = relationship(back_populates="assignments")


class TestAttempt(Base):
    """
    Попытка прохождения теста одним оператором. started_at/expires_at
    фиксируются на сервере при старте — это и есть защита от "перезапуска
    таймера через F5" (см. ТЗ п.7.3): фронтенд всегда вычисляет остаток
    времени как expires_at - now(), а не хранит таймер локально.
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
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    score_points: Mapped[float] = mapped_column(Float, default=0)
    max_points: Mapped[float] = mapped_column(Float, default=0)
    score_percent: Mapped[float] = mapped_column(Float, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    questions_count: Mapped[int] = mapped_column(Integer, default=0)

    reward_points: Mapped[float] = mapped_column(Float, default=0)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    reward_transaction_id: Mapped[int | None] = mapped_column(ForeignKey("coin_transactions.id"), nullable=True)

    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    test: Mapped[Test] = relationship(back_populates="attempts")
    operator: Mapped[Operator] = relationship("Operator")
    answers: Mapped[list[TestAttemptAnswer]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class TestAttemptAnswer(Base):
    """
    Черновик/финальный ответ оператора на конкретный вопрос внутри попытки.
    selected_answer_ids хранится как JSON-список ID вариантов — позволяет
    как single_choice (1 элемент), так и multiple_choice (несколько).
    Сохраняется по каждому "Далее" — это и есть draft_answers из ТЗ п.7.3.
    """
    __tablename__ = "test_attempt_answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_attempt_question"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("test_attempts.id"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("test_questions.id"), index=True)
    selected_answer_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # None до проверки
    points_awarded: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    attempt: Mapped[TestAttempt] = relationship(back_populates="answers")
    question: Mapped[TestQuestion] = relationship("TestQuestion")
