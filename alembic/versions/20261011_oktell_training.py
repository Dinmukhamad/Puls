"""Persist isolated training Oktell actions and verified exercise completion."""

import sqlalchemy as sa

from alembic import op

revision = "20261011_oktell_training"
down_revision = "20261009_supervisor_teams"
branch_labels = depends_on = None


def upgrade() -> None:
    op.create_table(
        "oktell_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("completed", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_id", name="uq_oktell_events_user_id"),
    )
    op.create_index("ix_oktell_events_user_id", "oktell_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_oktell_events_user_id", table_name="oktell_events")
    op.drop_table("oktell_events")
