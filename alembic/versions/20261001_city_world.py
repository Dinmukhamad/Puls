"""Two department cities and stable team district configuration."""

from alembic import op
import sqlalchemy as sa

revision = "20261001_city_world"
down_revision = "20260930_dispatch_training"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_world",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("cities", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_city_world_singleton"),
    )


def downgrade():
    op.drop_table("city_world")
