"""SZoV reports are kept by day (docs/SZOV_REPORTS.md): a week that crosses two months is built
from both monthly reports, and a month exported before its end waits for the rest."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261020_report_facts"
down_revision = "20261020_violations"
branch_labels = depends_on = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _stamps():
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade():
    op.create_table(
        "report_day_facts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("data", JSON_TYPE, nullable=False),
        *_stamps(),
        sa.UniqueConstraint("user_id", "day", "kind", name="uq_report_day_fact"),
    )
    op.create_index("ix_report_day_facts_user_id", "report_day_facts", ["user_id"])
    op.create_index("ix_report_day_facts_day", "report_day_facts", ["day"])
    op.create_index("ix_report_day_facts_created_at", "report_day_facts", ["created_at"])
    op.create_table(
        "report_months",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("line_until", sa.Date(), nullable=True),
        sa.Column("chat_until", sa.Date(), nullable=True),
        sa.Column("quality", JSON_TYPE, nullable=False),
        *_stamps(),
        sa.UniqueConstraint("year", "month", name="uq_report_month"),
    )
    op.create_index("ix_report_months_created_at", "report_months", ["created_at"])


def downgrade():
    op.drop_index("ix_report_months_created_at", table_name="report_months")
    op.drop_table("report_months")
    op.drop_index("ix_report_day_facts_created_at", table_name="report_day_facts")
    op.drop_index("ix_report_day_facts_day", table_name="report_day_facts")
    op.drop_index("ix_report_day_facts_user_id", table_name="report_day_facts")
    op.drop_table("report_day_facts")
