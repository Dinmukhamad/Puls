"""Автоматический еженедельный расчёт и бонусы (ТЗ §3): история запусков,
детализация начислений, thanks_count в weekly_results, тумблеры номинаций
в coin_rules.

Revision ID: 0024_weekly_accrual_engine
Revises: 0023_coin_rules
Create Date: 2026-07-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_weekly_accrual_engine"
down_revision = "0023_coin_rules"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def upgrade() -> None:
    if not _column_exists("weekly_results", "thanks_count"):
        op.add_column(
            "weekly_results",
            sa.Column("thanks_count", sa.Integer(), nullable=False, server_default="0"),
        )

    nomination_toggle_columns = [
        "nomination_calls_enabled",
        "nomination_quality_enabled",
        "nomination_efficiency_enabled",
        "nomination_progress_enabled",
        "nomination_thanks_enabled",
    ]
    for col in nomination_toggle_columns:
        if not _column_exists("coin_rules", col):
            op.add_column(
                "coin_rules",
                sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.text("true")),
            )

    if not _table_exists("weekly_accrual_runs"):
        op.create_table(
            "weekly_accrual_runs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("period_start", sa.Date(), nullable=False, index=True),
            sa.Column("period_end", sa.Date(), nullable=False, index=True),
            sa.Column("mode", sa.String(16), nullable=False),  # auto | manual
            sa.Column("status", sa.String(16), nullable=False),  # success | failed
            sa.Column("started_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.String(32), nullable=False, server_default="system"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("operators_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("skipped_existing_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_base_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_bonus_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_weekly_accrual_runs_period", "weekly_accrual_runs", ["period_start", "period_end"])

    if not _table_exists("weekly_accrual_details"):
        op.create_table(
            "weekly_accrual_details",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("run_id", sa.Integer(), sa.ForeignKey("weekly_accrual_runs.id"), nullable=False, index=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False, index=True),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("contest_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("base_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bonus_top_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bonus_no_late_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bonus_no_violation_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bonus_nomination_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bonus_thanks_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("rank_place", sa.Integer(), nullable=True),
            sa.Column("previous_rank_place", sa.Integer(), nullable=True),
            sa.Column("rank_delta", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            # Защита от повторного начисления (ТЗ 3.4): один раз за период на оператора,
            # независимо от run_id — вне зависимости от того, кто и сколько раз запускал apply.
            sa.UniqueConstraint("operator_id", "period_start", "period_end", name="uq_weekly_accrual_detail_period"),
        )


def downgrade() -> None:
    if _table_exists("weekly_accrual_details"):
        op.drop_table("weekly_accrual_details")
    if _table_exists("weekly_accrual_runs"):
        op.drop_table("weekly_accrual_runs")
    for col in [
        "nomination_calls_enabled",
        "nomination_quality_enabled",
        "nomination_efficiency_enabled",
        "nomination_progress_enabled",
        "nomination_thanks_enabled",
    ]:
        if _column_exists("coin_rules", col):
            op.drop_column("coin_rules", col)
    if _column_exists("weekly_results", "thanks_count"):
        op.drop_column("weekly_results", "thanks_count")
