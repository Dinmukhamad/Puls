"""Editable Pulsar instructions, independent of historical CRM appeals."""

import sqlalchemy as sa

from alembic import op

revision = "20260923_crm_instructions"
down_revision = "20260922_training_crm"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "crm_instructions",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    )


def downgrade():
    op.drop_table("crm_instructions")
