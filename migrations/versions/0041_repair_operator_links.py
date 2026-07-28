"""Repair reciprocal links between users and operators.

Revision ID: 0041_repair_operator_links
Revises: 0040_coin_transaction_categories
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

revision = "0041_repair_operator_links"
down_revision = "0040_coin_transaction_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    if not {"users", "operators"}.issubset(tables):
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    operator_columns = {column["name"] for column in inspector.get_columns("operators")}
    if "operator_id" not in user_columns or "user_id" not in operator_columns:
        return

    op.execute(
        """
        UPDATE users
        SET operator_id = (
            SELECT MIN(operators.id)
            FROM operators
            WHERE operators.user_id = users.id
        )
        WHERE operator_id IS NULL
          AND EXISTS (
              SELECT 1 FROM operators WHERE operators.user_id = users.id
          )
        """
    )
    op.execute(
        """
        UPDATE operators
        SET user_id = (
            SELECT MIN(users.id)
            FROM users
            WHERE users.operator_id = operators.id
        )
        WHERE user_id IS NULL
          AND EXISTS (
              SELECT 1 FROM users WHERE users.operator_id = operators.id
          )
        """
    )


def downgrade() -> None:
    # Data-repair migrations intentionally preserve valid restored links.
    pass
