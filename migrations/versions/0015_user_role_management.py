"""Add user role management fields.

Revision ID: 0015_user_role_management
Revises: 0014_operator_levels
Create Date: 2026-07-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0015_user_role_management"
down_revision = "0014_operator_levels"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    return column in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}


def _index_exists(table: str, index: str) -> bool:
    return index in {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        if not _column_exists("users", "group_id"):
            batch_op.add_column(sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id"), nullable=True))
        if not _column_exists("users", "email"):
            batch_op.add_column(sa.Column("email", sa.String(200), nullable=True))
        if not _column_exists("users", "phone"):
            batch_op.add_column(sa.Column("phone", sa.String(80), nullable=True))
        if not _column_exists("users", "status"):
            batch_op.add_column(sa.Column("status", sa.String(32), nullable=False, server_default="active"))

    if not _index_exists("users", "ix_users_group_id"):
        op.create_index("ix_users_group_id", "users", ["group_id"])
    if not _index_exists("users", "ix_users_status"):
        op.create_index("ix_users_status", "users", ["status"])

    op.execute("UPDATE users SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END WHERE status IS NULL OR status = ''")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        if _index_exists("users", "ix_users_status"):
            batch_op.drop_index("ix_users_status")
        if _index_exists("users", "ix_users_group_id"):
            batch_op.drop_index("ix_users_group_id")
        for column in ("status", "phone", "email", "group_id"):
            if _column_exists("users", column):
                batch_op.drop_column(column)
