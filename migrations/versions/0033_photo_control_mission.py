"""Extend missions with safe state and idempotent actions.

Revision ID: 0033_photo_control_mission
Revises: 0032_missions
Create Date: 2026-07-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033_photo_control_mission"
down_revision = "0032_missions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mission_attempts",
        sa.Column("state_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "mission_events",
        sa.Column("idempotency_key", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "uq_mission_events_idempotency_key",
        "mission_events",
        ["idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_mission_events_idempotency_key", table_name="mission_events")
    op.drop_column("mission_events", "idempotency_key")
    op.drop_column("mission_attempts", "state_json")
