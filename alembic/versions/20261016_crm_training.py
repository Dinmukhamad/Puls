"""Durable ordinary CRM tasks, private drafts and revisioned own corrections."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_crm_training"
down_revision = "20261015_coin_economy"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("crm_appeals") as batch:
        batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("training_task", sa.String(40), nullable=True))
        batch.add_column(sa.Column("last_edit_request_id", sa.String(36), nullable=True))
    op.create_table(
        "crm_training_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_key", sa.String(40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("phase", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("appeal_id", sa.Integer(), sa.ForeignKey("crm_appeals.id"), nullable=True),
        sa.Column("checks", sa.JSON(), nullable=False),
        sa.UniqueConstraint("user_id", "task_key"),
        sa.UniqueConstraint("appeal_id"),
    )
    op.create_index("ix_crm_training_attempts_user_id", "crm_training_attempts", ["user_id"])
    op.create_table(
        "crm_training_checks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("task_key", sa.String(40), nullable=False),
        sa.Column("appeal_id", sa.Integer(), sa.ForeignKey("crm_appeals.id"), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_id"),
    )
    op.create_index("ix_crm_training_checks_user_id", "crm_training_checks", ["user_id"])
    op.create_table(
        "crm_drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scope", sa.String(40), nullable=False),
        sa.Column("draft_key", sa.String(36), nullable=False, unique=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("form", sa.JSON(), nullable=False),
        sa.Column("appeal_id", sa.Integer(), sa.ForeignKey("crm_appeals.id"), nullable=True),
        sa.Column("remove_appeal_attachment_ids", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "scope"),
    )
    op.create_index("ix_crm_drafts_user_id", "crm_drafts", ["user_id"])
    op.create_table(
        "crm_draft_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "draft_id",
            sa.Integer(),
            sa.ForeignKey("crm_drafts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("mime", sa.String(80), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_crm_draft_attachments_draft_id", "crm_draft_attachments", ["draft_id"])


def downgrade():
    op.drop_table("crm_draft_attachments")
    op.drop_table("crm_drafts")
    op.drop_table("crm_training_checks")
    op.drop_table("crm_training_attempts")
    with op.batch_alter_table("crm_appeals") as batch:
        batch.drop_column("training_task")
        batch.drop_column("last_edit_request_id")
        batch.drop_column("revision")
