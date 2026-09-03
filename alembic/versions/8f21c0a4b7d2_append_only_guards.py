"""Защита журналов коинов и аудита от UPDATE/DELETE

Revision ID: 8f21c0a4b7d2
Revises: 703ce5b883e8
Create Date: 2026-09-04

"""
from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

from app.db.guards import drop_guard_statements, guard_statements

revision: str = "8f21c0a4b7d2"
down_revision: str | None = "703ce5b883e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    for statement in guard_statements(bind.dialect.name):
        bind.execute(text(statement))


def downgrade() -> None:
    bind = op.get_bind()
    for statement in drop_guard_statements(bind.dialect.name):
        bind.execute(text(statement))
