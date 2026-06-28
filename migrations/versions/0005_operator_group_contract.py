"""Align operator group and participation contract.

Revision ID: 0005_operator_group_contract
Revises: 0004
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_operator_group_contract"
down_revision = "0004"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _column_exists(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def _index_exists(table: str, index: str) -> bool:
    return any(i["name"] == index for i in sa.inspect(op.get_bind()).get_indexes(table))


def upgrade() -> None:
    conn = op.get_bind()

    if _table_exists("operators") and _column_exists("operators", "group_id"):
        if not _index_exists("operators", "ix_operators_group_id"):
            op.create_index("ix_operators_group_id", "operators", ["group_id"])

        if _table_exists("groups") and _column_exists("operators", "group_name"):
            conn.execute(sa.text(
                "UPDATE operators "
                "SET group_id = (SELECT groups.id FROM groups WHERE groups.name = operators.group_name LIMIT 1) "
                "WHERE group_id IS NULL AND group_name IS NOT NULL AND group_name != ''"
            ))

    if _table_exists("operators") and _column_exists("operators", "participation_status"):
        conn.execute(sa.text(
            "UPDATE operators SET participation_status = CASE "
            "WHEN status = 'active' THEN 'participating' "
            "ELSE 'not_participating' END "
            "WHERE participation_status IS NULL "
            "OR participation_status NOT IN ('participating', 'not_participating')"
        ))

    if _table_exists("operators") and _column_exists("operators", "position"):
        conn.execute(sa.text(
            "UPDATE operators SET position = 'operator' "
            "WHERE position IS NULL OR position NOT IN ('operator', 'chat_manager')"
        ))


def downgrade() -> None:
    pass
