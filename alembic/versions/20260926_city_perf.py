"""City performance reports from the 3D city (city v3 TZ §10)."""

import sqlalchemy as sa

from alembic import op

revision = "20260926_city_perf"
down_revision = "20260925_day_metrics"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_perf_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("backend", sa.String(16), nullable=False),
        sa.Column("gpu", sa.String(128), nullable=False, server_default=""),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("dpr", sa.Float(), nullable=False),
        sa.Column("tier", sa.String(16), nullable=False),
        sa.Column("fps_avg", sa.Float(), nullable=False),
        sa.Column("fps_p1", sa.Float(), nullable=False),
        sa.Column("first_frame_ms", sa.Integer(), nullable=True),
        sa.Column("concessions", sa.JSON(), nullable=False),
    )
    op.create_index("ix_city_perf_reports_user_id", "city_perf_reports", ["user_id"])
    op.create_index("ix_city_perf_reports_created_at", "city_perf_reports", ["created_at"])


def downgrade():
    op.drop_table("city_perf_reports")
