"""Repair level coin reward schema if a prior deploy was stamped early.

Revision ID: 0019_repair_level_coin_reward_schema
Revises: 0018_level_coin_rewards
Create Date: 2026-07-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0019_repair_level_coin_reward_schema"
down_revision = "0018_level_coin_rewards"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()

    if conn.dialect.name == "postgresql":
        conn.execute(sa.text("ALTER TABLE operator_levels ADD COLUMN IF NOT EXISTS min_total_xp INTEGER NOT NULL DEFAULT 0"))
        conn.execute(sa.text("ALTER TABLE operator_levels ADD COLUMN IF NOT EXISTS reward_coins INTEGER NOT NULL DEFAULT 0"))
        conn.execute(sa.text("ALTER TABLE operator_levels ADD COLUMN IF NOT EXISTS reward_once BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(sa.text("ALTER TABLE operator_levels ADD COLUMN IF NOT EXISTS coin_multiplier_percent DOUBLE PRECISION NOT NULL DEFAULT 0"))
        conn.execute(sa.text("ALTER TABLE operator_levels ADD COLUMN IF NOT EXISTS shop_discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0"))

        conn.execute(sa.text("ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS source_type VARCHAR(50)"))
        conn.execute(sa.text("ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS source_id INTEGER"))
        conn.execute(sa.text("ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS metadata JSONB"))

        conn.execute(sa.text("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS min_level_id INTEGER"))

        conn.execute(sa.text("""
            CREATE TABLE IF NOT EXISTS operator_level_rewards (
                id SERIAL PRIMARY KEY,
                operator_id INTEGER NOT NULL,
                level_id INTEGER NOT NULL,
                coin_transaction_id INTEGER NULL,
                reward_coins INTEGER NOT NULL DEFAULT 0,
                source_type VARCHAR(50) NOT NULL DEFAULT 'level_up',
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(sa.text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_level_reward
            ON operator_level_rewards (operator_id, level_id)
        """))
        conn.execute(sa.text("""
            CREATE INDEX IF NOT EXISTS ix_operator_level_rewards_operator_id
            ON operator_level_rewards (operator_id)
        """))
        conn.execute(sa.text("""
            CREATE INDEX IF NOT EXISTS ix_operator_level_rewards_level_id
            ON operator_level_rewards (level_id)
        """))
        conn.execute(sa.text("""
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
        return

    # SQLite/dev fallback.
    if _table_exists("operator_levels"):
        for name, col_type in (
            ("min_total_xp", "INTEGER NOT NULL DEFAULT 0"),
            ("reward_coins", "INTEGER NOT NULL DEFAULT 0"),
            ("reward_once", "BOOLEAN NOT NULL DEFAULT 1"),
            ("coin_multiplier_percent", "FLOAT NOT NULL DEFAULT 0"),
            ("shop_discount_percent", "FLOAT NOT NULL DEFAULT 0"),
        ):
            if not _column_exists("operator_levels", name):
                conn.execute(sa.text(f"ALTER TABLE operator_levels ADD COLUMN {name} {col_type}"))

    if _table_exists("coin_transactions"):
        for name, col_type in (
            ("source_type", "VARCHAR(50)"),
            ("source_id", "INTEGER"),
            ("metadata", "JSON"),
        ):
            if not _column_exists("coin_transactions", name):
                conn.execute(sa.text(f"ALTER TABLE coin_transactions ADD COLUMN {name} {col_type}"))

    if _table_exists("shop_items") and not _column_exists("shop_items", "min_level_id"):
        conn.execute(sa.text("ALTER TABLE shop_items ADD COLUMN min_level_id INTEGER"))

    if not _table_exists("operator_level_rewards"):
        conn.execute(sa.text("""
            CREATE TABLE operator_level_rewards (
                id INTEGER PRIMARY KEY,
                operator_id INTEGER NOT NULL,
                level_id INTEGER NOT NULL,
                coin_transaction_id INTEGER NULL,
                reward_coins INTEGER NOT NULL DEFAULT 0,
                source_type VARCHAR(50) NOT NULL DEFAULT 'level_up',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(sa.text("CREATE UNIQUE INDEX uq_operator_level_reward ON operator_level_rewards (operator_id, level_id)"))


def downgrade() -> None:
    pass
