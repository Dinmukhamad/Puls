"""Fix must_change_password for admin and manager users.

Admin/manager/supervisor не должны быть обязаны менять пароль.

Revision ID: 0016_fix_admin_pwd
Revises: 0015_user_role_management
Create Date: 2026-07-01
"""
from __future__ import annotations

from alembic import op


revision = "0016_fix_admin_pwd"
down_revision = "0015_user_role_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Сбрасываем must_change_password для admin/manager/supervisor
    op.execute(
        "UPDATE users SET must_change_password = FALSE "
        "WHERE role IN ('admin', 'manager', 'supervisor') "
        "AND must_change_password = TRUE"
    )


def downgrade() -> None:
    pass
