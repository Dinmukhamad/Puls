"""Raise the previous default manual coin limit while preserving custom rules."""

import sqlalchemy as sa

from alembic import op

revision = "20261003_manual_coin_limit"
down_revision = "20261002_all_district_land"
branch_labels = depends_on = None


def upgrade():
    op.get_bind().execute(
        sa.text(
            "UPDATE gamification_settings SET manual_max_abs_amount = 9999 "
            "WHERE manual_max_abs_amount = 100"
        )
    )


def downgrade():
    # Earlier code accepts this setting too. Keep it: a later custom value of 9999
    # cannot be distinguished from the value supplied by this data migration.
    pass
