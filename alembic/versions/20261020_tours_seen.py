"""Pulsar's walks through the work sites each account has already seen (docs/TRAINING_CRM.md, «Подсказки Пульсара»).

A walk that starts by itself does so once per account, not once per browser.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261020_tours_seen"
down_revision = "20261019_call_quality_title"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("tours_seen", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("tours_seen")
