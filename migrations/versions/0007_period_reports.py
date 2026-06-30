"""0007 period reports

Revision ID: 0007_period_reports
Revises: 0006_op_employment
Create Date: 2026-06-30
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0008_period_reports"
down_revision = "0007_user_must_change_password"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("period_reports"):
        op.create_table(
            "period_reports",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("quality_avg", sa.Float(), nullable=False, server_default="0"),
            sa.Column("quality_calls_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("base_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("tech_issue_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("training_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("offline_activity_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("calls_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("kvz", sa.Float(), nullable=False, server_default="0"),
            sa.Column("call_time_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("efficiency_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_sum", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_minutes", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("final_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("coins_awarded", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
        op.create_index("ix_period_reports_operator_id", "period_reports", ["operator_id"])
        op.create_index("ix_period_reports_period_start", "period_reports", ["period_start"])
        op.create_index("ix_period_reports_period_end", "period_reports", ["period_end"])


def downgrade() -> None:
    pass
