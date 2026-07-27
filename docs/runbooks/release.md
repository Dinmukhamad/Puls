# Release runbook

1. Run `ruff check app tests scripts`, `pytest --cov=app`, `npm test`, `npm run build`,
   `pip-audit -r requirements.txt`, and `npm audit --audit-level=high`.
2. On an empty PostgreSQL database run `alembic upgrade head`; `/ready` must report
   `ready` and the expected `release_id`.
3. Take a database backup before production migration. Deploy one application
   instance only after migrations finish.
4. Run the role acceptance matrix from `acceptance.md` and one synthetic
   create/update/refund flow.
5. Watch HTTP 5xx, 403 spikes, login 429, report import failures, mission completion
   time, and ledger reconciliation for at least 30 minutes.

Rollback: stop writes, restore the pre-release backup, deploy the previous immutable
release, then verify `/health`, `/ready`, balances, orders, and mission rewards.
