"""The island city's district land on a square grid: the Техподдержка districts start again.

The cells of the island city's districts ran in rings, so that they turned from one district and
one band to the next; now they are squares in straight rows, as by the lake (frontend
world/land.ts, app/data/city_land.json), and no cell keeps its address. As the owner chose, the
support districts start from scratch and the sales districts keep everything: whatever the standing
buildings and the small things laid in a support district cost their owners (`paid`, land and
stages included, a park carrying its squares') and every contribution to its projects not yet
returned go back to whoever paid them, as one refund each in the coin journal (`purchase_refund`,
key `city-squares-reset:{user}`, so a second run refunds nothing), with a notification. Their
buildings are archived (their history stays in city_events, which only grows), their cells cleared,
their open projects cancelled, their headquarters and main buildings start again. The
administrators' test copies of these districts are cleared too; they never cost anything.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261012_city_squares"
down_revision = "20261012_city_sizes"
branch_labels = depends_on = None

#: The support districts and the test city's copies of them (app/services/city_sandbox.py).
SUPPORT, TEST = "support-team-%", "test-support-team-%"
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
#: Either kind of district: a support one or its test copy.
CLEARED = "(district_id LIKE :support OR district_id LIKE :test)"


def coins(n):
    """«1 коин», «3 коина», «5 коинов»."""
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} коин"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f"{n} коина"
    return f"{n} коинов"


def reset_support(bind):
    """Refunds the support districts' buildings, small things and open contributions, clears them.

    Mirrors the coin journal's own refunds (app/services/coins.py post_transaction): the balance
    grows, `total_earned` and `total_spent` stay, since refunds are neither earnings nor spending.
    Returns {user_id: coins refunded}.
    """
    now = datetime.now(UTC)
    where = {"support": SUPPORT, "test": TEST}

    def totals(sql):
        return {user: int(amount or 0) for user, amount in bind.execute(sa.text(sql), where).all()}

    built = totals(
        "SELECT owner_id, SUM(paid) FROM city_objects WHERE owner_id IS NOT NULL "
        "AND state IN ('placed', 'stored') AND district_id LIKE :support GROUP BY owner_id"
    )
    laid = totals(
        "SELECT owner_id, SUM(paid) FROM city_cells WHERE owner_id IS NOT NULL "
        "AND decor IS NOT NULL AND district_id LIKE :support GROUP BY owner_id"
    )
    given = totals(
        "SELECT c.user_id, SUM(c.amount) FROM city_contributions c "
        "JOIN city_projects p ON p.id = c.project_id "
        "WHERE c.refund_transaction_id IS NULL AND p.district_id LIKE :support GROUP BY c.user_id"
    )
    refunded = {}
    for user_id in sorted(set(built) | set(laid) | set(given)):
        parts = {
            "buildings": built.get(user_id, 0),
            "decor": laid.get(user_id, 0),
            "contributions": given.get(user_id, 0),
        }
        amount, key = sum(parts.values()), f"city-squares-reset:{user_id}"
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
                reason="Возврат за стройку в районе Техподдержки: районы начинаются заново, "
                "ровными клетками",
                balance_after=after,
                idempotency_key=key,
                meta=parts,
            )
        )
        tx = bind.execute(
            sa.text("SELECT id FROM coin_transactions WHERE idempotency_key = :key"), {"key": key}
        ).scalar()
        bind.execute(
            sa.text(
                "UPDATE city_contributions SET refund_transaction_id = :tx "
                "WHERE user_id = :user AND refund_transaction_id IS NULL AND project_id IN "
                "(SELECT id FROM city_projects WHERE district_id LIKE :support)"
            ),
            {"tx": tx, "user": user_id, "support": SUPPORT},
        )
        bind.execute(
            notifications.insert().values(
                user_id=user_id,
                title="Районы Техподдержки начинаются заново",
                body="Клетки районов Техподдержки теперь квадратные и стоят ровными рядами, как в "
                "городе ОП. Всё, что ты потратил на стройку в районе, вернулось в кошелёк: "
                f"{coins(amount)}.",
                kind="learning",
                link="/training/city",
            )
        )
        refunded[user_id] = amount
    districts = sorted(
        {
            row[0]
            for table in ("city_objects", "city_projects", "city_districts", "city_cells")
            for row in bind.execute(
                sa.text(f"SELECT DISTINCT district_id FROM {table} WHERE {CLEARED}"), where
            )
        }
    )
    bind.execute(
        sa.text(
            "UPDATE city_objects SET state = 'archived', module = NULL, u = NULL, v = NULL, "
            f"version = version + 1 WHERE state != 'archived' AND {CLEARED}"
        ),
        where,
    )
    bind.execute(sa.text(f"DELETE FROM city_cells WHERE {CLEARED}"), where)
    bind.execute(
        sa.text(
            f"UPDATE city_projects SET status = 'cancelled', closed_at = :now "
            f"WHERE status = 'open' AND {CLEARED}"
        ),
        {**where, "now": now},
    )
    bind.execute(
        sa.text(
            "UPDATE city_districts SET hq_level = 1, built_projects = 0, landmark_peak_plots = 0 "
            f"WHERE {CLEARED}"
        ),
        where,
    )
    for district_id in districts:
        bind.execute(
            events.insert().values(
                district_id=district_id,
                kind="reset",
                amount=0,
                payload={"land": "squares"},
                created_at=now,
            )
        )
    if refunded or districts:
        bind.execute(
            audit.insert().values(
                action="city.land.reset",
                entity_type="city_land",
                entity_id="squares",
                payload={
                    "users": len(refunded),
                    "coins": sum(refunded.values()),
                    "districts": districts,
                },
            )
        )
    return refunded


def upgrade():
    reset_support(op.get_bind())


def downgrade():
    # The refunds stay in the coin journal, the cleared districts stay cleared.
    pass
