from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
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
    sessions: Mapped[list[UserSession]] = relationship(
        "UserSession",
        back_populates="user",
        foreign_keys="UserSession.user_id",
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_label: Mapped[str] = mapped_column(String(255), default="")
    browser_label: Mapped[str] = mapped_column(String(120), default="")
    os_label: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="sessions")
    revoked_by: Mapped[User | None] = relationship("User", foreign_keys=[revoked_by_user_id])


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
    # Пул билетов розыгрыша (ТЗ P2): начисляется призом raffle_ticket из Колеса WOW,
    # тратится при входе в розыгрыш. За коины не покупается.
    raffle_tickets: Mapped[int] = mapped_column(Integer, default=0)
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
    __table_args__ = (
        UniqueConstraint("operator_id", "week_start", "week_end", name="uq_weekly_operator_period"),
        # Отдельный индекс на период (ТЗ §11): запросы вида «все WeeklyResult за
        # неделю X» (accrual_service, dashboard/admin-summary, exports, cabinet)
        # идут без operator_id, а уникальный constraint выше по leftmost-prefix
        # для такого запроса бесполезен.
        Index("ix_weekly_results_period", "week_start", "week_end"),
    )

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
    thanks_count: Mapped[int] = mapped_column(Integer, default=0)
    final_score: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    operator: Mapped[Operator] = relationship(back_populates="weekly_results")


class WeeklyAccrualRun(Base):
    """История запусков автоматического еженедельного расчёта (ТЗ 3.6-3.7)."""
    __tablename__ = "weekly_accrual_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date, index=True)
    mode: Mapped[str] = mapped_column(String(16))  # auto | manual
    status: Mapped[str] = mapped_column(String(16))  # success | failed
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(32), default="system")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    operators_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_existing_count: Mapped[int] = mapped_column(Integer, default=0)
    total_base_coins: Mapped[int] = mapped_column(Integer, default=0)
    total_bonus_coins: Mapped[int] = mapped_column(Integer, default=0)
    total_coins: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    created_by_user: Mapped[User | None] = relationship("User")
    details: Mapped[list[WeeklyAccrualDetail]] = relationship(back_populates="run")


class WeeklyAccrualDetail(Base):
    """Построчная детализация начисления по оператору (ТЗ 3.7). Уникальность
    по (operator_id, period_start, period_end) — защита от повторного начисления
    (ТЗ 3.4), независимо от того, каким run'ом и сколько раз запускали apply."""
    __tablename__ = "weekly_accrual_details"
    __table_args__ = (
        UniqueConstraint("operator_id", "period_start", "period_end", name="uq_weekly_accrual_detail_period"),
        Index("ix_weekly_accrual_details_period_only", "period_start", "period_end"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("weekly_accrual_runs.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    contest_points: Mapped[float] = mapped_column(Float, default=0)
    base_coins: Mapped[int] = mapped_column(Integer, default=0)
    bonus_top_coins: Mapped[int] = mapped_column(Integer, default=0)
    bonus_no_late_coins: Mapped[int] = mapped_column(Integer, default=0)
    bonus_no_violation_coins: Mapped[int] = mapped_column(Integer, default=0)
    bonus_nomination_coins: Mapped[int] = mapped_column(Integer, default=0)
    bonus_thanks_coins: Mapped[int] = mapped_column(Integer, default=0)
    total_coins: Mapped[int] = mapped_column(Integer, default=0)
    rank_place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    previous_rank_place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rank_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    run: Mapped[WeeklyAccrualRun] = relationship(back_populates="details")
    operator: Mapped[Operator] = relationship("Operator")


class Achievement(Base):
    """Бейджи и достижения (ТЗ §7). condition_type определяет, какой чекер
    проверяет условие — см. app/modules/achievements/service.py."""
    __tablename__ = "achievements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="🏆")
    # top_3_week | no_late_streak | quality_threshold | calls_leader_week |
    # efficiency_leader_week | total_coins | test_score | manual
    condition_type: Mapped[str] = mapped_column(String(32))
    condition_value: Mapped[float] = mapped_column(Float, default=0)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    is_repeatable: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


class OperatorAchievement(Base):
    """Состояние достижения у оператора — одна строка на пару (ТЗ §7.2/7.6:
    повторное получение не создаёт дублей, только увеличивает times_awarded)."""
    __tablename__ = "operator_achievements"
    __table_args__ = (
        UniqueConstraint("operator_id", "achievement_id", name="uq_operator_achievement"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    achievement_id: Mapped[int] = mapped_column(ForeignKey("achievements.id"), index=True)
    progress_value: Mapped[float] = mapped_column(Float, default=0)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    times_awarded: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_awarded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    operator: Mapped[Operator] = relationship("Operator")
    achievement: Mapped[Achievement] = relationship("Achievement")


class CoinTransaction(Base):
    __tablename__ = "coin_transactions"
    __table_args__ = (
        Index(
            "uq_coin_transactions_mission_reward",
            "source_type",
            "source_id",
            unique=True,
            postgresql_where=text("source_type = 'mission_reward'"),
            sqlite_where=text("source_type = 'mission_reward'"),
        ),
        # ТЗ «Экономика коинов» §12.1: UNIQUE idempotency_key. NULL допускается
        # (legacy-транзакции и ручные операции без ключа) — и в PostgreSQL, и в
        # SQLite несколько NULL в уникальном индексе не конфликтуют.
        Index(
            "uq_coin_transactions_idempotency_key",
            "idempotency_key",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(40), index=True)
    comment: Mapped[str] = mapped_column(Text)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    related_purchase_id: Mapped[int | None] = mapped_column(ForeignKey("shop_purchases.id"), nullable=True)
    related_spin_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_spins.id"), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ТЗ «Экономика коинов» §14: стабильный ключ идемпотентности, например
    # "mission:12:operator:7:first_complete". Повторное событие с тем же ключом
    # возвращает уже созданную транзакцию и не меняет баланс.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)

    operator: Mapped[Operator] = relationship(back_populates="transactions")
    created_by: Mapped[User | None] = relationship("User")


class CoinRule(Base):
    """Настраиваемые правила начисления коинов (ТЗ §4). Активна всегда одна запись."""
    __tablename__ = "coin_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    points_per_coin: Mapped[int] = mapped_column(Integer, default=5)
    rounding_mode: Mapped[str] = mapped_column(String(16), default="floor")  # floor | ceil | round
    min_points_for_accrual: Mapped[float] = mapped_column(Float, default=0)
    top_1_bonus: Mapped[int] = mapped_column(Integer, default=15)
    top_2_bonus: Mapped[int] = mapped_column(Integer, default=10)
    top_3_bonus: Mapped[int] = mapped_column(Integer, default=7)
    no_late_bonus: Mapped[int] = mapped_column(Integer, default=5)
    no_violation_bonus: Mapped[int] = mapped_column(Integer, default=3)
    nomination_bonus: Mapped[int] = mapped_column(Integer, default=5)
    driver_thanks_bonus: Mapped[int] = mapped_column(Integer, default=3)
    # Тумблеры конкретных номинаций (ТЗ 4.3). «Без опозданий» здесь не дублируется —
    # она уже покрыта no_late_bonus как отдельная flat-бонус-категория.
    nomination_calls_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    nomination_quality_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    nomination_efficiency_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    nomination_progress_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    nomination_thanks_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    accrue_to_fired: Mapped[bool] = mapped_column(Boolean, default=False)
    accrue_to_inactive: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    updated_by: Mapped[User | None] = relationship("User")


class Notification(Base):
    """Уведомления пользователю (ТЗ P2). Привязаны к User (не Operator) —
    так одна и та же инфраструктура обслуживает и операторов, и штат
    (например, в будущем — «новая заявка на рассмотрение» для supervisor)."""
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship("User")


class ShopItem(Base):
    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="other", index=True)
    price: Mapped[int] = mapped_column(Integer)
    min_level_id: Mapped[int | None] = mapped_column(ForeignKey("operator_levels.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Сезонный магазин (ТЗ P2): окно доступности + лимиты. 0 в лимитах = без лимита,
    # как и у секторов Wheel of WOW — единообразный принцип по всему проекту.
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    stock_limit: Mapped[int] = mapped_column(Integer, default=0)
    purchase_limit_per_operator: Mapped[int] = mapped_column(Integer, default=0)
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
    original_price: Mapped[int] = mapped_column(Integer, default=0)
    discount_percent: Mapped[int] = mapped_column(Integer, default=0)
    discount_amount: Mapped[int] = mapped_column(Integer, default=0)
    discount_coupon_id: Mapped[int | None] = mapped_column(
        ForeignKey("shop_discount_coupons.id"), nullable=True, index=True
    )
    # ТЗ «Экономика коинов» §12: снапшот сезона на момент покупки. Цена в поле
    # price уже является снапшотом; season_id фиксирует, по какой сезонной
    # модели она была рассчитана. NULL = покупка вне сезонной модели (legacy).
    season_id: Mapped[int | None] = mapped_column(
        ForeignKey("economy_seasons.id"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Жизненный цикл заказа (ТЗ «Экономика коинов» §12.1 prize_orders):
    # new(=created+reserved) → approved(=ready) → completed(=issued);
    # rejected(=cancelled) / refunded / expired.
    # issued_by — кто фактически выдал приз (может отличаться от ревьюера);
    # completed_at играет роль issued_at.
    issued_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Дедлайн получения приза после готовности (approved); просроченные
    # заказы закрывает expire_stale_purchases со статусом expired и возвратом.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # Idempotency-Key запроса POST /shop/purchases (ТЗ §14): повторная отправка
    # формы не создаёт второй заказ и второй резерв.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)

    __table_args__ = (
        Index("uq_shop_purchases_idempotency_key", "idempotency_key", unique=True),
    )

    operator: Mapped[Operator] = relationship(back_populates="purchases")
    shop_item: Mapped[ShopItem] = relationship(back_populates="purchases")
    reviewed_by: Mapped[User | None] = relationship("User", foreign_keys=[reviewed_by_user_id])
    issued_by: Mapped[User | None] = relationship("User", foreign_keys=[issued_by_user_id])


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


# ══════════════════════════════════════════════════════════════════════════════
# РАЗДЕЛ «МИССИИ» — интерактивное обучение операторов
# ══════════════════════════════════════════════════════════════════════════════


class LearningWorld(Base):
    __tablename__ = "learning_worlds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(80), default="map")
    illustration_key: Mapped[str] = mapped_column(String(80), default="city")
    accent_color: Mapped[str] = mapped_column(String(16), default="#4F46E5")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    availability: Mapped[str] = mapped_column(String(32), default="available", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    missions: Mapped[list[Mission]] = relationship(back_populates="world")


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    mission_type: Mapped[str] = mapped_column(String(32), default="tutorial", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    reward_coins: Mapped[int] = mapped_column(Integer, default=0)
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    prerequisites_json: Mapped[dict] = mapped_column(JSON, default=dict)
    world_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_worlds.id"), nullable=True, index=True
    )
    world_sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    steps: Mapped[list[MissionStep]] = relationship(
        back_populates="mission",
        cascade="all, delete-orphan",
        order_by="MissionStep.step_order",
    )
    world: Mapped[LearningWorld | None] = relationship(back_populates="missions")
    settings: Mapped[list[MissionSetting]] = relationship(
        back_populates="mission", cascade="all, delete-orphan"
    )


class MissionSetting(Base):
    __tablename__ = "mission_settings"
    __table_args__ = (
        UniqueConstraint("mission_id", "key", "version", name="uq_mission_setting_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[int] = mapped_column(
        ForeignKey("missions.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(80), index=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    effective_from: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    mission: Mapped[Mission] = relationship(back_populates="settings")
    updater: Mapped[User | None] = relationship("User")


class MissionStep(Base):
    __tablename__ = "mission_steps"
    __table_args__ = (
        UniqueConstraint(
            "mission_id", "mission_version", "step_key", name="uq_mission_steps_key"
        ),
        UniqueConstraint(
            "mission_id", "mission_version", "step_order", name="uq_mission_steps_order"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    mission_version: Mapped[int] = mapped_column(Integer, default=1, index=True)
    step_key: Mapped[str] = mapped_column(String(80))
    step_order: Mapped[int] = mapped_column(Integer)
    step_type: Mapped[str] = mapped_column(String(40))
    screen_key: Mapped[str] = mapped_column(String(80))
    action_key: Mapped[str] = mapped_column(String(80))
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    hint_text: Mapped[str] = mapped_column(Text, default="")
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)

    mission: Mapped[Mission] = relationship(back_populates="steps")


class OperatorMissionProgress(Base):
    __tablename__ = "operator_mission_progress"
    __table_args__ = (
        UniqueConstraint("operator_id", "mission_id", name="uq_operator_mission_progress"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="available", index=True)
    current_step_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    best_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    attempts_count: Mapped[int] = mapped_column(Integer, default=0)
    reward_claimed: Mapped[bool] = mapped_column(Boolean, default=False)
    reward_claimed_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reward_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("coin_transactions.id"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    mission: Mapped[Mission] = relationship("Mission")
    operator: Mapped[Operator] = relationship("Operator")
    reward_transaction: Mapped[CoinTransaction | None] = relationship("CoinTransaction")


class MissionAttempt(Base):
    __tablename__ = "mission_attempts"
    __table_args__ = (
        UniqueConstraint(
            "operator_id", "mission_id", "attempt_number", name="uq_mission_attempt_number"
        ),
        UniqueConstraint("idempotency_key", name="uq_mission_attempt_idempotency_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), index=True)
    mission_version: Mapped[int] = mapped_column(Integer)
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(120))
    mode: Mapped[str] = mapped_column(String(32), default="tutorial")
    status: Mapped[str] = mapped_column(String(32), default="in_progress", index=True)
    current_step_key: Mapped[str] = mapped_column(String(80), default="intro")
    demo_code_seed: Mapped[str] = mapped_column(String(80))
    demo_code_hash: Mapped[str] = mapped_column(String(64))
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reward_awarded: Mapped[bool] = mapped_column(Boolean, default=False)
    state_json: Mapped[dict] = mapped_column(JSON, default=dict)

    mission: Mapped[Mission] = relationship("Mission")
    operator: Mapped[Operator] = relationship("Operator")
    events: Mapped[list[MissionEvent]] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        order_by="MissionEvent.created_at",
    )


class MissionEvent(Base):
    __tablename__ = "mission_events"
    __table_args__ = (Index("ix_mission_events_attempt_created", "attempt_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("mission_attempts.id", ondelete="CASCADE"), index=True
    )
    step_key: Mapped[str] = mapped_column(String(80))
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    action_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)

    attempt: Mapped[MissionAttempt] = relationship(back_populates="events")


class WheelCampaign(Base):
    """Wheel of WOW campaign. Normally there is one active campaign."""
    __tablename__ = "wheel_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # daily | weekly | seasonal | special (ТЗ 8.1). Влияет только на семантику
    # правил/отчётов — сама механика прокрутки от типа не зависит.
    campaign_type: Mapped[str] = mapped_column(String(32), default="daily")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    max_spins_per_day: Mapped[int] = mapped_column(Integer, default=1)
    max_spins_per_week: Mapped[int] = mapped_column(Integer, default=3)
    ticket_ttl_days: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    prizes: Mapped[list[WheelPrize]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class WheelPrize(Base):
    """Wheel sector. There is no empty prize sector."""
    __tablename__ = "wheel_prizes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("wheel_campaigns.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    prize_type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[int] = mapped_column(Integer, default=0)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    color: Mapped[str] = mapped_column(String(16), default="#38BDF8")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Лимиты выпадения приза. 0 = без ограничения. total/per_operator — за всё
    # время; *_daily_limit / *_weekly_limit / monthly_limit — скользящие окна.
    max_wins_total: Mapped[int] = mapped_column(Integer, default=0)
    max_wins_per_operator: Mapped[int] = mapped_column(Integer, default=0)
    daily_limit: Mapped[int] = mapped_column(Integer, default=0)
    weekly_limit: Mapped[int] = mapped_column(Integer, default=0)
    monthly_limit: Mapped[int] = mapped_column(Integer, default=0)
    per_operator_daily_limit: Mapped[int] = mapped_column(Integer, default=0)
    per_operator_weekly_limit: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    campaign: Mapped[WheelCampaign] = relationship(back_populates="prizes")


class WheelTicket(Base):
    """
    Право оператора на одну прокрутку («wheel_spin_token» из ТЗ п.8.5).
    Исторически называется ticket — переименование таблицы деструктивно и не
    требуется для функциональности, поэтому оставлено как есть.

    Уникальный индекс (ТЗ п.9) запрещает выдать два токена за один и тот же
    источник (тест/отчёт/миссию). NULL-значения в rule_id/source_entity_id
    считаются различными и в Postgres, и в SQLite — поэтому ручные выдачи
    (без правила и сущности) под ограничение не попадают.
    """
    __tablename__ = "wheel_tickets"
    __table_args__ = (
        UniqueConstraint(
            "operator_id", "campaign_id", "rule_id", "source_module", "source_entity_id",
            name="uq_wheel_token_source",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("wheel_campaigns.id"), index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_eligibility_rules.id"), nullable=True, index=True)
    reason_type: Mapped[str] = mapped_column(String(40), default="manual")
    reason_text: Mapped[str] = mapped_column(Text, default="")
    # source_type/source_id — исторические поля; source_module/source_entity_id —
    # из ТЗ (обязательны для авто-выдачи по правилу, п.8.5 «source_entity_id обязателен»).
    source_type: Mapped[str] = mapped_column(String(40), default="manual")
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_module: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="available", index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    operator: Mapped[Operator] = relationship("Operator")


class WheelSpin(Base):
    """Recorded spin result with a JSON snapshot of the prize."""
    __tablename__ = "wheel_spins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("wheel_tickets.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("wheel_campaigns.id"), index=True)
    prize_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_prizes.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="created", index=True)
    result_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    operator: Mapped[Operator] = relationship("Operator")
    ticket: Mapped[WheelTicket] = relationship("WheelTicket")
    prize: Mapped[WheelPrize | None] = relationship("WheelPrize")


class ShopDiscountCoupon(Base):
    """One non-stackable shop discount won from Wheel of WOW."""
    __tablename__ = "shop_discount_coupons"
    __table_args__ = (
        UniqueConstraint("wheel_spin_id", name="uq_shop_discount_coupon_spin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    wheel_spin_id: Mapped[int] = mapped_column(ForeignKey("wheel_spins.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Скидка в магазине")
    percent: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(String(20), default="available", index=True)
    reserved_purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("shop_purchases.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WheelEligibilityRule(Base):
    """
    Правило получения токена (ТЗ п.8.3). Описывает: из какого модуля берётся
    метрика, как она сравнивается с порогом и сколько токенов можно выдать за
    период. Движок правил (WheelEligibilityService) выполняет их декларативно.
    """
    __tablename__ = "wheel_eligibility_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("wheel_campaigns.id"), index=True)
    code: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # operators | tests | analytics | period_reports | rating | missions | manual
    source_module: Mapped[str] = mapped_column(String(40), index=True)
    # test_passed | test_score | simulation_passed | quality_score | no_late |
    # no_violations | rating_place | work_hours_percent | efficiency_percent |
    # manual_grant | mission_completed
    rule_type: Mapped[str] = mapped_column(String(48))
    metric_key: Mapped[str] = mapped_column(String(64), default="")
    # gte | lte | eq | between | is_true
    operator: Mapped[str] = mapped_column(String(12), default="gte")
    threshold_value: Mapped[float] = mapped_column(Float, default=0)
    threshold_value_max: Mapped[float | None] = mapped_column(Float, nullable=True)  # для between
    # daily | weekly | monthly | period
    period_type: Mapped[str] = mapped_column(String(16), default="daily")
    max_tokens_per_period: Mapped[int] = mapped_column(Integer, default=1)
    token_ttl_hours: Mapped[int] = mapped_column(Integer, default=24)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    campaign: Mapped[WheelCampaign] = relationship("WheelCampaign")


class WheelRuleEvaluationLog(Base):
    """
    Журнал проверки правил (ТЗ п.8.7). Пишется на КАЖДУЮ проверку — и когда
    токен выдан, и когда нет. Даёт супервайзеру ответ «почему оператор получил
    (или не получил) попытку» (Acceptance #15, #20).
    """
    __tablename__ = "wheel_rule_evaluation_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_campaigns.id"), nullable=True, index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_eligibility_rules.id"), nullable=True, index=True)
    source_module: Mapped[str] = mapped_column(String(40), default="")
    source_entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    metric_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    operator: Mapped[str] = mapped_column(String(12), default="")
    threshold_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_eligible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_token_id: Mapped[int | None] = mapped_column(ForeignKey("wheel_tickets.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, index=True)


class WheelOperatorDailyState(Base):
    """
    Денормализованное дневное состояние оператора (ТЗ п.8.8) — для быстрой
    карточки на главной без агрегаций на лету. Обновляется при выдаче токена и
    прокрутке. Уникальна пара (operator_id, date).
    """
    __tablename__ = "wheel_operator_daily_state"
    __table_args__ = (
        UniqueConstraint("operator_id", "date", name="uq_wheel_daily_state_operator_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    active_tokens_count: Mapped[int] = mapped_column(Integer, default=0)
    used_tokens_count: Mapped[int] = mapped_column(Integer, default=0)
    expired_tokens_count: Mapped[int] = mapped_column(Integer, default=0)
    last_spin_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_prize_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_prize_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_prize_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


class WheelSetting(Base):
    """Общие настройки колеса (ТЗ п.8.9). Простое key/value-хранилище."""
    __tablename__ = "wheel_settings"
    __table_args__ = (
        UniqueConstraint("key", name="uq_wheel_settings_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)


class WheelManualGrant(Base):
    """Ручная выдача токенов супервайзером/руководителем (ТЗ п.8.10)."""
    __tablename__ = "wheel_manual_grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("wheel_campaigns.id"), index=True)
    granted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    tokens_count: Mapped[int] = mapped_column(Integer, default=1)
    reason: Mapped[str] = mapped_column(String(200), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)


class Raffle(Base):
    """Розыгрыш (ТЗ P2). Участие — билетами из Колеса WOW (не за коины).
    Победителей может быть несколько (winners_count)."""
    __tablename__ = "raffles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    prize_coins: Mapped[int] = mapped_column(Integer, default=0)
    prize_description: Mapped[str] = mapped_column(String(300), default="")
    winners_count: Mapped[int] = mapped_column(Integer, default=1)
    # active | drawn | cancelled
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    drawn_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    entries: Mapped[list[RaffleEntry]] = relationship(back_populates="raffle")
    winners: Mapped[list[RaffleWinner]] = relationship(back_populates="raffle")


class RaffleEntry(Base):
    """Участие оператора: сколько своих билетов он вложил в этот розыгрыш."""
    __tablename__ = "raffle_entries"
    __table_args__ = (UniqueConstraint("raffle_id", "operator_id", name="uq_raffle_entry_operator"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raffle_id: Mapped[int] = mapped_column(ForeignKey("raffles.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    tickets: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    raffle: Mapped[Raffle] = relationship(back_populates="entries")
    operator: Mapped[Operator] = relationship("Operator")


class RaffleWinner(Base):
    __tablename__ = "raffle_winners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raffle_id: Mapped[int] = mapped_column(ForeignKey("raffles.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("operators.id"), index=True)
    tickets_at_draw: Mapped[int] = mapped_column(Integer, default=0)
    prize_coins: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)

    raffle: Mapped[Raffle] = relationship(back_populates="winners")
    operator: Mapped[Operator] = relationship("Operator")


# ============================================================================
# Экономика коинов: сезоны, правила наград, сезонные цены
# (ТЗ «Экономика коинов, магазин призов и стартовый сезон Puls», §7, §11, §12)
# ============================================================================


class EconomySeason(Base):
    """Сезон экономики (ТЗ §7): стартовый сезон с повышенными наградами и
    стартовыми ценами, переходный период с уведомлением и обычный сезон.

    Статусы: draft → announced → active → completed. Активным считается
    сезон в статусе active, чьё окно дат покрывает текущий момент
    (naive UTC, как всё время в БД)."""
    __tablename__ = "economy_seasons"
    __table_args__ = (
        UniqueConstraint("code", name="uq_economy_seasons_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # Не позднее чем за 7 дней операторы получают уведомление о переходе (ТЗ §7.3)
    notification_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    config_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Версионирование (ТЗ §11): изменения влияют только на новые события/покупки
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    created_by: Mapped[User | None] = relationship("User")
    reward_rules: Mapped[list[RewardRule]] = relationship(back_populates="season")
    item_prices: Mapped[list[ShopItemPrice]] = relationship(back_populates="season")


class RewardRule(Base):
    """Правило начисления коинов (ТЗ §4, §11): источник + условие + сумма
    управляются администратором, а не числом, зашитым во frontend.

    source_type — класс события: mission, test, weekly, onboarding, contest…
    source_code — конкретное событие внутри класса: например
        mission:first_complete, test:score_80_89, weekly:quality_96_98,
        onboarding:profile_filled. Пара (source_type, source_code) — контракт
        между источником события и движком наград.
    season_id — NULL: правило действует во всех сезонах; иначе — только в
        указанном. Сезонное правило имеет приоритет над глобальным.
    threshold — числовой порог (проходной балл, минимум оценённых звонков…);
        интерпретация зависит от источника.
    period / period_limit — ограничение частоты: сколько выплат допустимо
        на оператора за период ('all_time', 'week', 'month'). 1 + all_time =
        классическая одноразовая награда."""
    __tablename__ = "reward_rules"
    __table_args__ = (
        Index("ix_reward_rules_lookup", "source_type", "source_code", "active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season_id: Mapped[int | None] = mapped_column(
        ForeignKey("economy_seasons.id"), nullable=True, index=True
    )
    source_type: Mapped[str] = mapped_column(String(50))
    source_code: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(200), default="")
    amount: Mapped[int] = mapped_column(Integer)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    period: Mapped[str] = mapped_column(String(20), default="all_time")  # all_time | week | month
    period_limit: Mapped[int] = mapped_column(Integer, default=1)  # 0 = без лимита
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    season: Mapped[EconomySeason | None] = relationship(back_populates="reward_rules")
    updated_by: Mapped[User | None] = relationship("User")


class ShopItemPrice(Base):
    """Сезонная цена товара магазина (ТЗ §7, §8, §12 prize_prices).

    Базовая (обычная) цена остаётся в ShopItem.price — это «будущая цена»,
    которую карточка показывает рядом со стартовой (ТЗ: «Нельзя повышать
    цены скрытно»). Запись здесь — переопределение цены для конкретного
    сезона. Эффективная цена = сезонная (если есть активная запись для
    активного сезона), иначе базовая."""
    __tablename__ = "shop_item_prices"
    __table_args__ = (
        UniqueConstraint("shop_item_id", "season_id", name="uq_shop_item_prices_item_season"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_item_id: Mapped[int] = mapped_column(
        ForeignKey("shop_items.id", ondelete="CASCADE"), index=True
    )
    season_id: Mapped[int] = mapped_column(ForeignKey("economy_seasons.id"), index=True)
    coin_price: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    shop_item: Mapped[ShopItem] = relationship("ShopItem")
    season: Mapped[EconomySeason] = relationship(back_populates="item_prices")


class ShopItemInventory(Base):
    """Складской учёт приза счётчиками (ТЗ §12.1 prize_inventory):
    приход / резерв / выдача / возврат.

    available = quantity_received + quantity_returned
                - quantity_reserved - quantity_issued

    Запись опциональна: товары без неё продолжают жить на stock_limit
    (лимит раздачи, посчитанный по заявкам). Если запись есть — она
    становится источником истины по остатку. min_stock_alert — порог
    уведомления администратора о низком остатке (ТЗ §10.3)."""
    __tablename__ = "shop_item_inventory"
    __table_args__ = (
        UniqueConstraint("shop_item_id", name="uq_shop_item_inventory_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_item_id: Mapped[int] = mapped_column(
        ForeignKey("shop_items.id", ondelete="CASCADE"), index=True
    )
    quantity_received: Mapped[int] = mapped_column(Integer, default=0)
    quantity_reserved: Mapped[int] = mapped_column(Integer, default=0)
    quantity_issued: Mapped[int] = mapped_column(Integer, default=0)
    quantity_returned: Mapped[int] = mapped_column(Integer, default=0)
    min_stock_alert: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, onupdate=now_utc)

    shop_item: Mapped[ShopItem] = relationship("ShopItem")

    @property
    def available(self) -> int:
        return (
            self.quantity_received
            + self.quantity_returned
            - self.quantity_reserved
            - self.quantity_issued
        )
