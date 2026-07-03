"""Connect operator levels with one-time coin rewards.

Revision ID: 0018_level_coin_rewards
Revises: 0017_work_norms
Create Date: 2026-07-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0018_level_coin_rewards"
down_revision = "0017_work_norms"
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

    if _table_exists("operator_levels"):
        level_columns = [
            ("min_total_xp", sa.Column("min_total_xp", sa.Integer(), nullable=False, server_default="0")),
            ("reward_coins", sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0")),
            ("reward_once", sa.Column("reward_once", sa.Boolean(), nullable=False, server_default=sa.text("true"))),
            (
                "coin_multiplier_percent",
                sa.Column("coin_multiplier_percent", sa.Float(), nullable=False, server_default="0"),
            ),
            (
                "shop_discount_percent",
                sa.Column("shop_discount_percent", sa.Float(), nullable=False, server_default="0"),
            ),
        ]
        for name, column in level_columns:
            if not _column_exists("operator_levels", name):
                op.add_column("operator_levels", column)

        # Only config defaults; no balances or transactions are changed here.
        conn.execute(sa.text("""
            UPDATE operator_levels
            SET reward_coins = CASE code
                WHEN 'trainee' THEN 0
                WHEN 'newbie' THEN 3
                WHEN 'operator' THEN 5
                WHEN 'pro' THEN 8
                ELSE reward_coins
            END
        """))

    if _table_exists("coin_transactions"):
        if not _column_exists("coin_transactions", "source_type"):
            op.add_column("coin_transactions", sa.Column("source_type", sa.String(50), nullable=True))
        if not _column_exists("coin_transactions", "source_id"):
            op.add_column("coin_transactions", sa.Column("source_id", sa.Integer(), nullable=True))
        if not _column_exists("coin_transactions", "metadata"):
            metadata_type = postgresql.JSONB() if conn.dialect.name == "postgresql" else sa.JSON()
            op.add_column("coin_transactions", sa.Column("metadata", metadata_type, nullable=True))

    if _table_exists("shop_items") and not _column_exists("shop_items", "min_level_id"):
        op.add_column(
            "shop_items",
            sa.Column("min_level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=True),
        )

    if not _table_exists("operator_level_rewards"):
        op.create_table(
            "operator_level_rewards",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=False),
            sa.Column("coin_transaction_id", sa.Integer(), sa.ForeignKey("coin_transactions.id"), nullable=True),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source_type", sa.String(50), nullable=False, server_default="level_up"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("operator_id", "level_id", name="uq_operator_level_reward"),
        )
        op.create_index("ix_operator_level_rewards_operator_id", "operator_level_rewards", ["operator_id"])
        op.create_index("ix_operator_level_rewards_level_id", "operator_level_rewards", ["level_id"])


def downgrade() -> None:
    if _table_exists("operator_level_rewards"):
        op.drop_table("operator_level_rewards")
    if _table_exists("shop_items") and _column_exists("shop_items", "min_level_id"):
        op.drop_column("shop_items", "min_level_id")
    if _table_exists("coin_transactions"):
        for column in ("metadata", "source_id", "source_type"):
            if _column_exists("coin_transactions", column):
                op.drop_column("coin_transactions", column)
    if _table_exists("operator_levels"):
        for column in (
            "shop_discount_percent",
            "coin_multiplier_percent",
            "reward_once",
            "reward_coins",
            "min_total_xp",
        ):
            if _column_exists("operator_levels", column):
                op.drop_column("operator_levels", column)
