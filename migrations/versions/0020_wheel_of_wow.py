"""Add Wheel of WOW: campaigns, prizes, tickets, spins + coin link.

Revision ID: 0020_wheel_of_wow
Revises: 0019_level_coin_repair
Create Date: 2026-07-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_wheel_of_wow"
down_revision = "0019_level_coin_repair"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _column_exists(table: str, column: str) -> bool:
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if not _table_exists("wheel_campaigns"):
        op.create_table(
            "wheel_campaigns",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("max_spins_per_day", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("max_spins_per_week", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("ticket_ttl_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_wheel_campaigns_is_active", "wheel_campaigns", ["is_active"])

    if not _table_exists("wheel_prizes"):
        op.create_table(
            "wheel_prizes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("prize_type", sa.String(32), nullable=False),
            sa.Column("amount", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("color", sa.String(16), nullable=False, server_default="#38BDF8"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("max_wins_total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_wins_per_operator", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_wheel_prizes_campaign_id", "wheel_prizes", ["campaign_id"])
        op.create_index("ix_wheel_prizes_is_active", "wheel_prizes", ["is_active"])

    if not _table_exists("wheel_tickets"):
        op.create_table(
            "wheel_tickets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=False),
            sa.Column("reason_type", sa.String(40), nullable=False, server_default="manual"),
            sa.Column("reason_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("source_type", sa.String(40), nullable=False, server_default="manual"),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="available"),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
        op.create_index("ix_wheel_tickets_operator_id", "wheel_tickets", ["operator_id"])
        op.create_index("ix_wheel_tickets_campaign_id", "wheel_tickets", ["campaign_id"])
        op.create_index("ix_wheel_tickets_status", "wheel_tickets", ["status"])
        op.create_index("ix_wheel_tickets_expires_at", "wheel_tickets", ["expires_at"])

    if not _table_exists("wheel_spins"):
        op.create_table(
            "wheel_spins",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("wheel_tickets.id"), nullable=False),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("wheel_campaigns.id"), nullable=False),
            sa.Column("prize_id", sa.Integer(), sa.ForeignKey("wheel_prizes.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="created"),
            sa.Column("result_payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_wheel_spins_operator_id", "wheel_spins", ["operator_id"])
        op.create_index("ix_wheel_spins_ticket_id", "wheel_spins", ["ticket_id"])
        op.create_index("ix_wheel_spins_campaign_id", "wheel_spins", ["campaign_id"])
        op.create_index("ix_wheel_spins_status", "wheel_spins", ["status"])
        op.create_index("ix_wheel_spins_created_at", "wheel_spins", ["created_at"])

    # Ссылка coin_transactions → wheel_spins (source_id из ТЗ п.8)
    if _table_exists("coin_transactions") and not _column_exists("coin_transactions", "related_spin_id"):
        op.add_column(
            "coin_transactions",
            sa.Column("related_spin_id", sa.Integer(), sa.ForeignKey("wheel_spins.id"), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("coin_transactions", "related_spin_id"):
        op.drop_column("coin_transactions", "related_spin_id")
    for table in ("wheel_spins", "wheel_tickets", "wheel_prizes", "wheel_campaigns"):
        if _table_exists(table):
            op.drop_table(table)
