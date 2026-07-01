"""Fix must_change_password for admin and manager users.

Admin/manager пользователи не должны быть обязаны менять пароль —
это флаг для операторов с временными паролями.

Revision ID: 0016_fix_admin_must_change_password
Revises: 0015_user_role_management
Create Date: 2026-07-01
"""
from __future__ import annotations

from alembic import op


revision = "0016_fix_admin_must_change_password"
down_revision = "0015_user_role_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Сбрасываем must_change_password для всех кроме операторов —
    # только операторы получают временные пароли и должны их менять
    op.execute(
        "UPDATE users SET must_change_password = FALSE "
        "WHERE role IN ('admin', 'manager', 'supervisor') "
        "AND must_change_password = TRUE"
    )


def downgrade() -> None:
    pass  # необратимо — нет смысла восстанавливать
