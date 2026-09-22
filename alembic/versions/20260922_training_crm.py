"""Shared training CRM appeals, attachments and extensible categories."""

from alembic import op
import sqlalchemy as sa

revision = "20260922_training_crm"
down_revision = "20260916_trainer"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "crm_categories",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("parent_id", sa.String(64), nullable=True),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("hint", sa.Text(), nullable=False),
    )
    op.create_table(
        "crm_appeals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("channel", sa.String(12), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("license_number", sa.String(80), nullable=False),
        sa.Column("driver_id", sa.String(80), nullable=False),
        sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("park", sa.String(100), nullable=False),
        sa.Column("city", sa.String(100), nullable=False),
        sa.Column("category_ids", sa.JSON(), nullable=False),
        sa.Column("category_labels", sa.JSON(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("is_ticket", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("author_id", "request_id", name="uq_crm_appeals_author_id"),
    )
    for key in ("author_id", "phone", "park", "status", "created_at"):
        op.create_index(f"ix_crm_appeals_{key}", "crm_appeals", [key])
    op.create_table(
        "crm_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("appeal_id", sa.Integer(), sa.ForeignKey("crm_appeals.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("mime", sa.String(80), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_crm_attachments_appeal_id", "crm_attachments", ["appeal_id"])


def downgrade():
    op.drop_table("crm_attachments")
    op.drop_table("crm_appeals")
    op.drop_table("crm_categories")
