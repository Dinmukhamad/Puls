"""What each call to the AI model of the voice trainer cost, for the monthly budget."""

import sqlalchemy as sa
from alembic import op

revision = "20261019_voice_ai_usage"
down_revision = "20261018_voice_scenarios"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "voice_ai_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("model", sa.String(60), nullable=False),
        sa.Column(
            "attempt_id", sa.Integer(), sa.ForeignKey("voice_training_attempts.id"), nullable=True
        ),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("attempt_id", "created_at"):
        op.create_index(f"ix_voice_ai_usage_{column}", "voice_ai_usage", [column])


def downgrade():
    op.drop_table("voice_ai_usage")
