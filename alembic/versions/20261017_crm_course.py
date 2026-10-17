"""Separate CRM tickets, comments and owned course screenshots."""

import sqlalchemy as sa
from alembic import op

revision = "20261017_crm_course"
down_revision = "20261017_city_levels_seen"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "crm_tickets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "appeal_id", sa.Integer(), sa.ForeignKey("crm_appeals.id"), nullable=False, unique=True
        ),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "crm_ticket_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("crm_tickets.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("ticket_id", "request_id"),
    )
    op.create_index("ix_crm_ticket_events_ticket_id", "crm_ticket_events", ["ticket_id"])
    op.create_table(
        "crm_course_captures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_key", sa.String(40), nullable=False),
        sa.Column("driver_id", sa.String(80), nullable=False),
        sa.Column("incoming_phone", sa.String(40), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "task_key"),
    )
    op.create_index("ix_crm_course_captures_user_id", "crm_course_captures", ["user_id"])
    op.create_table(
        "crm_ticket_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("crm_ticket_events.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("mime", sa.String(80), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_crm_ticket_attachments_event_id", "crm_ticket_attachments", ["event_id"])


def downgrade():
    op.drop_table("crm_ticket_attachments")
    op.drop_table("crm_course_captures")
    op.drop_table("crm_ticket_events")
    op.drop_table("crm_tickets")
