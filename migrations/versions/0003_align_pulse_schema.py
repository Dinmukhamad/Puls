"""0003 align pulse schema

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-28

Aligns ORM models, routes and DB schema:
- Add users.can_manage_operators if missing
- Ensure audit_logs uses correct column names
- Rename operators columns to match ORM (start_date, comment)
- Drop operator_audit_logs if exists (replaced by audit_logs)
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(c["name"] == column for c in inspector.get_columns(table))


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table in inspector.get_table_names()


def upgrade() -> None:
    # 1. users.can_manage_operators
    if _table_exists("users") and not _column_exists("users", "can_manage_operators"):
        op.add_column("users", sa.Column("can_manage_operators", sa.Boolean(), nullable=False, server_default="false"))

    # 2. Ensure audit_logs has all needed columns
    if _table_exists("audit_logs"):
        for col_name, col_type in [
            ("entity_type",          sa.String(50)),
            ("entity_id",            sa.Integer()),
            ("operator_id",          sa.Integer()),
            ("details",              sa.Text()),
            ("comment",              sa.Text()),
            ("performed_by_user_id", sa.Integer()),
            ("actor_user_id",        sa.Integer()),
        ]:
            if not _column_exists("audit_logs", col_name):
                op.add_column("audit_logs", sa.Column(col_name, col_type, nullable=True))
    else:
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("action", sa.String(100), nullable=False, index=True),
            sa.Column("entity_type", sa.String(50), nullable=True),
            sa.Column("entity_id", sa.Integer(), nullable=True),
            sa.Column("operator_id", sa.Integer(), nullable=True),
            sa.Column("details", sa.Text(), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("performed_by_user_id", sa.Integer(), nullable=True),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    # 3. operators: rename participation_started_at → start_date if needed
    if _table_exists("operators"):
        if _column_exists("operators", "participation_started_at") and not _column_exists("operators", "start_date"):
            op.alter_column("operators", "participation_started_at", new_column_name="start_date")
        elif not _column_exists("operators", "start_date"):
            op.add_column("operators", sa.Column("start_date", sa.Date(), nullable=True))

        # operators: rename admin_comment → comment if needed
        if _column_exists("operators", "admin_comment") and not _column_exists("operators", "comment"):
            op.alter_column("operators", "admin_comment", new_column_name="comment")
        elif not _column_exists("operators", "comment"):
            op.add_column("operators", sa.Column("comment", sa.Text(), nullable=True))

        # Ensure other new columns exist
        for col_name, col_type in [
            ("status",             sa.String(32)),
            ("position",           sa.String(200)),
            ("employee_id",        sa.String(100)),
            ("email",              sa.String(200)),
            ("created_by_user_id", sa.Integer()),
        ]:
            if not _column_exists("operators", col_name):
                default = "active" if col_name == "status" else None
                if default:
                    op.add_column("operators", sa.Column(col_name, col_type, nullable=False, server_default=default))
                else:
                    op.add_column("operators", sa.Column(col_name, col_type, nullable=True))


def downgrade() -> None:
    # Non-destructive migration — downgrade is a no-op
    pass
