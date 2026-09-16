"""Training role, assignments, scenario snapshots and isolated preview attempts."""

import sqlalchemy as sa

from alembic import op

revision = "20260916_trainer"
down_revision = "20260914_coin_progress"
branch_labels = depends_on = None


def upgrade():
    op.add_column("learning_contents", sa.Column("driver_config", sa.JSON(), nullable=True))
    for table in ("learning_attempts", "driver_shifts"):
        op.add_column(
            table, sa.Column("is_preview", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            "ALTER TABLE driver_shifts ADD COLUMN content_id INTEGER REFERENCES learning_contents(id)"
        )
    else:
        op.add_column(
            "driver_shifts",
            sa.Column(
                "content_id",
                sa.Integer(),
                sa.ForeignKey(
                    "learning_contents.id", name="fk_driver_shifts_content_id_learning_contents"
                ),
                nullable=True,
            ),
        )
    op.create_index("ix_driver_shifts_content_id", "driver_shifts", ["content_id"])
    op.create_table(
        "learning_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "content_id", sa.Integer(), sa.ForeignKey("learning_contents.id"), nullable=False
        ),
        sa.Column("assigned_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "user_id", "content_id", name="uq_learning_assignments_user_id_content_id"
        ),
    )
    for column in ("user_id", "content_id", "created_at"):
        op.create_index(f"ix_learning_assignments_{column}", "learning_assignments", [column])
    # Previously completed staff practice must not count as operator production statistics.
    for table in ("learning_attempts", "driver_shifts"):
        op.execute(
            sa.text(
                f"UPDATE {table} SET is_preview = true WHERE user_id IN (SELECT id FROM users WHERE role != 'operator')"
            )
        )


def downgrade():
    op.drop_table("learning_assignments")
    op.drop_index("ix_driver_shifts_content_id", table_name="driver_shifts")
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(
            "fk_driver_shifts_content_id_learning_contents", "driver_shifts", type_="foreignkey"
        )
    op.drop_column("driver_shifts", "content_id")
    for table in ("learning_attempts", "driver_shifts"):
        op.drop_column(table, "is_preview")
    op.drop_column("learning_contents", "driver_config")
