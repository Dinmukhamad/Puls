"""When the operator finished Pulsar's tour of the site (docs/CITY_MISSIONS.md, «Как устроен Puls»).

The Academy's mission «Как устроен Puls» is ready to claim once this is set.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_site_tour"
down_revision = "20261017_user_avatars"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("site_tour_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("site_tour_at")
