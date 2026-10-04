"""City startup evidence stays exact without loading every CRM appeal into Python."""

from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql, sqlite

from app.db.base import utcnow
from app.db.session import SessionLocal, engine
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.services import city
from app.services.crm_catalog import default_categories
from tests.conftest import make_group, make_user

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def busy_team(session, operator):
    group = await make_group(session, code="startup-perf")
    operator.group_id = group.id
    await session.commit()
    teammates = [operator] + [
        await make_user(session, login=f"startup-mate-{i}", group_id=group.id)
        for i in range(2)
    ]
    unrelated = await make_user(session, login="startup-unrelated")
    inactive = await make_user(session, login="startup-inactive", group_id=group.id)
    inactive.is_active = False
    phone_ids = [c["id"] for c in default_categories() if "phone_change" in c["rules"]]
    rows = []
    for user in [*teammates, unrelated, inactive]:
        for i in range(300):
            categories = ([phone_ids[0], phone_ids[0]] if i % 4 == 0 else phone_ids
                          if i % 4 == 1 else [phone_ids[0] + "-suffix"] if i % 4 == 2 else [])
            rows.append(CrmAppeal(
                request_id=str(uuid4()), author_id=user.id, author_name=user.full_name,
                channel="Звонок", phone="+77001234567", license_number="123", contacted_at=utcnow(),
                park="Test", city="Test", category_ids=categories, category_labels=[],
                is_ticket=i % 4 in (1, 2), status="closed" if i % 4 in (0, 1) else "new",
            ))
    session.add_all(rows)
    await session.commit()
    return teammates, unrelated


async def test_busy_team_evidence_keeps_exact_phone_ticket_and_foreign_counts(session, busy_team):
    teammates, unrelated = busy_team
    idle = await make_user(session, login="startup-idle")
    facts = await city.evidence(session, [*(u.id for u in teammates), idle.id])
    assert unrelated.id not in facts
    for user in teammates:
        assert {key: facts[user.id][key] for key in ("appeals", "phone", "tickets", "closed")} == {
            "appeals": 300, "phone": 150, "tickets": 150, "closed": 75,
        }
    assert facts[idle.id] == city.empty_facts()
    phone_ids = {c["id"] for c in default_categories() if "phone_change" in c["rules"]}
    rows = (await session.execute(city.crm_evidence_query(
        [*(u.id for u in teammates), idle.id], phone_ids, "sqlite",
    ))).all()
    assert len(rows) == len(teammates) == 3


async def test_crm_aggregate_compiles_exact_category_membership_for_both_database_engines():
    for name, dialect in [("sqlite", sqlite.dialect()), ("postgresql", postgresql.dialect())]:
        query = city.crm_evidence_query([1, 2], {"phone-category"}, name)
        sql = str(query.compile(dialect=dialect))
        assert "GROUP BY crm_appeals.author_id" in sql
        assert "EXISTS" in sql and "LIKE" not in sql
        assert ("json_array_elements_text" if name == "postgresql" else "json_each") in sql


async def test_warm_dashboard_batches_team_evidence_without_changing_city_or_coins(
    session, operator, busy_team,
):
    # Daily questions are already dealt, as on a return from another application section.
    async with SessionLocal() as warm:
        await city.dashboard(warm, operator)
    statements = []

    def record(_connection, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        async with SessionLocal() as reading:
            data = await city.dashboard(reading, operator)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    crm_reads = [sql for sql in statements if "FROM crm_appeals" in sql]
    print(f"warm_city_startup_sql={len(statements)} crm_reads={len(crm_reads)}")
    assert len(statements) <= 19
    assert len(crm_reads) == 1
    assert "GROUP BY crm_appeals.author_id" in crm_reads[0]
    assert data["group"]["mine"] == {
        "missions": 0, "materials": 0, "quests": 0, "orders": 0,
        "appeals": 300, "closed": 75, "points": 1275,
    }
    assert [project["stage"] for project in data["group"]["projects"]] == [
        "done", "done", "done", "done", "done", "frame",
    ]
    assert not data["group"]["small"]
    assert data["balance"] == data["available"] == data["xp"] == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
