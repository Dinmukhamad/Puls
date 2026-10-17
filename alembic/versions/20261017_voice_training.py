"""Versioned voice dialogue, observations, feedback and internal review requests."""

import sqlalchemy as sa
from alembic import op

revision = "20261017_voice_training"
down_revision = "20261017_site_tour"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "voice_training_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scenario_key", sa.String(40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("persona", sa.String(20), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("turn", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=False),
        sa.Column("practice", sa.JSON(), nullable=False),
        sa.Column("requests", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("review", sa.JSON(), nullable=True),
        sa.Column(
            "retry_of", sa.Integer(), sa.ForeignKey("voice_training_attempts.id"), nullable=True
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("user_id", "scenario_key", "state", "created_at"):
        op.create_index(f"ix_voice_training_attempts_{column}", "voice_training_attempts", [column])


def downgrade():
    op.drop_table("voice_training_attempts")
