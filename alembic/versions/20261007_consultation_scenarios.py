"""Persist versioned Business consultation attempts and verified practice."""

import sqlalchemy as sa

from alembic import op

revision = "20261007_scenarios"
down_revision = "20261003_manual_coin_limit"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "scenario_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scenario_key", sa.String(40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("phase", sa.String(20), nullable=False),
        sa.Column("practice", sa.JSON(), nullable=False),
        sa.Column("is_preview", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("awarded_coins", sa.Integer(), nullable=False),
        sa.Column("reward_already_claimed", sa.Boolean(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for field in ("user_id", "scenario_key", "state", "created_at"):
        op.create_index(f"ix_scenario_attempts_{field}", "scenario_attempts", [field])


def downgrade():
    op.drop_table("scenario_attempts")
