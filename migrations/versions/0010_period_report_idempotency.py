"""Make period reports idempotent.

Revision ID: 0010_period_report_idempotency
Revises: 0009_uploaded_files
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_period_report_idempotency"
down_revision = "0009_uploaded_files"
branch_labels = None
depends_on = None


CONSTRAINT_NAME = "uq_period_reports_operator_period"


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _constraint_exists(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(c.get("name") == name for c in inspector.get_unique_constraints(table))


def upgrade() -> None:
    if not _table_exists("period_reports"):
        return

    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute(
            """
            DELETE FROM period_reports older
            USING period_reports newer
            WHERE older.operator_id = newer.operator_id
              AND older.period_start = newer.period_start
              AND older.period_end = newer.period_end
              AND (
                    older.created_at < newer.created_at
                 OR (older.created_at = newer.created_at AND older.id < newer.id)
              )
            """
        )
    else:
        op.execute(
            """
            DELETE FROM period_reports
            WHERE id NOT IN (
                SELECT MAX(id)
                FROM period_reports
                GROUP BY operator_id, period_start, period_end
            )
            """
        )

    if not _constraint_exists("period_reports", CONSTRAINT_NAME):
        if dialect == "sqlite":
            with op.batch_alter_table("period_reports") as batch_op:
                batch_op.create_unique_constraint(
                    CONSTRAINT_NAME,
                    ["operator_id", "period_start", "period_end"],
                )
        else:
            op.create_unique_constraint(
                CONSTRAINT_NAME,
                "period_reports",
                ["operator_id", "period_start", "period_end"],
            )


def downgrade() -> None:
    if not _table_exists("period_reports"):
        return

    dialect = op.get_bind().dialect.name
    if _constraint_exists("period_reports", CONSTRAINT_NAME):
        if dialect == "sqlite":
            with op.batch_alter_table("period_reports") as batch_op:
                batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
        else:
            op.drop_constraint(CONSTRAINT_NAME, "period_reports", type_="unique")
