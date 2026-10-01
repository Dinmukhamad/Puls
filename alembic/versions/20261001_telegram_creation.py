"""Telegram invitations prepared during account creation."""

import sqlalchemy as sa

from alembic import op

revision = "20261001_telegram_creation"
down_revision = "20261001_city_estates"
branch_labels = depends_on = None


def upgrade():
    op.add_column("telegram_links", sa.Column("pending_username", sa.String(32), nullable=True))
    op.create_index(
        "ix_telegram_links_pending_username", "telegram_links", ["pending_username"], unique=True
    )


def downgrade():
    op.drop_index("ix_telegram_links_pending_username", table_name="telegram_links")
    op.drop_column("telegram_links", "pending_username")
