"""The daily situations' own set, editable by trainers."""

import sqlalchemy as sa

from alembic import op

revision = "20260929_city_situations"
down_revision = "20260929_city_economy"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_situations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("id = 1", name="singleton"),
    )


def downgrade():
    op.drop_table("city_situations")
