from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.entities import AuditLog, Group, UserSession

logger = logging.getLogger(__name__)


def ensure_operator_management_schema(engine: Engine) -> None:
    """Add missing columns to existing tables. Safe to run multiple times."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        if "operators" in tables:
            existing = {col["name"] for col in inspector.get_columns("operators")}
            migrations = [
                ("group_id",           "INTEGER"),
                ("participation_status", "VARCHAR(32) NOT NULL DEFAULT 'participating'"),
                ("employment_status",  "VARCHAR(32) NOT NULL DEFAULT 'active'"),
                ("dismissed_at",       "TIMESTAMP"),
                ("status",             "VARCHAR(32) NOT NULL DEFAULT 'active'"),
                ("position",           "VARCHAR(200)"),
                ("employee_id",        "VARCHAR(100)"),
                ("email",              "VARCHAR(200)"),
                ("start_date",         "DATE"),
                ("comment",            "TEXT"),
                ("created_by_user_id", "INTEGER"),
                ("updated_at",         "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
            ]
            for col_name, col_type in migrations:
                if col_name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE operators ADD COLUMN {col_name} {col_type}"
                    ))
                    logger.info("[schema] Added operators.%s", col_name)

        if "users" in tables:
            existing = {col["name"] for col in inspector.get_columns("users")}
            if "can_manage_operators" not in existing:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN can_manage_operators "
                    "BOOLEAN NOT NULL DEFAULT false"
                ))
                logger.info("[schema] Added users.can_manage_operators")
            if "must_change_password" not in existing:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN must_change_password "
                    "BOOLEAN NOT NULL DEFAULT false"
                ))
                logger.info("[schema] Added users.must_change_password")

        if "operator_levels" in tables:
            existing = {col["name"] for col in inspector.get_columns("operator_levels")}
            migrations = [
                ("min_total_xp", "INTEGER NOT NULL DEFAULT 0"),
                ("reward_coins", "INTEGER NOT NULL DEFAULT 0"),
                ("reward_once", "BOOLEAN NOT NULL DEFAULT true"),
                ("coin_multiplier_percent", "DOUBLE PRECISION NOT NULL DEFAULT 0"),
                ("shop_discount_percent", "DOUBLE PRECISION NOT NULL DEFAULT 0"),
            ]
            for col_name, col_type in migrations:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE operator_levels ADD COLUMN {col_name} {col_type}"))
                    logger.info("[schema] Added operator_levels.%s", col_name)
            conn.execute(text("""
                UPDATE operator_levels
                SET reward_coins = CASE code
                    WHEN 'trainee' THEN 0
                    WHEN 'newbie' THEN 3
                    WHEN 'operator' THEN 5
                    WHEN 'pro' THEN 8
                    ELSE reward_coins
                END
                WHERE reward_coins = 0
            """))

        if "coin_transactions" in tables:
            existing = {col["name"] for col in inspector.get_columns("coin_transactions")}
            metadata_type = "JSONB" if engine.dialect.name == "postgresql" else "JSON"
            migrations = [
                ("source_type", "VARCHAR(50)"),
                ("source_id", "INTEGER"),
                ("metadata", metadata_type),
            ]
            for col_name, col_type in migrations:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE coin_transactions ADD COLUMN {col_name} {col_type}"))
                    logger.info("[schema] Added coin_transactions.%s", col_name)

        if "shop_items" in tables:
            existing = {col["name"] for col in inspector.get_columns("shop_items")}
            if "min_level_id" not in existing:
                conn.execute(text("ALTER TABLE shop_items ADD COLUMN min_level_id INTEGER"))
                logger.info("[schema] Added shop_items.min_level_id")
            if "category" not in existing:
                conn.execute(text("ALTER TABLE shop_items ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'other'"))
                logger.info("[schema] Added shop_items.category")
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_shop_items_category ON shop_items (category)"))

        if "operator_level_rewards" not in tables:
            id_type = "SERIAL PRIMARY KEY" if engine.dialect.name == "postgresql" else "INTEGER PRIMARY KEY"
            created_default = "NOW()" if engine.dialect.name == "postgresql" else "CURRENT_TIMESTAMP"
            conn.execute(text(f"""
                CREATE TABLE operator_level_rewards (
                    id {id_type},
                    operator_id INTEGER NOT NULL,
                    level_id INTEGER NOT NULL,
                    coin_transaction_id INTEGER NULL,
                    reward_coins INTEGER NOT NULL DEFAULT 0,
                    source_type VARCHAR(50) NOT NULL DEFAULT 'level_up',
                    created_at TIMESTAMP NOT NULL DEFAULT {created_default}
                )
            """))
            conn.execute(text(
                "CREATE UNIQUE INDEX uq_operator_level_reward "
                "ON operator_level_rewards (operator_id, level_id)"
            ))
            conn.execute(text(
                "CREATE INDEX ix_operator_level_rewards_operator_id "
                "ON operator_level_rewards (operator_id)"
            ))
            conn.execute(text(
                "CREATE INDEX ix_operator_level_rewards_level_id "
                "ON operator_level_rewards (level_id)"
            ))
            logger.info("[schema] operator_level_rewards table ensured")

        # Ensure audit_logs table exists
        Group.__table__.create(bind=conn, checkfirst=True)
        AuditLog.__table__.create(bind=conn, checkfirst=True)
        UserSession.__table__.create(bind=conn, checkfirst=True)
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        if "user_sessions" in tables:
            existing = {col["name"] for col in inspector.get_columns("user_sessions")}
            created_default = "NOW()" if engine.dialect.name == "postgresql" else "CURRENT_TIMESTAMP"
            migrations = [
                ("session_id", "VARCHAR(64)"),
                ("user_id", "INTEGER"),
                ("ip_address", "VARCHAR(64)"),
                ("user_agent", "TEXT"),
                ("device_label", "VARCHAR(255) NOT NULL DEFAULT ''"),
                ("browser_label", "VARCHAR(120) NOT NULL DEFAULT ''"),
                ("os_label", "VARCHAR(120) NOT NULL DEFAULT ''"),
                ("status", "VARCHAR(32) NOT NULL DEFAULT 'active'"),
                ("created_at", f"TIMESTAMP NOT NULL DEFAULT {created_default}"),
                ("last_seen_at", f"TIMESTAMP NOT NULL DEFAULT {created_default}"),
                ("expires_at", "TIMESTAMP"),
                ("revoked_at", "TIMESTAMP"),
                ("revoked_by_user_id", "INTEGER"),
                ("revoke_reason", "TEXT"),
            ]
            for col_name, col_type in migrations:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE user_sessions ADD COLUMN {col_name} {col_type}"))
                    logger.info("[schema] Added user_sessions.%s", col_name)
        logger.info("[schema] groups table ensured")
        logger.info("[schema] audit_logs table ensured")
        logger.info("[schema] user_sessions table ensured")


def ensure_wheel_schema(engine: Engine) -> None:
    """
    Аддитивная миграция схемы Wheel of WOW (ТЗ раздел 8). Безопасно запускать
    многократно: добавляет недостающие колонки в существующие таблицы колеса и
    создаёт новые таблицы движка правил. Деструктивных изменений нет.
    """
    from app.models.entities import (
        WheelEligibilityRule,
        WheelManualGrant,
        WheelOperatorDailyState,
        WheelRuleEvaluationLog,
        WheelSetting,
    )

    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        col_migrations = {
            "wheel_campaigns": [
                ("campaign_type", "VARCHAR(32) NOT NULL DEFAULT 'daily'"),
            ],
            "wheel_prizes": [
                ("description", "TEXT"),
                ("daily_limit", "INTEGER NOT NULL DEFAULT 0"),
                ("weekly_limit", "INTEGER NOT NULL DEFAULT 0"),
                ("monthly_limit", "INTEGER NOT NULL DEFAULT 0"),
                ("per_operator_daily_limit", "INTEGER NOT NULL DEFAULT 0"),
                ("per_operator_weekly_limit", "INTEGER NOT NULL DEFAULT 0"),
            ],
            "wheel_tickets": [
                ("rule_id", "INTEGER"),
                ("source_module", "VARCHAR(40)"),
                ("source_entity_id", "INTEGER"),
                ("source_period_start", "DATE"),
                ("source_period_end", "DATE"),
                ("cancelled_at", "TIMESTAMP"),
                ("cancel_reason", "TEXT"),
            ],
        }
        for table, cols in col_migrations.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for col_name, col_type in cols:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
                    logger.info("[schema] Added %s.%s", table, col_name)

        # Новые таблицы движка правил
        for model in (WheelEligibilityRule, WheelRuleEvaluationLog,
                      WheelOperatorDailyState, WheelSetting, WheelManualGrant):
            model.__table__.create(bind=conn, checkfirst=True)
        logger.info("[schema] wheel rules-engine tables ensured")

        # Уникальный индекс против дублей токенов (ТЗ п.9). NULL-и различны в
        # обоих диалектах, ручные токены под ограничение не попадают.
        if "wheel_tickets" in tables:
            existing_idx = {ix["name"] for ix in inspect(conn).get_indexes("wheel_tickets")}
            if "uq_wheel_token_source" not in existing_idx:
                try:
                    conn.execute(text(
                        "CREATE UNIQUE INDEX uq_wheel_token_source ON wheel_tickets "
                        "(operator_id, campaign_id, rule_id, source_module, source_entity_id)"
                    ))
                    logger.info("[schema] uq_wheel_token_source index created")
                except Exception as e:  # noqa: BLE001 — не валим старт из-за возможных дублей
                    logger.warning("[schema] uq_wheel_token_source not created: %s", e)
