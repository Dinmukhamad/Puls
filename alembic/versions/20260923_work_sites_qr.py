"""Session-scoped QR approval for Work Sites."""

import sqlalchemy as sa

from alembic import op

revision = "20260923_work_sites_qr"
down_revision = "20260923_crm_instructions"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "work_sites_access",
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("user_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade():
    op.drop_table("work_sites_access")
