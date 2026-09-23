"""Persistent city missions and idempotent rewards."""

import sqlalchemy as sa

from alembic import op

revision = "20260923_city_missions"
down_revision = "20260923_work_sites_qr"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("missions", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_city_settings_singleton"),
    )
    op.create_table(
        "city_awards",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("mission_key", sa.String(40), primary_key=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False),
        sa.Column("coins", sa.Integer(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("city_awards")
    op.drop_table("city_settings")
