"""0004 add groups table and operator participation fields

Revision ID: 0004
Revises: 0003_align_pulse_schema
Create Date: 2026-06-29

- Creates groups table
- Adds participation_status to operators
- Adds group_id FK to operators
- Migrates existing group_name data to groups table
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003_align_pulse_schema"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _column_exists(table: str, col: str) -> bool:
    return any(c["name"] == col for c in sa.inspect(op.get_bind()).get_columns(table))


def upgrade() -> None:
    # 1. Create groups table
    if not _table_exists("groups"):
        op.create_table(
            "groups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False, unique=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_groups_name", "groups", ["name"])

    # 2. Migrate existing group_name values into groups table
    conn = op.get_bind()
    if _table_exists("operators") and _table_exists("groups"):
        existing_names = {
            row[0] for row in conn.execute(sa.text("SELECT name FROM groups"))
        }
        group_names = {
            row[0] for row in conn.execute(
                sa.text("SELECT DISTINCT group_name FROM operators WHERE group_name IS NOT NULL AND group_name != ''")
            )
        }
        from datetime import datetime
        now = datetime.utcnow()
        for name in sorted(group_names):
            if name not in existing_names:
                conn.execute(
                    sa.text("INSERT INTO groups (name, status, created_at, updated_at) VALUES (:n, 'active', :t, :t)"),
                    {"n": name, "t": now}
                )

    # 3. Add group_id to operators
    if _table_exists("operators") and not _column_exists("operators", "group_id"):
        op.add_column("operators", sa.Column("group_id", sa.Integer(), nullable=True))
        # Populate group_id from group_name
        conn.execute(sa.text(
            "UPDATE operators o SET group_id = (SELECT g.id FROM groups g WHERE g.name = o.group_name LIMIT 1) "
            "WHERE o.group_name IS NOT NULL AND o.group_name != ''"
        ))

    # 4. Add participation_status to operators
    if _table_exists("operators") and not _column_exists("operators", "participation_status"):
        op.add_column("operators", sa.Column(
            "participation_status", sa.String(32), nullable=False, server_default="participating"
        ))
        # Migrate: active → participating, inactive/archive → not_participating
        conn.execute(sa.text(
            "UPDATE operators SET participation_status = CASE "
            "  WHEN status = 'active' THEN 'participating' "
            "  ELSE 'not_participating' END"
        ))


def downgrade() -> None:
    pass
