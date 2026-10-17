"""The district building stages each operator has already seen grow (docs/CITY_MISSIONS.md).

The city celebrates a district that levelled up once per account, not once per browser.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_city_levels_seen"
down_revision = "20261016_city_decor_turn"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("city_levels_seen", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("city_levels_seen")
