"""The coin economy of 2.24.52 (docs/COIN_ECONOMY.md): a monthly contest, fines, limits, sinks.

Adds the monthly contest's tables, the fines' carry-over, the shop's monthly stock and tenge cost,
paid wheel spins and raffle tickets. Moves the numbers that are still at their old defaults to the
new ones (an average operator earns about 1000 coins a month, 1 coin = 5 ₸); a value a head has
changed stays as it is.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261015_coin_economy"
down_revision = "20261014_city_seasons"
branch_labels = depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

#: (column, old default, new value) of the rules row.
RULES = (
    ("points_per_coin", 5.0, 0.5),
    ("rank1_bonus", 15, 300),
    ("rank2_bonus", 10, 200),
    ("rank3_bonus", 7, 150),
    ("no_lateness_bonus", 5, 25),
    ("no_forbidden_sites_bonus", 3, 15),
    ("nomination_bonus_default", 5, 100),
    ("driver_gratitude_bonus", 3, 30),
    ("manual_max_abs_amount", 9999, 200),
)
#: Shop items: code -> (old price, new price, tenge, monthly stock).
SHOP = {
    "star_of_week": (30, 150, None, None),
    "early_shift_access": (80, 400, None, None),
    "extra_break": (80, 250, None, None),
    "coffee_card": (120, 300, 1500, 8),
    "team_pizza": (180, 1600, 8000, 1),
    "merch": (200, 1000, 5000, 2),
    "company_lunch": (300, 600, 3000, 4),
    "marketplace_card": (400, 1000, 5000, 1),
}


def _status():
    return sa.Column("status", sa.String(16), nullable=False, server_default="open")


def upgrade() -> None:
    with op.batch_alter_table("gamification_settings") as batch:
        batch.add_column(sa.Column("gratitude_monthly_limit", sa.Integer(), nullable=False,
                                   server_default="5"))
        batch.add_column(sa.Column("contest_period", sa.String(8), nullable=False,
                                   server_default="month"))
        batch.add_column(sa.Column("lateness_fine", sa.Integer(), nullable=False,
                                   server_default="50"))
        batch.add_column(sa.Column("forbidden_site_fine", sa.Integer(), nullable=False,
                                   server_default="30"))
        batch.add_column(sa.Column("manual_monthly_limit", sa.Integer(), nullable=False,
                                   server_default="1500"))
        batch.add_column(sa.Column("coin_rate_tenge", sa.Float(), nullable=False,
                                   server_default="5"))
        batch.add_column(sa.Column("shop_monthly_budget_tenge", sa.Integer(), nullable=False,
                                   server_default="50000"))
    with op.batch_alter_table("coin_accounts") as batch:
        batch.add_column(sa.Column("fine_debt", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("shop_items") as batch:
        batch.add_column(sa.Column("monthly_stock", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("cost_tenge", sa.Integer(), nullable=True))
    with op.batch_alter_table("wheel_config") as batch:
        batch.add_column(sa.Column("paid_spins", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("spin_cost", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("wheel_spins") as batch:
        batch.add_column(sa.Column("cost", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("raffles") as batch:
        batch.add_column(sa.Column("entry_cost", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("operator_week_results") as batch:
        batch.add_column(sa.Column("coins_fine", sa.Integer(), nullable=False, server_default="0"))

    stamps = (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_table(
        "contest_months",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        _status(),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("rules_snapshot", JSON, nullable=True),
        *[c.copy() for c in stamps],
        sa.UniqueConstraint("year", "month", name="uq_contest_month"),
    )
    op.create_index("ix_contest_months_status", "contest_months", ["status"])
    op.create_table(
        "operator_month_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("month_id", sa.Integer(),
                  sa.ForeignKey("contest_months.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("points", sa.Float(), nullable=False, server_default="0"),
        sa.Column("weeks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("coins_rank_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("coins_nomination_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("breakdown", JSON, nullable=True),
        *[c.copy() for c in stamps],
        sa.UniqueConstraint("month_id", "user_id", name="uq_month_user_result"),
    )
    for column in ("month_id", "user_id", "points", "rank"):
        op.create_index(f"ix_operator_month_results_{column}", "operator_month_results", [column])
    op.create_table(
        "month_nomination_winners",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("month_id", sa.Integer(),
                  sa.ForeignKey("contest_months.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nomination_id", sa.Integer(),
                  sa.ForeignKey("nomination_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("value", sa.Float(), nullable=False, server_default="0"),
        sa.Column("coins_awarded", sa.Integer(), nullable=False, server_default="0"),
        *[c.copy() for c in stamps],
        sa.UniqueConstraint("month_id", "nomination_id", name="uq_month_nomination"),
    )
    op.create_index("ix_month_nomination_winners_month_id", "month_nomination_winners",
                    ["month_id"])
    op.create_index("ix_month_nomination_winners_user_id", "month_nomination_winners",
                    ["user_id"])

    # The numbers still at their old defaults move to the new economy.
    for column, old, new in RULES:
        op.execute(sa.text(
            f"UPDATE gamification_settings SET {column} = :new WHERE {column} = :old"
        ).bindparams(new=new, old=old))
    # A lateness or a forbidden site is a direct fine now, not points off.
    op.execute(sa.text(
        "UPDATE metric_definitions SET penalty_per_unit = 0 "
        "WHERE (code = 'lateness' AND penalty_per_unit = 5) "
        "OR (code = 'forbidden_sites' AND penalty_per_unit = 3)"
    ))
    op.execute(sa.text(
        "UPDATE nomination_definitions SET coins_reward = 100 WHERE coins_reward = 5"
    ))
    op.execute(sa.text(
        "UPDATE nomination_definitions SET title = 'Лучший прогресс' "
        "WHERE code = 'best_progress' AND title = 'Лучший прогресс недели'"
    ))
    for code, (old, new, tenge, stock) in SHOP.items():
        op.execute(sa.text(
            "UPDATE shop_items SET price = :new, cost_tenge = :tenge, monthly_stock = :stock "
            "WHERE code = :code AND price = :old"
        ).bindparams(new=new, tenge=tenge, stock=stock, code=code, old=old))

    # The daily situation pays 3 coins instead of 10, unless a head changed it.
    bind = op.get_bind()
    row = bind.execute(
        sa.text("SELECT revision, \"values\" FROM city_economy WHERE id = 1")
    ).first()
    if row is not None:
        import json

        values = row[1] if isinstance(row[1], dict) else json.loads(row[1] or "{}")
        if values.get("quest_coins") == 10:
            values["quest_coins"] = 3
            bind.execute(
                sa.text("UPDATE city_economy SET \"values\" = :values, revision = :revision "
                        "WHERE id = 1").bindparams(
                    sa.bindparam("values", type_=JSON)),
                {"values": values, "revision": row[0] + 1},
            )


def downgrade() -> None:
    op.drop_table("month_nomination_winners")
    op.drop_table("operator_month_results")
    op.drop_table("contest_months")
    for table, columns in (
        ("operator_week_results", ("coins_fine",)),
        ("raffles", ("entry_cost",)),
        ("wheel_spins", ("cost",)),
        ("wheel_config", ("paid_spins", "spin_cost")),
        ("shop_items", ("monthly_stock", "cost_tenge")),
        ("coin_accounts", ("fine_debt",)),
        ("gamification_settings", (
            "gratitude_monthly_limit", "contest_period", "lateness_fine", "forbidden_site_fine",
            "manual_monthly_limit", "coin_rate_tenge", "shop_monthly_budget_tenge",
        )),
    ):
        with op.batch_alter_table(table) as batch:
            for column in columns:
                batch.drop_column(column)
