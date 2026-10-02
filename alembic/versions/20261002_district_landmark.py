"""Keep district-complex progress without changing buildings, projects or the coin journal."""

import sqlalchemy as sa

from alembic import op

revision = "20261002_district_landmark"
down_revision = "20261001_city_land"
branch_labels = depends_on = None


def backfill_peaks(connection):
    """Capture existing personal land, including districts with no state row yet."""
    connection.execute(
        sa.text("""
        INSERT INTO city_districts
            (district_id, hq_level, built_projects, open_band, landmark_peak_plots)
        SELECT district_id, 1, 0, 1, COUNT(*)
        FROM city_cells
        WHERE module <> 0
          AND district_id NOT IN (SELECT district_id FROM city_districts)
        GROUP BY district_id
    """)
    )
    connection.execute(
        sa.text("""
        UPDATE city_districts
        SET landmark_peak_plots = CASE
            WHEN landmark_peak_plots < (
                SELECT COUNT(*) FROM city_cells
                WHERE city_cells.district_id = city_districts.district_id AND module <> 0
            ) THEN (
                SELECT COUNT(*) FROM city_cells
                WHERE city_cells.district_id = city_districts.district_id AND module <> 0
            ) ELSE landmark_peak_plots END
    """)
    )


def upgrade():
    op.add_column(
        "city_districts",
        sa.Column("landmark_peak_plots", sa.Integer(), server_default="0", nullable=False),
    )
    backfill_peaks(op.get_bind())


def downgrade():
    with op.batch_alter_table("city_districts") as batch:
        batch.drop_column("landmark_peak_plots")
