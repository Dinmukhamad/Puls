"""Supervisors record the foreign sites they notice (docs/CHANNELS.md): each record is a row here,
and a week's count of them is the operator's «Посещение посторонних сайтов» for that week."""

import sqlalchemy as sa

from alembic import op

revision = "20261020_violations"
down_revision = "20261020_scoring_rules"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "violations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "week_id",
            sa.Integer(),
            sa.ForeignKey("contest_weeks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric_code", sa.String(64), nullable=False, server_default="forbidden_sites"),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("noticed_on", sa.Date(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancelled_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_violations_user_id", "violations", ["user_id"])
    op.create_index("ix_violations_week_id", "violations", ["week_id"])
    op.create_index("ix_violations_created_at", "violations", ["created_at"])


def downgrade():
    op.drop_index("ix_violations_created_at", table_name="violations")
    op.drop_index("ix_violations_week_id", table_name="violations")
    op.drop_index("ix_violations_user_id", table_name="violations")
    op.drop_table("violations")
