"""The city game's settings: prices, points, quarter costs and the daily reward."""

import sqlalchemy as sa

from alembic import op

revision = "20260929_city_economy"
down_revision = "20260929_city_quests"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_economy",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("id = 1", name="singleton"),
    )


def downgrade():
    op.drop_table("city_economy")
