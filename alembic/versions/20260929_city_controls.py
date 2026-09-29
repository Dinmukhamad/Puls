"""The camera controls each operator chose for the training city."""

import sqlalchemy as sa

from alembic import op

revision = "20260929_city_controls"
down_revision = "20260929_city_situations"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("city_controls", sa.String(8), nullable=True))


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("city_controls")
