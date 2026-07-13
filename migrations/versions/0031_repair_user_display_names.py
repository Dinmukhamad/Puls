"""Repair mojibake admin name and synchronize operator account names.

Revision ID: 0031_repair_user_display_names
Revises: 0030_shop_catalog
Create Date: 2026-07-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031_repair_user_display_names"
down_revision = "0030_shop_catalog"
branch_labels = None
depends_on = None

BROKEN_ADMIN_NAME = "РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ"


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE users SET full_name = :correct "
            "WHERE full_name = :broken"
        ),
        {"correct": "Администратор", "broken": BROKEN_ADMIN_NAME},
    )

    linked_names = list(connection.execute(
        sa.text(
            "SELECT users.id AS user_id, operators.full_name AS operator_name "
            "FROM users JOIN operators ON operators.id = users.operator_id "
            "WHERE users.role = 'operator'"
        )
    ).mappings())
    for row in linked_names:
        connection.execute(
            sa.text("UPDATE users SET full_name = :name WHERE id = :user_id"),
            {"name": row["operator_name"], "user_id": row["user_id"]},
        )


def downgrade() -> None:
    # Исправленные пользовательские данные намеренно не повреждаем повторно.
    pass
