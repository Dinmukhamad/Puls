"""mission reward snapshots and active duration

Revision ID: 0039_mission_reward_snapshots
Revises: 0038_coin_economy_blueprint
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039_mission_reward_snapshots"
down_revision = "0038_coin_economy_blueprint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "mission_attempts" not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.add_column(
        "mission_attempts",
        sa.Column("reward_amount_snapshot", sa.Integer(), nullable=True),
    )
    op.add_column(
        "mission_attempts",
        sa.Column("reward_currency_snapshot", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "mission_attempts",
        sa.Column("reward_transaction_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "mission_attempts",
        sa.Column("active_duration_seconds", sa.Integer(), nullable=True),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key(
            "fk_mission_attempt_reward_transaction",
            "mission_attempts",
            "coin_transactions",
            ["reward_transaction_id"],
            ["id"],
        )
    op.execute(
        """
        UPDATE mission_attempts AS attempt
        SET reward_amount_snapshot = tx.amount,
            reward_currency_snapshot = '₡',
            reward_transaction_id = tx.id,
            active_duration_seconds = attempt.duration_seconds
        FROM coin_transactions AS tx
        WHERE attempt.reward_awarded = TRUE
          AND tx.source_type = 'mission_reward'
          AND tx.source_id = attempt.id
        """
    )


def downgrade() -> None:
    if "mission_attempts" not in sa.inspect(op.get_bind()).get_table_names():
        return
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(
            "fk_mission_attempt_reward_transaction",
            "mission_attempts",
            type_="foreignkey",
        )
    op.drop_column("mission_attempts", "active_duration_seconds")
    op.drop_column("mission_attempts", "reward_transaction_id")
    op.drop_column("mission_attempts", "reward_currency_snapshot")
    op.drop_column("mission_attempts", "reward_amount_snapshot")
