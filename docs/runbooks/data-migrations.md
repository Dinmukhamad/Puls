# Data migration and reconciliation

PostgreSQL is the production contract. SQLite is supported only for local development
and tests.

Before migration, export counts and sums for operators, coin transactions, balances,
mission attempts, rewards, purchases, and inventory. Run `alembic upgrade head` once.
Migrations 0039–0040 backfill immutable mission reward snapshots, active duration, and
ledger categories.

After migration reconcile:

- `current_balance` against the signed ledger sum;
- `total_earned` against `category = 'earning'`;
- `total_spent` against spending less refunds;
- awarded mission attempts against their reward transaction;
- refunded/expired purchases against exactly one reverse transaction;
- inventory reserved, issued, returned, and available counters.

Any mismatch blocks release. Keep the pre-migration backup until the acceptance matrix
and reconciliation both pass.
