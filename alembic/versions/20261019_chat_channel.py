"""Operators work on the line or in chats, each channel with its own metrics (docs/CHANNELS.md).

The users get a channel (everyone stays on the line), the metrics get a channel and optional
thresholds; the discipline metrics become common to both channels, and the chat quality is added.
"""

import json

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261019_chat_channel"
down_revision = "20261019_voice_ai_usage"
branch_labels = depends_on = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

CHAT_QUALITY = {
    "code": "chat_quality",
    "title": "Качество чатов",
    "unit": "%",
    "kind": "positive",
    "direction": "higher_is_better",
    "target_value": 97.0,
    "max_points": 100.0,
    "penalty_per_unit": 0.0,
    "allow_overachievement": False,
    "is_active": True,
    "sort_order": 15,
    "channel": "chat",
    "bands": json.dumps([
        {"from": 80, "points": 20}, {"from": 86, "points": 40}, {"from": 90, "points": 60},
        {"from": 94, "points": 80}, {"from": 97, "points": 100},
    ]),
    "description": "Пороги из KPI чатов (80–85 % — 5, 86–89 % — 10, 90–93 % — 15, 94–96 % — 20, "
    "97–100 % — 25 баллов), приведены к шкале 100, как у линии: ×4.",
}


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("channel", sa.String(16), nullable=False, server_default="line"))
        batch.create_index("ix_users_channel", ["channel"])
    with op.batch_alter_table("metric_definitions") as batch:
        batch.add_column(sa.Column("channel", sa.String(16), nullable=False, server_default="line"))
        batch.add_column(sa.Column("bands", JSON_TYPE, nullable=True))
        batch.create_index("ix_metric_definitions_channel", ["channel"])

    bind = op.get_bind()
    # Lateness and foreign sites are the discipline of every operator, whatever the channel.
    bind.execute(sa.text("UPDATE metric_definitions SET channel = 'all' WHERE kind = 'anti'"))
    exists = bind.execute(
        sa.text("SELECT 1 FROM metric_definitions WHERE code = :code"), {"code": "chat_quality"}
    ).first()
    if exists is None:
        cast = "CAST(:bands AS JSONB)" if bind.dialect.name == "postgresql" else ":bands"
        bind.execute(
            sa.text(
                "INSERT INTO metric_definitions (code, title, unit, kind, direction, target_value, "
                "max_points, penalty_per_unit, allow_overachievement, is_active, sort_order, "
                "channel, bands, description, created_at, updated_at) "
                "VALUES (:code, :title, :unit, :kind, :direction, :target_value, :max_points, "
                ":penalty_per_unit, "
                ":allow_overachievement, :is_active, :sort_order, :channel, "
                f"{cast}, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            CHAT_QUALITY,
        )


def downgrade():
    op.execute(sa.text("DELETE FROM metric_definitions WHERE code = 'chat_quality'"))
    with op.batch_alter_table("metric_definitions") as batch:
        batch.drop_index("ix_metric_definitions_channel")
        batch.drop_column("bands")
        batch.drop_column("channel")
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_channel")
        batch.drop_column("channel")
