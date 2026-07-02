"""Add work_norms table and operator rate field.

Revision ID: 0017_work_norms
Revises: 0016_fix_admin_pwd
Create Date: 2026-07-01
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0017_work_norms"
down_revision = "0016_fix_admin_pwd"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Таблица норм часов
    if not _table_exists("work_norms"):
        op.create_table(
            "work_norms",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False),
            sa.Column("month_days", sa.Integer(), nullable=False),
            # Numeric(3,2) вместо Float — точное хранение 0.5/0.75/1.0
            sa.Column("rate", sa.Numeric(3, 2), nullable=False),
            sa.Column("monthly_norm_hours", sa.Numeric(8, 2), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("year", "month", "rate", name="uq_work_norms_year_month_rate"),
        )
        op.create_index("ix_work_norms_year_month", "work_norms", ["year", "month"])

    # 2. Поле ставки у оператора (Numeric для точности)
    if not _column_exists("operators", "rate"):
        op.add_column(
            "operators",
            sa.Column("rate", sa.Numeric(3, 2), nullable=True),
        )

    # 3. Seed базовых норм — безопасный INSERT без ON CONFLICT
    # Используем WHERE NOT EXISTS чтобы не дублировать
    seed_rows = [
        (2026, 6, 30, "0.5",  84.0),
        (2026, 6, 30, "0.75", 126.0),
        (2026, 6, 30, "1.0",  168.0),
        (2026, 7, 31, "0.5",  88.0),
        (2026, 7, 31, "0.75", 132.0),
        (2026, 7, 31, "1.0",  172.0),
    ]
    for year, month, days, rate, hours in seed_rows:
        conn.execute(sa.text("""
            INSERT INTO work_norms (year, month, month_days, rate, monthly_norm_hours, is_active)
            SELECT :y, :m, :d, :r, :h, true
            WHERE NOT EXISTS (
                SELECT 1 FROM work_norms WHERE year=:y AND month=:m AND rate=:r
            )
        """), {"y": year, "m": month, "d": days, "r": rate, "h": hours})


def downgrade() -> None:
    if _column_exists("operators", "rate"):
        op.drop_column("operators", "rate")
    if _table_exists("work_norms"):
        op.drop_index("ix_work_norms_year_month", "work_norms")
        op.drop_table("work_norms")
"""Add work_norms table and operator rate field.

Revision ID: 0017_work_norms
Revises: 0016_fix_admin_pwd
Create Date: 2026-07-01
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0017_work_norms"
down_revision = "0016_fix_admin_pwd"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Таблица норм часов
    if not _table_exists("work_norms"):
        op.create_table(
            "work_norms",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False),
            sa.Column("month_days", sa.Integer(), nullable=False),
            # Numeric(3,2) вместо Float — точное хранение 0.5/0.75/1.0
            sa.Column("rate", sa.Numeric(3, 2), nullable=False),
            sa.Column("monthly_norm_hours", sa.Numeric(8, 2), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("year", "month", "rate", name="uq_work_norms_year_month_rate"),
        )
        op.create_index("ix_work_norms_year_month", "work_norms", ["year", "month"])

    # 2. Поле ставки у оператора (Numeric для точности)
    if not _column_exists("operators", "rate"):
        op.add_column(
            "operators",
            sa.Column("rate", sa.Numeric(3, 2), nullable=True),
        )

    # 3. Seed базовых норм — безопасный INSERT без ON CONFLICT
    # Используем WHERE NOT EXISTS чтобы не дублировать
    seed_rows = [
        (2026, 6, 30, "0.5",  84.0),
        (2026, 6, 30, "0.75", 126.0),
        (2026, 6, 30, "1.0",  168.0),
        (2026, 7, 31, "0.5",  88.0),
        (2026, 7, 31, "0.75", 132.0),
        (2026, 7, 31, "1.0",  172.0),
    ]
    for year, month, days, rate, hours in seed_rows:
        conn.execute(sa.text("""
            INSERT INTO work_norms (year, month, month_days, rate, monthly_norm_hours, is_active)
            SELECT :y, :m, :d, :r, :h, true
            WHERE NOT EXISTS (
                SELECT 1 FROM work_norms WHERE year=:y AND month=:m AND rate=:r
            )
        """), {"y": year, "m": month, "d": days, "r": rate, "h": hours})


def downgrade() -> None:
    if _column_exists("operators", "rate"):
        op.drop_column("operators", "rate")
    if _table_exists("work_norms"):
        op.drop_index("ix_work_norms_year_month", "work_norms")
        op.drop_table("work_norms")
