"""Наследуемый доступ к разделам по ролям, группам и аккаунтам."""

import sqlalchemy as sa

from alembic import op

revision = "20260906_access"
down_revision = "a1c4d9e07b32"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "access_policy",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_access_policy_singleton")),
    )
    op.create_table(
        "access_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(80), nullable=False),
        sa.Column("section", sa.String(64), nullable=False),
        sa.Column("effect", sa.String(8), nullable=False),
        sa.UniqueConstraint("target_type", "target_id", "section", name="uq_access_target_section"),
        sa.CheckConstraint(
            "effect IN ('allow', 'deny')", name=op.f("ck_access_rules_valid_effect")
        ),
        sa.CheckConstraint(
            "target_type IN ('all', 'role', 'group', 'user')",
            name=op.f("ck_access_rules_valid_target"),
        ),
    )
    op.bulk_insert(
        sa.table(
            "access_policy", sa.column("id", sa.Integer()), sa.column("revision", sa.Integer())
        ),
        [{"id": 1, "revision": 0}],
    )


def downgrade():
    op.drop_table("access_rules")
    op.drop_table("access_policy")
