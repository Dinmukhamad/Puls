"""Operator gender and the name given to the training guide."""

import sqlalchemy as sa

from alembic import op

revision = "20260924_user_guide"
down_revision = "20260923_city_missions"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("gender", sa.String(8), nullable=True))
        batch.add_column(sa.Column("guide_name", sa.String(40), nullable=True))


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("guide_name")
        batch.drop_column("gender")
