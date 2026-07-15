"""Add the extensible operator missions domain.

Revision ID: 0032_missions
Revises: 0031_repair_user_display_names
Create Date: 2026-07-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032_missions"
down_revision = "0031_repair_user_display_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "missions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("mission_type", sa.String(length=32), nullable=False, server_default="tutorial"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("prerequisites_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code", name="uq_missions_code"),
    )
    op.create_index("ix_missions_code", "missions", ["code"], unique=True)
    op.create_index("ix_missions_type", "missions", ["mission_type"])
    op.create_index("ix_missions_sort_order", "missions", ["sort_order"])
    op.create_index("ix_missions_active", "missions", ["is_active"])

    op.create_table(
        "mission_steps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mission_id",
            sa.Integer(),
            sa.ForeignKey("missions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mission_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("step_key", sa.String(length=80), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.String(length=40), nullable=False),
        sa.Column("screen_key", sa.String(length=80), nullable=False),
        sa.Column("action_key", sa.String(length=80), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("hint_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint(
            "mission_id", "mission_version", "step_key", name="uq_mission_steps_key"
        ),
        sa.UniqueConstraint(
            "mission_id", "mission_version", "step_order", name="uq_mission_steps_order"
        ),
    )
    op.create_index("ix_mission_steps_mission", "mission_steps", ["mission_id"])
    op.create_index("ix_mission_steps_version", "mission_steps", ["mission_version"])

    op.create_table(
        "operator_mission_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
        sa.Column("mission_id", sa.Integer(), sa.ForeignKey("missions.id"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="available"),
        sa.Column("current_step_key", sa.String(length=80), nullable=True),
        sa.Column("best_score", sa.Float(), nullable=True),
        sa.Column("attempts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reward_claimed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reward_claimed_version", sa.Integer(), nullable=True),
        sa.Column(
            "reward_transaction_id",
            sa.Integer(),
            sa.ForeignKey("coin_transactions.id"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("operator_id", "mission_id", name="uq_operator_mission_progress"),
    )
    op.create_index("ix_mission_progress_operator", "operator_mission_progress", ["operator_id"])
    op.create_index("ix_mission_progress_mission", "operator_mission_progress", ["mission_id"])
    op.create_index("ix_mission_progress_status", "operator_mission_progress", ["status"])

    op.create_table(
        "mission_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
        sa.Column("mission_id", sa.Integer(), sa.ForeignKey("missions.id"), nullable=False),
        sa.Column("mission_version", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False, server_default="tutorial"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="in_progress"),
        sa.Column("current_step_key", sa.String(length=80), nullable=False, server_default="intro"),
        sa.Column("demo_code_seed", sa.String(length=80), nullable=False),
        sa.Column("demo_code_hash", sa.String(length=64), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("max_score", sa.Float(), nullable=True),
        sa.Column("errors_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hints_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("reward_awarded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint(
            "operator_id", "mission_id", "attempt_number", name="uq_mission_attempt_number"
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_mission_attempt_idempotency_key"),
    )
    op.create_index("ix_mission_attempts_operator", "mission_attempts", ["operator_id"])
    op.create_index("ix_mission_attempts_mission", "mission_attempts", ["mission_id"])
    op.create_index("ix_mission_attempts_status", "mission_attempts", ["status"])
    op.create_index("ix_mission_attempts_started", "mission_attempts", ["started_at"])

    op.create_table(
        "mission_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "attempt_id",
            sa.Integer(),
            sa.ForeignKey("mission_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_key", sa.String(length=80), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("action_key", sa.String(length=80), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_mission_events_attempt", "mission_events", ["attempt_id"])
    op.create_index("ix_mission_events_type", "mission_events", ["event_type"])
    op.create_index("ix_mission_events_created", "mission_events", ["created_at"])
    op.create_index(
        "ix_mission_events_attempt_created",
        "mission_events",
        ["attempt_id", "created_at"],
    )

    reward_where = sa.text("source_type = 'mission_reward'")
    op.create_index(
        "uq_coin_transactions_mission_reward",
        "coin_transactions",
        ["source_type", "source_id"],
        unique=True,
        postgresql_where=reward_where,
        sqlite_where=reward_where,
    )


def downgrade() -> None:
    op.drop_index("uq_coin_transactions_mission_reward", table_name="coin_transactions")
    op.drop_index("ix_mission_events_attempt_created", table_name="mission_events")
    op.drop_index("ix_mission_events_created", table_name="mission_events")
    op.drop_index("ix_mission_events_type", table_name="mission_events")
    op.drop_index("ix_mission_events_attempt", table_name="mission_events")
    op.drop_table("mission_events")
    op.drop_index("ix_mission_attempts_started", table_name="mission_attempts")
    op.drop_index("ix_mission_attempts_status", table_name="mission_attempts")
    op.drop_index("ix_mission_attempts_mission", table_name="mission_attempts")
    op.drop_index("ix_mission_attempts_operator", table_name="mission_attempts")
    op.drop_table("mission_attempts")
    op.drop_index("ix_mission_progress_status", table_name="operator_mission_progress")
    op.drop_index("ix_mission_progress_mission", table_name="operator_mission_progress")
    op.drop_index("ix_mission_progress_operator", table_name="operator_mission_progress")
    op.drop_table("operator_mission_progress")
    op.drop_index("ix_mission_steps_version", table_name="mission_steps")
    op.drop_index("ix_mission_steps_mission", table_name="mission_steps")
    op.drop_table("mission_steps")
    op.drop_index("ix_missions_active", table_name="missions")
    op.drop_index("ix_missions_sort_order", table_name="missions")
    op.drop_index("ix_missions_type", table_name="missions")
    op.drop_index("ix_missions_code", table_name="missions")
    op.drop_table("missions")
