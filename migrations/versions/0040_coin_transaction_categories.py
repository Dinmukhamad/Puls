"""categorize coin ledger entries

Revision ID: 0040_coin_transaction_categories
Revises: 0039_mission_reward_snapshots
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0040_coin_transaction_categories"
down_revision = "0039_mission_reward_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "coin_transactions" not in inspector.get_table_names():
        return
    existing_columns = {
        column["name"] for column in inspector.get_columns("coin_transactions")
    }
    if "category" in existing_columns:
        return
    op.add_column(
        "coin_transactions",
        sa.Column(
            "category",
            sa.String(length=32),
            nullable=False,
            server_default="adjustment",
        ),
    )
    if {"amount", "type", "source_type"}.issubset(existing_columns):
        op.execute(
            """
            UPDATE coin_transactions
            SET category = CASE
              WHEN type = 'refund' OR source_type LIKE '%refund%' THEN 'refund'
              WHEN amount > 0 AND type IN (
                'achievement_reward', 'level_reward', 'mission_reward',
                'period_report', 'raffle_reward', 'test_reward',
                'weekly_accrual', 'wheel_reward'
              ) THEN 'earning'
              WHEN amount < 0 AND type IN (
                'manual_deduction', 'manual_subtract', 'purchase'
              ) THEN 'spending'
              ELSE 'adjustment'
            END
            """
        )
    op.create_index(
        "ix_coin_transactions_category",
        "coin_transactions",
        ["category"],
        unique=False,
    )


def downgrade() -> None:
    if "coin_transactions" not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.drop_index("ix_coin_transactions_category", table_name="coin_transactions")
    op.drop_column("coin_transactions", "category")
