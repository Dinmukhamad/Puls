"""City startup evidence stays exact without loading CRM appeals into Python.

Since 2.24.61 the CRM missions count the operator's checked CRM exercises
(app/services/crm_training.py), not the appeals in the shared history: a busy history adds
nothing to a mission and costs the dashboard no read of crm_appeals at all.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select

from app.db.base import utcnow
from app.db.session import SessionLocal, engine
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.models.crm_training import CrmTrainingAttempt
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
        await make_user(session, login=f"startup-mate-{i}", group_id=group.id) for i in range(2)
    ]
    unrelated = await make_user(session, login="startup-unrelated")
    inactive = await make_user(session, login="startup-inactive", group_id=group.id)
    inactive.is_active = False
    phone_ids = [c["id"] for c in default_categories() if "phone_change" in c["rules"]]
    rows = []
    for user in [*teammates, unrelated, inactive]:
        for i in range(300):
            rows.append(
                CrmAppeal(
                    request_id=str(uuid4()),
                    author_id=user.id,
                    author_name=user.full_name,
                    channel="Звонок",
                    phone="+77001234567",
                    license_number="123",
                    contacted_at=utcnow(),
                    park="Test",
                    city="Test",
                    category_ids=phone_ids if i % 2 else [],
                    category_labels=[],
                    is_ticket=i % 4 in (1, 2),
                    status="closed" if i % 4 in (0, 1) else "new",
                )
            )
    session.add_all(rows)
    await session.commit()
    return teammates, unrelated


def attempt(user, key, phase):
    now = datetime.now(UTC)
    return CrmTrainingAttempt(
        user_id=user.id,
        task_key=key,
        revision=1,
        snapshot={},
        phase=phase,
        started_at=now,
        passed_at=now if phase == "passed" else None,
        checks=[],
    )


async def test_busy_history_is_no_mission_proof_and_checked_exercises_count_once(
    session, busy_team
):
    teammates, unrelated = busy_team
    operator, mate, _ = teammates
    idle = await make_user(session, login="startup-idle")
    session.add_all(
        [
            attempt(operator, "crm_first", "passed"),
            attempt(operator, "crm_phone", "passed"),
            attempt(operator, "crm_closed", "started"),
            attempt(mate, "crm_first", "started"),
        ]
    )
    await session.commit()
    facts = await city.evidence(session, [*(u.id for u in teammates), idle.id])
    assert unrelated.id not in facts
    crm = ("appeals", "phone", "closed")
    # 300 appeals each, phone changes and closed tickets among them: none of it is proof.
    assert {key: facts[operator.id][key] for key in crm} == {"appeals": 1, "phone": 1, "closed": 0}
    # A started request shows its mission as begun, nothing more.
    assert facts[operator.id]["tickets"] == 1
    assert {key: facts[mate.id][key] for key in crm} == dict.fromkeys(crm, 0)
    assert "tickets" not in facts[mate.id]
    assert facts[idle.id] == city.empty_facts()


async def test_warm_dashboard_never_reads_the_appeals_and_changes_no_coins(
    session, operator, busy_team
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
    assert len(statements) <= 18
    assert crm_reads == []
    # The group city is gone: the teammates' work is no longer read for its quarters.
    assert "group" not in data
    assert data["balance"] == data["available"] == data["xp"] == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
