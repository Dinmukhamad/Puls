"""Initial iCORE MVP schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operators",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("group_name", sa.String(length=120), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("current_balance", sa.Integer(), nullable=False),
        sa.Column("reserved_balance", sa.Integer(), nullable=False),
        sa.Column("total_earned", sa.Integer(), nullable=False),
        sa.Column("total_spent", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"]),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_username", "users", ["username"])
    op.create_index("ix_users_role", "users", ["role"])
    op.create_foreign_key("fk_operators_user_id_users", "operators", "users", ["user_id"], ["id"])
    op.create_index("ix_operators_full_name", "operators", ["full_name"])
    op.create_index("ix_operators_group_name", "operators", ["group_name"])

    op.create_table(
        "shop_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "weekly_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("week_end", sa.Date(), nullable=False),
        sa.Column("contest_points", sa.Float(), nullable=False),
        sa.Column("coins_earned", sa.Integer(), nullable=False),
        sa.Column("rank_position", sa.Integer(), nullable=True),
        sa.Column("previous_rank_position", sa.Integer(), nullable=True),
        sa.Column("hours_score", sa.Float(), nullable=False),
        sa.Column("overtime_score", sa.Float(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("efficiency_score", sa.Float(), nullable=False),
        sa.Column("calls_per_hour_score", sa.Float(), nullable=False),
        sa.Column("lateness_count", sa.Integer(), nullable=False),
        sa.Column("violation_count", sa.Integer(), nullable=False),
        sa.Column("final_score", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"]),
        sa.UniqueConstraint("operator_id", "week_start", "week_end", name="uq_weekly_operator_period"),
    )
    op.create_index("ix_weekly_results_operator_id", "weekly_results", ["operator_id"])
    op.create_table(
        "shop_purchases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("shop_item_id", sa.Integer(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["shop_item_id"], ["shop_items.id"]),
    )
    op.create_index("ix_shop_purchases_operator_id", "shop_purchases", ["operator_id"])
    op.create_index("ix_shop_purchases_status", "shop_purchases", ["status"])
    op.create_table(
        "coin_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("related_purchase_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"]),
        sa.ForeignKeyConstraint(["related_purchase_id"], ["shop_purchases.id"]),
    )
    op.create_index("ix_coin_transactions_operator_id", "coin_transactions", ["operator_id"])
    op.create_index("ix_coin_transactions_type", "coin_transactions", ["type"])


def downgrade() -> None:
    op.drop_index("ix_coin_transactions_type", table_name="coin_transactions")
    op.drop_index("ix_coin_transactions_operator_id", table_name="coin_transactions")
    op.drop_table("coin_transactions")
    op.drop_index("ix_shop_purchases_status", table_name="shop_purchases")
    op.drop_index("ix_shop_purchases_operator_id", table_name="shop_purchases")
    op.drop_table("shop_purchases")
    op.drop_index("ix_weekly_results_operator_id", table_name="weekly_results")
    op.drop_table("weekly_results")
    op.drop_table("shop_items")
    op.drop_index("ix_operators_group_name", table_name="operators")
    op.drop_index("ix_operators_full_name", table_name="operators")
    op.drop_constraint("fk_operators_user_id_users", "operators", type_="foreignkey")
    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
    op.drop_table("operators")
