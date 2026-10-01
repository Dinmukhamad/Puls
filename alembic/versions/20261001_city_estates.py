"""Team district land: estates, buildings, cells, shared projects, contributions and their history."""

import sqlalchemy as sa

from alembic import op

revision = "20261001_city_estates"
down_revision = "20261001_city_world"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "city_lots",
        sa.Column("district_id", sa.String(32), primary_key=True),
        sa.Column("module", sa.Integer(), primary_key=True),
        sa.Column("index", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "kind", name="uq_city_lots_user_id"),
    )
    op.create_index("ix_city_lots_user_id", "city_lots", ["user_id"])
    op.create_table(
        "city_objects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("district_id", sa.String(32), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("family", sa.String(16), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("module", sa.Integer(), nullable=True),
        sa.Column("u", sa.Integer(), nullable=True),
        sa.Column("v", sa.Integer(), nullable=True),
        sa.Column("rotation", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("paid", sa.Integer(), nullable=False),
        sa.Column("components", sa.JSON(), nullable=True),
        sa.Column("consumed_by", sa.Integer(), sa.ForeignKey("city_objects.id"), nullable=True),
        sa.Column("economy_revision", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_city_objects_district_state", "city_objects", ["district_id", "state"])
    op.create_index("ix_city_objects_owner_state", "city_objects", ["owner_id", "state"])
    op.create_table(
        "city_projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("district_id", sa.String(32), nullable=False),
        sa.Column("family", sa.String(16), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("city_objects.id"), nullable=True),
        sa.Column("module", sa.Integer(), nullable=True),
        sa.Column("u", sa.Integer(), nullable=True),
        sa.Column("v", sa.Integer(), nullable=True),
        sa.Column("rotation", sa.Integer(), nullable=False),
        sa.Column("size", sa.String(8), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=False),
        sa.Column("funded", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("economy_revision", sa.Integer(), nullable=False),
        sa.Column("object_id", sa.Integer(), sa.ForeignKey("city_objects.id"), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_city_projects_district_id", "city_projects", ["district_id"])
    op.create_table(
        "city_cells",
        sa.Column("district_id", sa.String(32), primary_key=True),
        sa.Column("module", sa.Integer(), primary_key=True),
        sa.Column("u", sa.Integer(), primary_key=True),
        sa.Column("v", sa.Integer(), primary_key=True),
        sa.Column("object_id", sa.Integer(), sa.ForeignKey("city_objects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("city_projects.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_city_cells_object_id", "city_cells", ["object_id"])
    op.create_index("ix_city_cells_project_id", "city_cells", ["project_id"])
    op.create_table(
        "city_contributions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("city_projects.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("coin_transactions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("refund_transaction_id", sa.Integer(), sa.ForeignKey("coin_transactions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_city_contributions_project_id", "city_contributions", ["project_id"])
    op.create_index("ix_city_contributions_user_id", "city_contributions", ["user_id"])
    op.create_table(
        "city_districts",
        sa.Column("district_id", sa.String(32), primary_key=True),
        sa.Column("hq_level", sa.Integer(), nullable=False),
        sa.Column("built_projects", sa.Integer(), nullable=False),
    )
    op.create_table(
        "city_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "key", name="uq_city_operations_user_id"),
    )
    op.create_table(
        "city_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("district_id", sa.String(32), nullable=False),
        sa.Column("object_id", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_city_events_district_id", "city_events", ["district_id"])
    op.create_index("ix_city_events_object_id", "city_events", ["object_id"])
    from app.db.city_guards import city_guard_statements

    for statement in city_guard_statements(op.get_bind().dialect.name):
        op.execute(sa.text(statement))


def downgrade():
    from app.db.city_guards import drop_city_guard_statements

    for statement in drop_city_guard_statements(op.get_bind().dialect.name):
        op.execute(sa.text(statement))
    # Cells and contributions point at projects, projects at buildings: the referring tables go first.
    for table in (
        "city_events", "city_operations", "city_districts", "city_contributions", "city_cells",
        "city_projects", "city_objects", "city_lots",
    ):
        op.drop_table(table)
