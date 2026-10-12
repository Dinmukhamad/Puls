"""Buildings on cells of their own size: a square or an office tower 2 × 2, parks 4 × 4 and 6 × 4.

Until now every building on the districts' land took 3 × 3 cells (a park 6 × 6, a big park 9 × 6);
houses keep 3 × 3 (docs/CITY_ESTATES.md). A square, an office tower or a park standing on the land
keeps its first cell and its turn and gives back the cells beyond its new size, so they are free for
building again. Nothing is paid back: its land was bought as a plot. Buildings in the inventory have
no cells; the old public squares' projects (module 0) keep theirs.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261012_city_sizes"
down_revision = "20261012_city_cells"
branch_labels = depends_on = None

OFFICES = [f"office{letter}" for letter in "abcdefghi"]
#: Columns × rows of cells, unturned (app/services/city_estate.py PLOT_FAMILIES).
SIZES = {"square": (2, 2), **dict.fromkeys(OFFICES, (2, 2)), "park": (4, 4), "bigpark": (6, 4)}

objects = sa.table(
    "city_objects",
    sa.column("id", sa.Integer),
    sa.column("family", sa.String),
    sa.column("state", sa.String),
    sa.column("module", sa.Integer),
    sa.column("u", sa.Integer),
    sa.column("v", sa.Integer),
    sa.column("rotation", sa.Integer),
)
cells = sa.table(
    "city_cells",
    sa.column("object_id", sa.Integer),
    sa.column("u", sa.Integer),
    sa.column("v", sa.Integer),
)


def upgrade():
    shrink(op.get_bind())


def shrink(bind):
    """Frees the cells beyond the new size of every such building on the land; how many."""
    placed = bind.execute(
        sa.select(
            objects.c.id, objects.c.family, objects.c.u, objects.c.v, objects.c.rotation
        ).where(objects.c.state == "placed", objects.c.module != 0, objects.c.family.in_(SIZES))
    ).all()
    freed = 0
    for obj in placed:
        w, h = SIZES[obj.family]
        if (obj.rotation or 0) % 2:
            w, h = h, w
        freed += bind.execute(
            cells.delete().where(
                cells.c.object_id == obj.id,
                sa.or_(cells.c.u >= obj.u + w, cells.c.v >= obj.v + h),
            )
        ).rowcount
    return freed


def downgrade():
    # The freed cells may have been built on since; there is nothing to give back.
    pass
