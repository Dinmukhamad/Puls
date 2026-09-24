"""Daily operator metrics for day and month analytics."""

import sqlalchemy as sa

from alembic import op

revision = "20260925_day_metrics"
down_revision = "20260924_user_guide"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "operator_day_metrics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("metric_code", sa.String(64), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "day", "metric_code", name="uq_day_user_metric"),
    )
    op.create_index("ix_operator_day_metrics_user_id", "operator_day_metrics", ["user_id"])
    op.create_index("ix_operator_day_metrics_day", "operator_day_metrics", ["day"])
    op.create_index("ix_operator_day_metrics_metric_code", "operator_day_metrics", ["metric_code"])
    op.create_index("ix_operator_day_metrics_created_at", "operator_day_metrics", ["created_at"])


def downgrade():
    op.drop_table("operator_day_metrics")
