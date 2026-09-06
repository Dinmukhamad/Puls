"""Удаление ступеней по накопленным коинам

Прогресс оператора считается по XP: таблица xp_levels и раздел «Уровни XP»
остаются, а параллельная лестница по коинам убирается вместе с данными.

Revision ID: a1c4d9e07b32
Revises: 20260905_games
Create Date: 2026-09-06

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c4d9e07b32"
down_revision: str | None = "20260905_games"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("level_definitions")


def downgrade() -> None:
    op.create_table(
        "level_definitions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("min_earned", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "min_earned >= 0", name=op.f("ck_level_definitions_min_earned_non_negative")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_level_definitions")),
    )
    with op.batch_alter_table("level_definitions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_level_definitions_code"), ["code"], unique=True)
        batch_op.create_index(
            batch_op.f("ix_level_definitions_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_level_definitions_is_active"), ["is_active"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_level_definitions_min_earned"), ["min_earned"], unique=False
        )
