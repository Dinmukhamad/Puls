"""Daily situations on the city map: one row per operator, day and slot."""

import sqlalchemy as sa

from alembic import op

revision = "20260929_city_quests"
down_revision = "20260928_city_builds"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_quests",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("slot", sa.Integer(), primary_key=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("answer", sa.Integer(), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table("city_quests")
