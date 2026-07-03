from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.entities import AuditLog, Group

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
        logger.info("[schema] groups table ensured")
        logger.info("[schema] audit_logs table ensured")
