"""Store normalized user avatars in the database."""

import sqlalchemy as sa
from alembic import op

revision = "20261017_user_avatars"
down_revision = "20261017_crm_course"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "user_avatars",
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_user_avatars_created_at", "user_avatars", ["created_at"])


def downgrade():
    op.drop_table("user_avatars")
