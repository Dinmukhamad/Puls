"""Маршруты и временное состояние реальной учебной поездки."""

import sqlalchemy as sa

from alembic import op

revision = "20260911_driver_navigation"
down_revision = "20260910_driver_shifts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "driver_route_drafts",
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("id", sa.String(36), nullable=False, unique=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "driver_navigation",
        sa.Column(
            "order_id",
            sa.String(36),
            sa.ForeignKey("driver_orders.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("route", sa.JSON(), nullable=False),
        sa.Column("current", sa.JSON(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "driver_map_rates",
        sa.Column("provider", sa.String(20), primary_key=True),
        sa.Column("next_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("driver_navigation")
    op.drop_table("driver_route_drafts")
    op.drop_table("driver_map_rates")
