"""Training fleet cabinet «Диспетчерская»: each operator's accepted actions."""

from alembic import op
import sqlalchemy as sa

revision = "20260930_dispatch_training"
down_revision = "20260929_city_controls"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "dispatch_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("solved", sa.String(40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_id", name="uq_dispatch_events_user_id"),
    )
    op.create_index("ix_dispatch_events_user_id", "dispatch_events", ["user_id"])


def downgrade():
    op.drop_index("ix_dispatch_events_user_id", table_name="dispatch_events")
    op.drop_table("dispatch_events")
