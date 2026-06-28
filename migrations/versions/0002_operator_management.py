"""Operator management fields and audit log.

Revision ID: 0002_operator_management
Revises: 0001_initial
Create Date: 2026-06-28
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_operator_management"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("can_manage_operators", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("operators") as batch_op:
        batch_op.add_column(sa.Column("status", sa.String(length=32), nullable=False, server_default="active"))
        batch_op.add_column(sa.Column("position", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("employee_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("email", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("participation_started_at", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("admin_comment", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_operators_status", ["status"])
        batch_op.create_unique_constraint("uq_operators_employee_id", ["employee_id"])
        batch_op.create_unique_constraint("uq_operators_email", ["email"])
        batch_op.create_foreign_key("fk_operators_created_by_user_id_users", "users", ["created_by_user_id"], ["id"])

    op.create_table(
        "operator_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
    )
    op.create_index("ix_operator_audit_logs_operator_id", "operator_audit_logs", ["operator_id"])
    op.create_index("ix_operator_audit_logs_action", "operator_audit_logs", ["action"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("can_manage_operators")

    op.drop_index("ix_operator_audit_logs_action", table_name="operator_audit_logs")
    op.drop_index("ix_operator_audit_logs_operator_id", table_name="operator_audit_logs")
    op.drop_table("operator_audit_logs")
    with op.batch_alter_table("operators") as batch_op:
        batch_op.drop_constraint("fk_operators_created_by_user_id_users", type_="foreignkey")
        batch_op.drop_constraint("uq_operators_email", type_="unique")
        batch_op.drop_constraint("uq_operators_employee_id", type_="unique")
        batch_op.drop_index("ix_operators_status")
        batch_op.drop_column("created_by_user_id")
        batch_op.drop_column("admin_comment")
        batch_op.drop_column("participation_started_at")
        batch_op.drop_column("email")
        batch_op.drop_column("employee_id")
        batch_op.drop_column("position")
        batch_op.drop_column("status")
