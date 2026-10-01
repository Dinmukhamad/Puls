"""Team districts as a Monopoly board: plots instead of estates, everything built so far refunded.

The land of the districts is now plots that operators buy one by one (app/services/city_land.py).
What was built on the old estates, tower lots and public squares cannot stand on them, so the
districts start from scratch (docs/CITY_ESTATES.md): every coin spent on district buildings and
every contribution not yet returned goes back to whoever paid it, as one refund each in the coin
journal (`purchase_refund`, key `city-land-reset:{user}`, so a second run refunds nothing), with a
notification. Buildings are archived (their history stays in city_events, which only grows), open
projects are cancelled, the headquarters start again at stage 1. Old "Мой город" plots and their
purchases are not touched.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261001_city_land"
down_revision = "20261001_telegram_creation"
branch_labels = depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
transactions = sa.table(
    "coin_transactions",
    sa.column("id", sa.Integer),
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


def reset_estates(bind):
    """Refunds district buildings and open contributions, archives buildings, cancels projects.

    Mirrors the coin journal's own refunds (app/services/coins.py post_transaction): the balance
    grows, `total_earned` and `total_spent` stay, since refunds are neither earnings nor spending.
    Returns {user_id: coins refunded}.
    """
    now = datetime.now(UTC)
    built = dict(
        bind.execute(
            sa.text(
                "SELECT user_id, -SUM(amount) FROM coin_transactions "
                "WHERE tx_type = 'city_build' AND idempotency_key LIKE 'city-op:%' "
                "GROUP BY user_id"
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
        key = f"city-land-reset:{user_id}"
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
                reason="Возврат за стройку в районе: районы начинаются заново, участками",
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
                body=f"Город делится на участки, как в «Монополии». Всё, что ты потратил на "
                f"стройку в районе, вернулось в кошелёк: {amount} коинов.",
                kind="learning",
                link="/training/city",
            )
        )
        refunded[user_id] = amount
    districts = sorted(
        {
            row[0]
            for table in ("city_objects", "city_projects", "city_districts")
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
        sa.text("UPDATE city_districts SET hq_level = 1, built_projects = 0, open_band = 1")
    )
    for district_id in districts:
        bind.execute(
            events.insert().values(
                district_id=district_id,
                kind="reset",
                amount=0,
                payload={"land": "plots"},
                created_at=now,
            )
        )
    if refunded or districts:
        bind.execute(
            audit.insert().values(
                action="city.land.reset",
                entity_type="city_land",
                entity_id="plots",
                payload={
                    "users": len(refunded),
                    "coins": sum(refunded.values()),
                    "districts": districts,
                },
            )
        )
    return refunded


def upgrade():
    op.add_column(
        "city_districts", sa.Column("open_band", sa.Integer(), server_default="1", nullable=False)
    )
    reset_estates(op.get_bind())
    op.drop_index("ix_city_lots_user_id", table_name="city_lots")
    op.drop_table("city_lots")


def downgrade():
    # The land stays reset: the refunds are entries of the journal and are never taken back.
    op.create_table(
        "city_lots",
        sa.Column("district_id", sa.String(32), primary_key=True),
        sa.Column("module", sa.Integer(), primary_key=True),
        sa.Column("index", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "kind", name="uq_city_lots_user_id"),
    )
    op.create_index("ix_city_lots_user_id", "city_lots", ["user_id"])
    with op.batch_alter_table("city_districts") as batch:
        batch.drop_column("open_band")
