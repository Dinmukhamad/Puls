"""Operator employment status and group actions.

Revision ID: 0006_operator_employment_and_group_actions
Revises: 0005_operator_group_contract
Create Date: 2026-06-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0006_operator_employment_and_group_actions"
down_revision = "0005_operator_group_contract"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return table_name in inspect(op.get_bind()).get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return column_name in {col["name"] for col in inspect(op.get_bind()).get_columns(table_name)}


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return index_name in {idx["name"] for idx in inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    if not _table_exists("operators"):
        return

    with op.batch_alter_table("operators") as batch_op:
        if not _column_exists("operators", "employment_status"):
            batch_op.add_column(sa.Column("employment_status", sa.String(length=32), nullable=False, server_default="active"))
        if not _column_exists("operators", "dismissed_at"):
            batch_op.add_column(sa.Column("dismissed_at", sa.DateTime(), nullable=True))
        if not _column_exists("operators", "updated_at"):
            batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))

    if not _index_exists("operators", "ix_operators_employment_status"):
        op.create_index("ix_operators_employment_status", "operators", ["employment_status"])

    op.execute(
        "UPDATE operators SET employment_status = 'active' "
        "WHERE employment_status IS NULL OR employment_status NOT IN ('active', 'dismissed')"
    )
    op.execute(
        "UPDATE operators SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP) "
        "WHERE employment_status = 'dismissed' AND dismissed_at IS NULL"
    )
    op.execute(
        "UPDATE operators SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)"
    )
    op.execute(
        "UPDATE operators SET is_active = CASE "
        "WHEN employment_status = 'active' AND participation_status = 'participating' THEN true "
        "ELSE false END"
    )
    op.execute(
        "UPDATE operators SET status = CASE "
        "WHEN employment_status = 'dismissed' THEN 'dismissed' "
        "WHEN is_active = true THEN 'active' "
        "ELSE 'inactive' END"
    )


def downgrade() -> None:
    if not _table_exists("operators"):
        return
    if _index_exists("operators", "ix_operators_employment_status"):
        op.drop_index("ix_operators_employment_status", table_name="operators")
    with op.batch_alter_table("operators") as batch_op:
        if _column_exists("operators", "updated_at"):
            batch_op.drop_column("updated_at")
        if _column_exists("operators", "dismissed_at"):
            batch_op.drop_column("dismissed_at")
        if _column_exists("operators", "employment_status"):
            batch_op.drop_column("employment_status")
