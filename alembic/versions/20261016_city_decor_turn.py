"""Lamps and benches turn: the side of its cell a lamp stands at, a bench looks to.

docs/CITY_ESTATES.md, «Подвинуть и повернуть».

Nothing laid so far is turned: it keeps standing by the road beside it, as before.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261016_city_decor_turn"
down_revision = "20261016_crm_training"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("city_cells") as batch:
        batch.add_column(sa.Column("turn", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("city_cells") as batch:
        batch.drop_column("turn")
