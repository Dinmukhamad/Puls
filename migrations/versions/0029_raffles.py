"""Розыгрыши за билеты Колеса WOW (ТЗ P2).

Модель:
- operators.raffle_tickets — накопленный пул билетов оператора (начисляется
  призом raffle_ticket из Колеса WOW). Билеты НЕ покупаются за коины.
- raffles — сам розыгрыш (заголовок, приз, число победителей, срок, статус).
- raffle_entries — участие оператора: сколько своих билетов он вложил в
  конкретный розыгрыш (списываются из пула при входе).
- raffle_winners — результат розыгрыша (несколько победителей).

Revision ID: 0029_raffles
Revises: 0028_notifications
Create Date: 2026-07-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029_raffles"
down_revision = "0028_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operators", sa.Column("raffle_tickets", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "raffles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("prize_coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prize_description", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("winners_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("drawn_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_raffles_status", "raffles", ["status"])
    op.create_index("ix_raffles_ends_at", "raffles", ["ends_at"])

    op.create_table(
        "raffle_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("raffle_id", sa.Integer(), sa.ForeignKey("raffles.id"), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
        sa.Column("tickets", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("raffle_id", "operator_id", name="uq_raffle_entry_operator"),
    )
    op.create_index("ix_raffle_entries_raffle_id", "raffle_entries", ["raffle_id"])
    op.create_index("ix_raffle_entries_operator_id", "raffle_entries", ["operator_id"])

    op.create_table(
        "raffle_winners",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("raffle_id", sa.Integer(), sa.ForeignKey("raffles.id"), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
        sa.Column("tickets_at_draw", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prize_coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_raffle_winners_raffle_id", "raffle_winners", ["raffle_id"])
    op.create_index("ix_raffle_winners_operator_id", "raffle_winners", ["operator_id"])


def downgrade() -> None:
    op.drop_index("ix_raffle_winners_operator_id", table_name="raffle_winners")
    op.drop_index("ix_raffle_winners_raffle_id", table_name="raffle_winners")
    op.drop_table("raffle_winners")
    op.drop_index("ix_raffle_entries_operator_id", table_name="raffle_entries")
    op.drop_index("ix_raffle_entries_raffle_id", table_name="raffle_entries")
    op.drop_table("raffle_entries")
    op.drop_index("ix_raffles_ends_at", table_name="raffles")
    op.drop_index("ix_raffles_status", table_name="raffles")
    op.drop_table("raffles")
    op.drop_column("operators", "raffle_tickets")
