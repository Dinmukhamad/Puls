"""Add first-login password change flag.

Revision ID: 0007_user_must_change_password
Revises: 0006_op_employment
Create Date: 2026-06-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0007_user_must_change_password"
down_revision = "0006_op_employment"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return table_name in inspect(op.get_bind()).get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return column_name in {col["name"] for col in inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    if not _table_exists("users"):
        return

    with op.batch_alter_table("users") as batch_op:
        if not _column_exists("users", "must_change_password"):
            batch_op.add_column(sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ))

    op.execute("UPDATE users SET must_change_password = false WHERE must_change_password IS NULL")


def downgrade() -> None:
    if not _table_exists("users") or not _column_exists("users", "must_change_password"):
        return

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("must_change_password")
