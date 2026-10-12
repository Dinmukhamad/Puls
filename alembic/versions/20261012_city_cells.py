"""District land in small cells: a building takes 3 × 3, a road, a tree or a lamp one each.

Every plot of the districts is cut into 3 × 3 cells and the districts' roads are gone: operators lay
their own roads, footpaths, trees, lamps and the rest a cell at a time (docs/CITY_ESTATES.md). The
cells do not line up with the old plots, so the districts start from scratch once more, as the
owner chose: whatever the standing buildings cost their owners (`paid`, land and stages included,
a park carrying its squares') and every contribution not yet returned goes back to whoever paid it,
as one refund each in the coin journal (`purchase_refund`, key `city-cells-reset:{user}`, so a
second run refunds nothing), with a notification. Buildings are archived (their history stays in
city_events, which only grows), the cells cleared, open projects cancelled, the headquarters and
the main buildings start again. The cells get the columns of the small things laid on them.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261012_city_cells"
down_revision = "20261011_oktell_training"
branch_labels = depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
transactions = sa.table(
    "coin_transactions",
    sa.column("user_id", sa.Integer),
    sa.column("amount", sa.Integer),
    sa.column("tx_type", sa.String),
    sa.column("reason", sa.Text),
    sa.column("balance_after", sa.Integer),
    sa.column("idempotency_key", sa.String),
    sa.column("meta", JSON),
)
notifications = sa.table(
    "notifications",
    sa.column("user_id", sa.Integer),
    sa.column("title", sa.String),
    sa.column("body", sa.Text),
    sa.column("kind", sa.String),
    sa.column("link", sa.String),
)
projects = sa.table(
    "city_projects",
    sa.column("status", sa.String),
    sa.column("closed_at", sa.DateTime(timezone=True)),
)
events = sa.table(
    "city_events",
    sa.column("district_id", sa.String),
    sa.column("kind", sa.String),
    sa.column("amount", sa.Integer),
    sa.column("payload", JSON),
    sa.column("created_at", sa.DateTime(timezone=True)),
)
audit = sa.table(
    "audit_log",
    sa.column("action", sa.String),
    sa.column("entity_type", sa.String),
    sa.column("entity_id", sa.String),
    sa.column("payload", JSON),
)


def reset_cells(bind):
    """Refunds standing buildings and open contributions, archives buildings, clears the land.

    Mirrors the coin journal's own refunds (app/services/coins.py post_transaction): the balance
    grows, `total_earned` and `total_spent` stay, since refunds are neither earnings nor spending.
    The administrators' test city is cleared too; it never cost anything. Returns
    {user_id: coins refunded}.
    """
    now = datetime.now(UTC)
    built = dict(
        bind.execute(
            sa.text(
                "SELECT owner_id, SUM(paid) FROM city_objects "
                "WHERE owner_id IS NOT NULL AND state IN ('placed', 'stored') "
                "AND district_id NOT LIKE 'test-%' GROUP BY owner_id"
            )
        ).all()
    )
    given = dict(
        bind.execute(
            sa.text(
                "SELECT user_id, SUM(amount) FROM city_contributions "
                "WHERE refund_transaction_id IS NULL GROUP BY user_id"
            )
        ).all()
    )
    refunded = {}
    for user_id in sorted(set(built) | set(given)):
        amount = int(built.get(user_id) or 0) + int(given.get(user_id) or 0)
        key = f"city-cells-reset:{user_id}"
        done = bind.execute(
            sa.text("SELECT 1 FROM coin_transactions WHERE idempotency_key = :key"), {"key": key}
        ).first()
        if amount <= 0 or done:
            continue
        balance = bind.execute(
            sa.text("UPDATE coin_accounts SET balance = balance + :amount WHERE user_id = :user"),
            {"amount": amount, "user": user_id},
        )
        if balance.rowcount != 1:
            continue
        after = bind.execute(
            sa.text("SELECT balance FROM coin_accounts WHERE user_id = :user"), {"user": user_id}
        ).scalar()
        bind.execute(
            transactions.insert().values(
                user_id=user_id,
                amount=amount,
                tx_type="purchase_refund",
                reason="Возврат за стройку в районе: районы начинаются заново, клетками",
                balance_after=after,
                idempotency_key=key,
                meta={
                    "buildings": int(built.get(user_id) or 0),
                    "contributions": int(given.get(user_id) or 0),
                },
            )
        )
        tx = bind.execute(
            sa.text("SELECT id FROM coin_transactions WHERE idempotency_key = :key"), {"key": key}
        ).scalar()
        bind.execute(
            sa.text(
                "UPDATE city_contributions SET refund_transaction_id = :tx "
                "WHERE user_id = :user AND refund_transaction_id IS NULL"
            ),
            {"tx": tx, "user": user_id},
        )
        bind.execute(
            notifications.insert().values(
                user_id=user_id,
                title="Районы начинаются заново",
                body="Участки районов поделены на маленькие клетки: теперь вы сами прокладываете "
                "дороги, сажаете деревья и ставите фонари. Всё, что ты потратил на стройку в "
                f"районе, вернулось в кошелёк: {amount} коинов.",
                kind="learning",
                link="/training/city",
            )
        )
        refunded[user_id] = amount
    districts = sorted(
        {
            row[0]
            for table in ("city_objects", "city_projects", "city_districts", "city_cells")
            for row in bind.execute(sa.text(f"SELECT DISTINCT district_id FROM {table}"))
        }
    )
    bind.execute(
        sa.text(
            "UPDATE city_objects SET state = 'archived', module = NULL, u = NULL, v = NULL, "
            "version = version + 1 WHERE state != 'archived'"
        )
    )
    bind.execute(sa.text("DELETE FROM city_cells"))
    bind.execute(
        projects.update()
        .where(projects.c.status == "open")
        .values(status="cancelled", closed_at=now)
    )
    bind.execute(
        sa.text(
            "UPDATE city_districts SET hq_level = 1, built_projects = 0, landmark_peak_plots = 0"
        )
    )
    for district_id in districts:
        bind.execute(
            events.insert().values(
                district_id=district_id,
                kind="reset",
                amount=0,
                payload={"land": "cells"},
                created_at=now,
            )
        )
    if refunded or districts:
        bind.execute(
            audit.insert().values(
                action="city.land.reset",
                entity_type="city_land",
                entity_id="cells",
                payload={
                    "users": len(refunded),
                    "coins": sum(refunded.values()),
                    "districts": districts,
                },
            )
        )
    return refunded


def upgrade():
    with op.batch_alter_table("city_cells") as batch:
        batch.add_column(sa.Column("decor", sa.String(16), nullable=True))
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("paid", sa.Integer(), server_default="0", nullable=False))
        batch.create_foreign_key(
            "fk_city_cells_owner_id_users", "users", ["owner_id"], ["id"], ondelete="SET NULL"
        )
    reset_cells(op.get_bind())


def downgrade():
    # The refunds stay in the coin journal; only the columns of the small things go.
    op.execute("DELETE FROM city_cells WHERE decor IS NOT NULL")
    with op.batch_alter_table("city_cells") as batch:
        batch.drop_constraint("fk_city_cells_owner_id_users", type_="foreignkey")
        batch.drop_column("paid")
        batch.drop_column("owner_id")
        batch.drop_column("decor")
