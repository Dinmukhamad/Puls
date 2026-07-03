"""Mark level coin reward schema repair as handled by startup maintenance.

Revision ID: 0019_repair_level_coin_reward_schema
Revises: 0018_level_coin_rewards
Create Date: 2026-07-03
"""
from __future__ import annotations


revision = "0019_repair_level_coin_reward_schema"
down_revision = "0018_level_coin_rewards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The live Railway database was already stamped past 0018 on one deploy
    # while some columns were still missing. The idempotent repair runs in
    # app.services.schema_maintenance.ensure_operator_management_schema()
    # during application startup, where it can safely inspect the real schema.
    pass


def downgrade() -> None:
    pass
