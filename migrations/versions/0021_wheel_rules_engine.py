"""Wheel of WOW rules engine: eligibility rules, evaluation logs, daily state,
settings, manual grants + extra columns on campaigns/prizes/tickets.

Revision ID: 0021_wheel_rules_engine
Revises: 0020_wheel_of_wow
Create Date: 2026-07-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_wheel_rules_engine"
down_revision = "0020_wheel_of_wow"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def _index_exists(table: str, name: str) -> bool:
    if not _table_exists(table):
        return False
    return name in {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_col(table: str, column: sa.Column) -> None:
    if _table_exists(table) and not _column_exists(table, column.name):
        op.add_column(table, column)


def upgrade() -> None:
    # ── Доп. колонки существующих таблиц ─────────────────────────────────────
    _add_col("wheel_campaigns", sa.Column("campaign_type", sa.String(32), nullable=False, server_default="daily"))

    for col in (
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("daily_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weekly_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("monthly_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("per_operator_daily_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("per_operator_weekly_limit", sa.Integer(), nullable=False, server_default="0"),
    ):
        _add_col("wheel_prizes", col)

    for col in (
        sa.Column("rule_id", sa.Integer(), nullable=True),
        sa.Column("source_module", sa.String(40), nullable=True),
        sa.Column("source_entity_id", sa.Integer(), nullable=True),
        sa.Column("source_period_start", sa.Date(), nullable=True),
        sa.Column("source_period_end", sa.Date(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
    ):
        _add_col("wheel_tickets", col)

    # ── Новые таблицы движка правил ──────────────────────────────────────────
    if not _table_exists("wheel_eligibility_rules"):
        op.create_table(
            "wheel_eligibility_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=False),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("source_module", sa.String(40), nullable=False),
            sa.Column("rule_type", sa.String(48), nullable=False),
            sa.Column("metric_key", sa.String(64), nullable=False, server_default=""),
            sa.Column("operator", sa.String(12), nullable=False, server_default="gte"),
            sa.Column("threshold_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("threshold_value_max", sa.Float(), nullable=True),
            sa.Column("period_type", sa.String(16), nullable=False, server_default="daily"),
            sa.Column("max_tokens_per_period", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("token_ttl_hours", sa.Integer(), nullable=False, server_default="24"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_wheel_rules_campaign", "wheel_eligibility_rules", ["campaign_id"])
        op.create_index("ix_wheel_rules_code", "wheel_eligibility_rules", ["code"])
        op.create_index("ix_wheel_rules_source", "wheel_eligibility_rules", ["source_module"])
        op.create_index("ix_wheel_rules_active", "wheel_eligibility_rules", ["is_active"])

    if not _table_exists("wheel_rule_evaluation_logs"):
        op.create_table(
            "wheel_rule_evaluation_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("wheel_eligibility_rules.id"), nullable=True),
            sa.Column("source_module", sa.String(40), nullable=False, server_default=""),
            sa.Column("source_entity_id", sa.Integer(), nullable=True),
            sa.Column("period_start", sa.Date(), nullable=True),
            sa.Column("period_end", sa.Date(), nullable=True),
            sa.Column("metric_value", sa.Float(), nullable=True),
            sa.Column("operator", sa.String(12), nullable=False, server_default=""),
            sa.Column("threshold_value", sa.Float(), nullable=True),
            sa.Column("is_eligible", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("reason", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_token_id", sa.Integer(), sa.ForeignKey("wheel_tickets.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_wheel_evallog_operator", "wheel_rule_evaluation_logs", ["operator_id"])
        op.create_index("ix_wheel_evallog_rule", "wheel_rule_evaluation_logs", ["rule_id"])
        op.create_index("ix_wheel_evallog_eligible", "wheel_rule_evaluation_logs", ["is_eligible"])
        op.create_index("ix_wheel_evallog_created", "wheel_rule_evaluation_logs", ["created_at"])

    if not _table_exists("wheel_operator_daily_state"):
        op.create_table(
            "wheel_operator_daily_state",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("active_tokens_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("used_tokens_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("expired_tokens_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_spin_at", sa.DateTime(), nullable=True),
            sa.Column("last_prize_title", sa.String(200), nullable=True),
            sa.Column("last_prize_type", sa.String(32), nullable=True),
            sa.Column("last_prize_value", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("operator_id", "date", name="uq_wheel_daily_state_operator_date"),
        )
        op.create_index("ix_wheel_daily_operator", "wheel_operator_daily_state", ["operator_id"])
        op.create_index("ix_wheel_daily_date", "wheel_operator_daily_state", ["date"])

    if not _table_exists("wheel_settings"):
        op.create_table(
            "wheel_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("key", sa.String(64), nullable=False),
            sa.Column("value", sa.Text(), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("key", name="uq_wheel_settings_key"),
        )
        op.create_index("ix_wheel_settings_key", "wheel_settings", ["key"])

    if not _table_exists("wheel_manual_grants"):
        op.create_table(
            "wheel_manual_grants",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=False),
            sa.Column("granted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("tokens_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("reason", sa.String(200), nullable=False, server_default=""),
            sa.Column("comment", sa.Text(), nullable=False, server_default=""),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_wheel_grants_operator", "wheel_manual_grants", ["operator_id"])

    # ── Индексы для новых колонок токенов + уникальный индекс против дублей ──
    if _table_exists("wheel_tickets"):
        if _column_exists("wheel_tickets", "rule_id") and not _index_exists("wheel_tickets", "ix_wheel_tickets_rule_id"):
            op.create_index("ix_wheel_tickets_rule_id", "wheel_tickets", ["rule_id"])
        if not _index_exists("wheel_tickets", "uq_wheel_token_source"):
            op.create_index(
                "uq_wheel_token_source", "wheel_tickets",
                ["operator_id", "campaign_id", "rule_id", "source_module", "source_entity_id"],
                unique=True,
            )


def downgrade() -> None:
    for name in ("uq_wheel_token_source", "ix_wheel_tickets_rule_id"):
        if _index_exists("wheel_tickets", name):
            op.drop_index(name, table_name="wheel_tickets")

    for table in ("wheel_manual_grants", "wheel_settings", "wheel_operator_daily_state",
                  "wheel_rule_evaluation_logs", "wheel_eligibility_rules"):
        if _table_exists(table):
            op.drop_table(table)

    for col in ("cancel_reason", "cancelled_at", "source_period_end", "source_period_start",
                "source_entity_id", "source_module", "rule_id"):
        if _column_exists("wheel_tickets", col):
            op.drop_column("wheel_tickets", col)
    for col in ("per_operator_weekly_limit", "per_operator_daily_limit", "monthly_limit",
                "weekly_limit", "daily_limit", "description"):
        if _column_exists("wheel_prizes", col):
            op.drop_column("wheel_prizes", col)
    if _column_exists("wheel_campaigns", "campaign_type"):
        op.drop_column("wheel_campaigns", "campaign_type")
