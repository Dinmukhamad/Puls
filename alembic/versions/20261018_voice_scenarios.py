"""Voice call scenarios written by staff in the scenario editor."""

import sqlalchemy as sa
from alembic import op

revision = "20261018_voice_scenarios"
down_revision = "20261017_voice_training"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "voice_scenarios",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("draft_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("published", sa.JSON(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("published_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("active", "created_at"):
        op.create_index(f"ix_voice_scenarios_{column}", "voice_scenarios", [column])


def downgrade():
    op.drop_table("voice_scenarios")
