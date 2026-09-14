"""Replace active experience with coin levels; preserve old ledgers as historical records."""

import sqlalchemy as sa

from alembic import op

revision = "20260914_coin_progress"
down_revision = "20260911_driver_navigation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "progress_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("min_coins", sa.Integer(), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("min_coins >= 0", name="ck_progress_levels_threshold_non_negative"),
    )
    op.create_index("ix_progress_levels_created_at", "progress_levels", ["created_at"])
    levels = sa.table(
        "progress_levels",
        sa.column("title", sa.String(120)),
        sa.column("min_coins", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    op.bulk_insert(
        levels,
        [
            {"title": title, "min_coins": threshold, "is_active": True}
            for title, threshold in (
                ("Новичок", 0),
                ("Первый результат", 100),
                ("Специалист", 500),
                ("Профессионал", 1500),
                ("Эксперт", 3000),
                ("Мастер", 5000),
                ("Легенда Puls", 10000),
            )
        ],
    )
    op.create_table(
        "progress_baselines",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            primary_key=True,
        ),
    )
    op.add_column(
        "badge_definitions",
        sa.Column("coins_reward", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "user_badges", sa.Column("coins_awarded", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column("user_badges", sa.Column("award_key", sa.String(160), nullable=True))
    op.create_index("uq_user_badges_award_key", "user_badges", ["award_key"], unique=True)
    op.execute(
        sa.text("UPDATE badge_definitions SET coins_reward = 50 WHERE code = 'no_lateness_3w'")
    )
    op.execute(
        sa.text("UPDATE badge_definitions SET coins_reward = 75 WHERE code = 'quality_star'")
    )
    # Rebuild the display aggregate from the immutable journal; never touch balances or entries.
    op.execute(
        sa.text("""
        UPDATE coin_accounts SET total_earned = CASE WHEN (
            SELECT COALESCE(SUM(CASE
                WHEN tx_type = 'correction' THEN amount
                WHEN amount > 0 AND tx_type != 'purchase_refund' THEN amount ELSE 0 END), 0)
            FROM coin_transactions WHERE user_id = coin_accounts.user_id
        ) > 0 THEN (
            SELECT COALESCE(SUM(CASE
                WHEN tx_type = 'correction' THEN amount
                WHEN amount > 0 AND tx_type != 'purchase_refund' THEN amount ELSE 0 END), 0)
            FROM coin_transactions WHERE user_id = coin_accounts.user_id
        ) ELSE 0 END
    """)
    )


def downgrade():
    op.drop_index("uq_user_badges_award_key", table_name="user_badges")
    op.drop_column("user_badges", "award_key")
    op.drop_column("user_badges", "coins_awarded")
    op.drop_column("badge_definitions", "coins_reward")
    op.drop_table("progress_baselines")
    op.drop_table("progress_levels")
