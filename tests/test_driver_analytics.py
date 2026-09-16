from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.models.driver import DriverOrder
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.schemas.driver_shift import DriverScenario
from app.services.driver_shifts import initial_data
from tests.conftest import auth, login, make_user

URL = "/api/v1/admin/learning-analytics/driver"


async def shift(session, user, completed=0, active=False, preview=False, demo=False):
    config = DriverScenario().model_dump()
    data = initial_data(config, "assessment")
    data.update(completed=completed, demo_used=demo)
    item = DriverShift(
        id=str(uuid4()),
        user_id=user.id,
        mode="assessment",
        config=config,
        data=data,
        active_slot=1 if active else None,
        is_preview=preview,
        finished_at=None if active else datetime.now(UTC),
    )
    session.add(item)
    await session.commit()
    return item


async def test_progress_counts_unique_people_and_current_order(client, session, operator):
    trainer = await make_user(session, login="trainer", role=Role.TRAINER)
    untouched = await make_user(session, login="untouched")
    in_progress = await make_user(session, login="progress")
    await shift(session, operator, completed=3)
    current = await shift(session, operator, completed=2, active=True)
    await shift(session, in_progress, completed=1)
    await shift(session, operator, completed=40, preview=True)
    await shift(session, operator, completed=40, demo=True)
    await shift(session, trainer, completed=100)
    session.add(
        DriverOrder(
            id=str(uuid4()),
            user_id=operator.id,
            shift_id=current.id,
            active_slot=1,
            stage="trip",
            origin="A",
            destination="B",
            payment="cash",
            fare=100,
            commission=10,
            park={},
        )
    )
    await session.commit()
    response = await client.get(URL, headers=auth(await login(client, trainer.login)))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["summary"] == {
        "total": 3,
        "not_started": 1,
        "in_progress": 1,
        "completed": 1,
        "completed_orders": 6,
        "active": 1,
    }
    rows = {r["user_id"]: r for r in data["items"]}
    assert rows[operator.id]["current_stage"] == "trip"
    assert rows[operator.id]["session_orders"] == 2
    assert rows[operator.id]["sessions"] == 2
    assert rows[operator.id]["state"] == "completed"
    assert rows[operator.id]["active_shift"] is True
    assert rows[operator.id]["checks"]
    assert rows[untouched.id]["checks"] == []


async def test_multi_operator_tenure_status_and_goal_filters(client, session, operator):
    trainer = await make_user(session, login="trainer", role=Role.TRAINER)
    recent = await make_user(session, login="recent")
    experienced = await make_user(session, login="experienced")
    unknown = await make_user(session, login="unknown")
    future = await make_user(session, login="future")
    inactive = await make_user(session, login="inactive")
    today = datetime.now(UTC).date()
    operator.hired_on = today - timedelta(days=30)
    recent.hired_on = today - timedelta(days=90)
    experienced.hired_on = today - timedelta(days=91)
    future.hired_on = today + timedelta(days=1)
    inactive.is_active = False
    await session.commit()
    await shift(session, operator, completed=3, active=True)
    headers = auth(await login(client, trainer.login))
    for tenure, expected in [
        ("new", operator),
        ("recent", recent),
        ("experienced", experienced),
        ("unknown", unknown),
        ("future", future),
    ]:
        result = (await client.get(URL, headers=headers, params={"tenure": tenure})).json()
        assert [row["user_id"] for row in result["items"]] == [expected.id]
    response = await client.get(
        URL,
        headers=headers,
        params=[
            ("operator_ids", operator.id),
            ("operator_ids", recent.id),
            ("target_orders", 3),
            ("state", "completed"),
            ("activity", "active"),
        ],
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["summary"]["total"] == result["summary"]["completed"] == 1
    assert result["items"][0]["user_id"] == operator.id
    assert len(result["operators"]) == 6
    no_matches = (
        await client.get(
            URL,
            headers=headers,
            params={
                "state": "completed",
                "target_orders": 20,
            },
        )
    ).json()
    assert no_matches["items"] == []
    assert no_matches["summary"]["total"] == 0
    archived = (await client.get(URL, headers=headers, params={"employment": "inactive"})).json()
    assert [row["user_id"] for row in archived["items"]] == [inactive.id]


async def test_permissions_and_validation(client, session, operator, head):
    own = auth(await login(client, operator.login))
    assert (await client.get(URL, headers=own)).status_code == 403
    trainer = await make_user(session, login="trainer", role=Role.TRAINER)
    headers = auth(await login(client, trainer.login))
    assert (
        await client.get(URL, headers=headers, params={"operator_ids": head.id})
    ).status_code == 404
    for params in ({"target_orders": 0}, {"target_orders": 101}, {"tenure": "invalid"}):
        assert (await client.get(URL, headers=headers, params=params)).status_code == 422


@pytest.mark.parametrize("stage", ["offer", "pickup", "waiting", "payment"])
async def test_active_order_stage_is_preserved(client, session, operator, head, stage):
    current = await shift(session, operator, active=True)
    session.add(
        DriverOrder(
            id=str(uuid4()),
            user_id=operator.id,
            shift_id=current.id,
            active_slot=1,
            stage=stage,
            origin="A",
            destination="B",
            payment="card",
            fare=100,
            commission=10,
            park={},
        )
    )
    await session.commit()
    response = await client.get(URL, headers=auth(await login(client, head.login)))
    assert response.status_code == 200
    assert response.json()["items"][0]["current_stage"] == stage
