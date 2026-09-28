"""Buildings operators buy with coins for the plots of their own city."""

import sqlalchemy as sa

from alembic import op

revision = "20260928_city_builds"
down_revision = "20260926_city_perf"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_builds",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("plot_key", sa.String(40), primary_key=True),
        sa.Column("item_key", sa.String(40), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("city_builds")
