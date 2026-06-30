"""Add operator_daily_metrics table for arbitrary date-range analytics.

Revision ID: 0011_operator_daily_metrics
Revises: 0010_period_report_idempotency
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0011_operator_daily_metrics"
down_revision = "0010_period_report_idempotency"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("operator_daily_metrics"):
        op.create_table(
            "operator_daily_metrics",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("operator_name", sa.String(255), nullable=False),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id"), nullable=True),
            sa.Column("metric_date", sa.Date(), nullable=False),
            sa.Column("calls_count", sa.Float(), nullable=False, server_default="0"),
            sa.Column("quality_scores_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("quality_sum", sa.Float(), nullable=False, server_default="0"),
            sa.Column("quality_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("quality_avg", sa.Float(), nullable=False, server_default="0"),
            sa.Column("kvz", sa.Float(), nullable=False, server_default="0"),
            sa.Column("efficiency", sa.Float(), nullable=False, server_default="0"),
            sa.Column("worked_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("tech_issue_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("training_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("offline_activity_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("base_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_sum", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_minutes", sa.Float(), nullable=False, server_default="0"),
            sa.Column("penalty_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("source_monthly_report_id", sa.Integer(), sa.ForeignKey("uploaded_report_files.id"), nullable=True),
            sa.Column("source_report_id", sa.Integer(), sa.ForeignKey("uploaded_report_files.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_operator_daily_metrics_operator_id", "operator_daily_metrics", ["operator_id"])
        op.create_index("ix_operator_daily_metrics_metric_date", "operator_daily_metrics", ["metric_date"])
        op.create_unique_constraint(
            "uq_daily_metrics_operator_date",
            "operator_daily_metrics",
            ["operator_id", "metric_date"],
        )


def downgrade() -> None:
    if _table_exists("operator_daily_metrics"):
        op.drop_table("operator_daily_metrics")
