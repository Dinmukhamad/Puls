"""daily metrics (group_id, metric_date) index

Revision ID: 0043_daily_grid_index
Revises: 0042_mission_replay_audit
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0043_daily_grid_index"
down_revision = "0042_mission_replay_audit"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_daily_metrics_group_date"
TABLE = "operator_daily_metrics"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return
    existing = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX_NAME in existing:
        return
    op.create_index(INDEX_NAME, TABLE, ["group_id", "metric_date"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return
    existing = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX_NAME in existing:
        op.drop_index(INDEX_NAME, table_name=TABLE)
