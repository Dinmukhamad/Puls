"""Give existing active supervisors an empty team without merging historical groups."""

import sqlalchemy as sa

from alembic import op

revision = "20261009_supervisor_teams"
down_revision = "20261007_scenarios"
branch_labels = depends_on = None


def upgrade() -> None:
    users = sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("role", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("full_name", sa.String()),
    )
    groups = sa.table(
        "groups",
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
        sa.column("supervisor_id", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    # A reserved code avoids ordinary group codes. A second candidate handles a legacy collision;
    # runtime ensure_team also supports arbitrary suffixes when an account has no active team.
    base = sa.literal("sv-") + sa.cast(users.c.id, sa.String())
    codes = groups.alias("existing_codes")
    code = sa.case(
        (~sa.exists(sa.select(1).where(codes.c.code == base).correlate(users)), base),
        else_=base + sa.literal("-auto"),
    )
    rows = sa.select(
        code,
        sa.func.substr(sa.literal("Команда ") + users.c.full_name, 1, 255),
        users.c.id,
        sa.true(),
    ).where(
        users.c.role == "supervisor",
        users.c.is_active.is_(True),
        ~sa.exists(sa.select(1).where(groups.c.supervisor_id == users.c.id).correlate(users)),
        ~sa.exists(sa.select(1).where(groups.c.code == code).correlate(users)),
    )
    op.execute(sa.insert(groups).from_select(["code", "name", "supervisor_id", "is_active"], rows))


def downgrade() -> None:
    # Teams may contain operators and carry district/history references; preserve their data.
    pass
