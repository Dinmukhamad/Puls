"""Configurable coin accrual rules (TZ section 4): coin_rules table.

Revision ID: 0023_coin_rules
Revises: 0022_user_sessions
Create Date: 2026-07-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_coin_rules"
down_revision = "0022_user_sessions"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _table_exists("coin_rules"):
        op.create_table(
            "coin_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("points_per_coin", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("rounding_mode", sa.String(16), nullable=False, server_default="floor"),
            sa.Column("min_points_for_accrual", sa.Float(), nullable=False, server_default="0"),
            sa.Column("top_1_bonus", sa.Integer(), nullable=False, server_default="15"),
            sa.Column("top_2_bonus", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("top_3_bonus", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("no_late_bonus", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("no_violation_bonus", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("nomination_bonus", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("driver_thanks_bonus", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("accrue_to_fired", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("accrue_to_inactive", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
        op.create_index("ix_coin_rules_is_active", "coin_rules", ["is_active"])

        # Единственная активная запись с дефолтами из действующего ТЗ (курс 5:1).
        op.execute(
            """
            INSERT INTO coin_rules (
                points_per_coin, rounding_mode, min_points_for_accrual,
                top_1_bonus, top_2_bonus, top_3_bonus,
                no_late_bonus, no_violation_bonus, nomination_bonus, driver_thanks_bonus,
                accrue_to_fired, accrue_to_inactive, is_active
            )
            VALUES (5, 'floor', 0, 15, 10, 7, 5, 3, 5, 3, false, false, true)
            """
        )


def downgrade() -> None:
    if _table_exists("coin_rules"):
        op.drop_table("coin_rules")
