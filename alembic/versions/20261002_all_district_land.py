"""Open all personal land without moving buildings or changing district progress or finances."""

import sqlalchemy as sa

from alembic import op

revision = "20261002_all_district_land"
down_revision = "20261002_district_landmark"
branch_labels = depends_on = None


def open_all_land(connection):
    """Normalize existing real and test districts; views also handle districts with no row yet."""
    for city, bands in (("support", 5), ("sales", 3)):
        ids = [f"{prefix}{city}-team-{n}" for prefix in ("", "test-") for n in (1, 2, 3)]
        query = sa.text(
            "UPDATE city_districts SET open_band = :bands WHERE district_id IN :districts"
        ).bindparams(sa.bindparam("districts", expanding=True))
        connection.execute(query, {"bands": bands, "districts": ids})


def upgrade():
    open_all_land(op.get_bind())


def downgrade():
    # Keep land available: new buildings may already occupy outer parts of a district.
    pass
