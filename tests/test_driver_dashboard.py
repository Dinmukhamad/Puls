from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.models.driver import DriverOrder
from app.models.enums import Role
from app.services.driver_shifts import checked_result
from tests.conftest import auth, login, make_user
from tests.test_driver_analytics import URL, shift


async def order(session, user, training, *, stage="complete", when=None, events=None):
    at = when or datetime.now(UTC)
    result = DriverOrder(
        id=str(uuid4()),
        user_id=user.id,
        shift_id=training.id,
        active_slot=None if stage in ("complete", "cancelled") else 1,
        stage=stage,
        origin="Точка А",
        destination="Точка Б",
        payment="cash",
        fare=100,
        commission=10,
        park={},
        events=events or [],
        created_at=at,
        stage_started_at=at,
        finished_at=at if stage == "complete" else None,
    )
    session.add(result)
    await session.commit()
    return result


async def test_dashboard_filters_skills_scores_and_daily_orders(client, session, operator, head):
    other = await make_user(session, login="other-dashboard")
    current = await shift(session, operator, completed=1)
    current.config = {**current.config, "require_photo": False}
    current.data = {**current.data, "training_pass_percent": 70, "invalid_actions": 2}
    current.result = {**checked_result(current, current.data), "score": 60}
    await session.commit()
    await order(session, operator, current)
    await order(session, operator, current, stage="cancelled")
    old = await shift(session, operator, completed=1)
    old.created_at = datetime.now(UTC) - timedelta(days=40)
    old.finished_at = old.created_at + timedelta(hours=1)
    old.result = {"score": None, "checks": []}
    await session.commit()
    await order(session, operator, old, when=old.finished_at)
    await order(session, other, await shift(session, other, completed=1))
    for kwargs in ({"preview": True}, {"demo": True}):
        await order(session, operator, await shift(session, operator, **kwargs))
    response = await client.get(
        URL,
        headers=auth(await login(client, head.login)),
        params={"operator_ids": operator.id, "days": 14},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["activity"]) == 14
    assert sum(p["orders"] for p in data["activity"]) == 1
    assert sum(p["started"] for p in data["activity"]) == 1
    assert data["activity"][-1]["date"] == datetime.now(UTC).date().isoformat()
    assert data["insights"]["average_score"] == 60
    assert data["insights"]["scored_sessions"] == 1
    assert data["items"][0]["attention"] == ["errors", "failed"]
    photo = next(s for s in data["skills"] if s["key"] == "photo")
    assert photo["not_required"] == 1 and photo["done"] == photo["pending"] == 0
    assert data["insights"]["error_breakdown"][-1]["value"] == 2


async def test_personal_history_excludes_previews_and_keeps_snapshot(client, session, operator):
    trainer = await make_user(session, login="trainer-history", role=Role.TRAINER)
    old = await shift(session, operator, completed=5)
    old.data = {**old.data, "training_pass_percent": 80}
    old.result = {
        "score": 81,
        "checks": [
            {"key": "orders", "done": True, "title": "Выполнить заказы", "path": "Заказы"},
        ],
    }
    await session.commit()
    await shift(session, operator, preview=True)
    await shift(session, operator, demo=True)
    response = await client.get(
        f"{URL}/operators/{operator.id}", headers=auth(await login(client, trainer.login))
    )
    data = response.json()
    assert response.status_code == 200
    assert len(data["sessions"]) == 1
    assert data["completed_orders"] == 5
    assert data["sessions"][0]["passed"] is True
    assert data["sessions"][0]["checks"][0]["done"] is True
    assert datetime.fromisoformat(data["sessions"][0]["created_at"]).utcoffset() == timedelta(0)
    assert data["average_score"] == 81


async def test_journey_uses_real_events_without_sensitive_payloads(client, session, operator, head):
    training = await shift(session, operator, completed=1)
    start = datetime.now(UTC) - timedelta(hours=1)
    training.created_at = start
    training.finished_at = start + timedelta(minutes=30)
    trip = await order(
        session,
        operator,
        training,
        events=[
            {
                "action": "accept",
                "to": "pickup",
                "at": (start + timedelta(minutes=3)).isoformat(),
                "fingerprint": {"secret": "PRIVATE_DEVICE_DATA"},
            },
            {"action": "pay", "to": "complete", "at": (start + timedelta(minutes=20)).isoformat()},
        ],
        when=start + timedelta(minutes=20),
    )
    training.events = [
        {"action": "hint", "at": (start + timedelta(minutes=1)).isoformat()},
        {
            "action": "support_answer",
            "at": (start + timedelta(minutes=2)).isoformat(),
            "details": {"correct": False, "token": "PRIVATE_TOKEN"},
        },
        {
            "action": "error",
            "at": (start + timedelta(minutes=4)).isoformat(),
            "details": {"reason": "Сначала выберите парк"},
        },
        {
            "action": "order_pay",
            "at": (start + timedelta(minutes=20)).isoformat(),
            "details": {"order_id": trip.id},
        },
    ]
    await session.commit()
    response = await client.get(
        f"{URL}/operators/{operator.id}/shifts/{training.id}",
        headers=auth(await login(client, head.login)),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "PRIVATE_" not in response.text and "fingerprint" not in response.text
    assert [e["at"] for e in data["events"]] == sorted(e["at"] for e in data["events"])
    assert len([e for e in data["events"] if "оплачен" in e["title"]]) == 1
    assert len([e for e in data["events"] if e["kind"] == "error"]) == 2
    assert data["orders"][0]["timeline"][0]["stage"] == "pickup"
    assert data["session"]["elapsed_seconds"] == 1800


async def test_journey_access_is_scoped_to_person_and_excludes_preview(
    client, session, operator, head
):
    other = await make_user(session, login="other-journey")
    someone_else = await shift(session, other)
    preview = await shift(session, operator, preview=True)
    demo = await shift(session, operator, demo=True)
    headers = auth(await login(client, head.login))
    for training in (someone_else, preview, demo):
        response = await client.get(
            f"{URL}/operators/{operator.id}/shifts/{training.id}", headers=headers
        )
        assert response.status_code == 404
    assert (await client.get(f"{URL}/operators/{head.id}", headers=headers)).status_code == 404
    own = auth(await login(client, operator.login))
    assert (await client.get(f"{URL}/operators/{operator.id}", headers=own)).status_code == 403
    assert (
        await client.get(f"{URL}/operators/{operator.id}/shifts/{someone_else.id}", headers=own)
    ).status_code == 403


async def test_empty_participant_and_period_validation(client, operator, head):
    headers = auth(await login(client, head.login))
    data = (await client.get(f"{URL}/operators/{operator.id}", headers=headers)).json()
    assert data["sessions"] == [] and data["average_score"] is None
    for days in (0, 91):
        assert (await client.get(URL, headers=headers, params={"days": days})).status_code == 422
    report = (await client.get(URL, headers=headers, params={"days": 30})).json()
    assert len(report["activity"]) == 30
    assert all(s["not_started"] == 1 for s in report["skills"])


async def test_recent_order_activity_prevents_false_stale_warning(client, session, operator, head):
    training = await shift(session, operator, active=True)
    training.created_at = datetime.now(UTC) - timedelta(days=3)
    await session.commit()
    headers = auth(await login(client, head.login))
    stale = (await client.get(URL, headers=headers)).json()
    assert "stale" in stale["items"][0]["attention"]
    await order(session, operator, training, stage="trip")
    fresh = (await client.get(URL, headers=headers)).json()
    assert "stale" not in fresh["items"][0]["attention"]
