"""Seasons of the team districts: the shared schedule, past cities and their totals.

Only a table is added. The first season begins on first use of the city, at the earliest event of
the real districts, with no schedule: nothing is reset until a head or an administrator sets one.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261014_city_seasons"
down_revision = "20261012_city_squares"
branch_labels = depends_on = None


def upgrade() -> None:
    op.create_table(
        "city_seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period", sa.String(10), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "ended_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("snapshot", sa.JSON(), nullable=True),
        sa.Column("totals", sa.JSON(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "updated_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("number", name="uq_city_seasons_number"),
    )


def downgrade() -> None:
    op.drop_table("city_seasons")
