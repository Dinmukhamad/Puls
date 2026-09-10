from datetime import timedelta
from uuid import uuid4

from app.db.base import utcnow
from app.models.driver_navigation import DriverNavigation
from app.models.enums import Role
from app.services import driver_maps
from tests.driver_navigation_helpers import A, B, created, fix, prepared, set_elapsed, step
from tests.test_driver import BASE
from tests.test_driver_orders import driver_setup as _driver_setup

driver_setup = _driver_setup
from tests.test_driver_shifts import command, start


async def test_assessment_disallows_virtual_and_operator_demo(client, driver_setup):
    shift = await start(client, driver_setup)
    assert shift["config"]["real_location_required"]
    assert (await prepared(client, driver_setup, mode="virtual")).status_code == 403
    assert (await prepared(client, driver_setup, mode="demo")).status_code == 403


async def test_virtual_practice_pause_resume_cannot_teleport(client, session, driver_setup):
    h = driver_setup
    shift = await start(client, h, "free")
    await command(client, h, shift, "online")
    r, _ = await created(client, h, mode="virtual")
    assert r.status_code == 200, r.text
    oid = r.json()["order"]["id"]
    assert (await step(client, h, oid, "arrive", location=None)).status_code == 200
    await set_elapsed(session, oid, 31)
    assert (await step(client, h, oid, "start_trip", location=None)).status_code == 200
    control = f"{BASE}/orders/{oid}/demo"
    key = str(uuid4())
    payload = {"action": "pause", "request_id": key}
    r = await client.post(control, headers=h, json=payload)
    assert r.json()["navigation"]["status"] == "PAUSED"
    position = r.json()["navigation"]["current"]
    again = await client.post(control, headers=h, json=payload)
    assert again.json()["order"] == r.json()["order"]
    await set_elapsed(session, oid, 100)
    r = await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={})
    assert r.json()["navigation"]["current"]["latitude"] == position["latitude"]
    assert not r.json()["navigation"]["can_finish"]
    assert (
        await client.post(
            control, headers=h, json={"action": "advance", "request_id": str(uuid4())}
        )
    ).status_code == 403
    await client.post(control, headers=h, json={"action": "resume", "request_id": str(uuid4())})
    await set_elapsed(session, oid, 100)
    r = await step(client, h, oid, "finish", location=None)
    assert r.status_code == 200, r.text
    assert r.json()["order"]["details"]["navigation"]["score"] is None
    done = await command(client, h, shift, "finish")
    assert done.json()["shift"]["result"]["score"] is None


async def test_admin_demo_never_counts_as_assessment(
    client, session, driver_setup, operator, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEVELOPER_LOGIN", operator.login)
    from app.models.access import AccessRule

    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="training", effect="allow"
        )
    )
    operator.role = Role.ADMIN
    await session.commit()
    h = driver_setup
    shift = await start(client, h)
    for i in range(5):
        await command(client, h, shift, "photo_step", step=i)
    await command(client, h, shift, "photo_submit")
    await command(client, h, shift, "online")
    r, _ = await created(client, h, mode="demo")
    assert r.status_code == 200, r.text
    oid = r.json()["order"]["id"]
    await step(client, h, oid, "arrive", location=None)
    await set_elapsed(session, oid, 31)
    await step(client, h, oid, "start_trip", location=None)
    key = str(uuid4())
    p = {"action": "advance", "meters": 1000, "request_id": key}
    r = await client.post(f"{BASE}/orders/{oid}/demo", headers=h, json=p)
    assert r.status_code == 200, r.text
    assert r.json()["navigation"]["can_finish"]
    repeat = await client.post(f"{BASE}/orders/{oid}/demo", headers=h, json=p)
    assert repeat.json()["order"] == r.json()["order"]
    assert (await step(client, h, oid, "finish", location=None)).status_code == 200
    result = await command(client, h, shift, "finish")
    assert result.json()["shift"]["result"]["score"] is None


async def test_deviation_reroutes_and_provider_failure_keeps_last_route(
    client, session, driver_setup, monkeypatch
):
    h = driver_setup
    r, _ = await created(client, h)
    oid = r.json()["order"]["id"]
    await step(client, h, oid, "arrive")
    await set_elapsed(session, oid, 31)
    await step(client, h, oid, "start_trip")
    await set_elapsed(session, oid, 31, allow_movement=True)
    away = {**A, "longitude": A["longitude"] + 0.004}
    r = await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={"location": fix(away)})
    assert r.status_code == 200, r.text
    nav = r.json()["navigation"]
    assert nav["reroutes"] == 1 and nav["route"]["coordinates"][0][0] == away["longitude"]
    stored = await session.get(DriverNavigation, oid)
    await session.refresh(stored)
    stored.data = {**stored.data, "rerouted_at": (utcnow() - timedelta(seconds=31)).isoformat()}
    await session.commit()
    await set_elapsed(session, oid, 31, allow_movement=True)

    async def unavailable(*args):
        raise driver_maps.MapUnavailable("Offline")

    monkeypatch.setattr(driver_maps, "route", unavailable)
    r = await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={"location": fix(A)})
    assert r.json()["navigation"]["route"] == nav["route"]
    assert r.json()["order"]["stage"] == "trip"
    assert "Не удалось" in r.json()["navigation"]["message"]


async def test_destination_change_replaces_route_and_original_b_cannot_finish(
    client, session, driver_setup
):
    h = driver_setup
    r, _ = await created(client, h)
    oid = r.json()["order"]["id"]
    await step(client, h, oid, "arrive")
    await set_elapsed(session, oid, 31)
    await step(client, h, oid, "start_trip")
    target = {**B, "latitude": B["latitude"] + 0.005, "label": "Новая точка Б"}
    payload = {"request_id": str(uuid4()), "destination": target, "location": fix()}
    r = await client.put(f"{BASE}/orders/{oid}/destination", headers=h, json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["order"]["destination"] == target["label"]
    assert r.json()["navigation"]["route"]["coordinates"][-1][1] == target["latitude"]
    repeat = await client.put(f"{BASE}/orders/{oid}/destination", headers=h, json=payload)
    assert repeat.json()["order"] == r.json()["order"]
    await set_elapsed(session, oid, 31, allow_movement=True)
    assert (await step(client, h, oid, "finish", B)).status_code == 409
    assert (await step(client, h, oid, "finish", target)).status_code == 200


async def test_instant_gps_jump_and_simulation_cannot_finish_real_order(
    client, session, driver_setup
):
    h = driver_setup
    r, _ = await created(client, h)
    oid = r.json()["order"]["id"]
    await step(client, h, oid, "arrive")
    await set_elapsed(session, oid, 31)
    await step(client, h, oid, "start_trip")
    r = await step(client, h, oid, "finish", B)
    assert r.status_code == 409
    assert (
        await client.post(
            f"{BASE}/orders/{oid}/demo",
            headers=h,
            json={"action": "advance", "request_id": str(uuid4())},
        )
    ).status_code == 403


async def test_paid_wait_fee_uses_actual_elapsed_minutes(client, session, driver_setup):
    h = driver_setup
    r, _ = await created(client, h)
    oid = r.json()["order"]["id"]
    await step(client, h, oid, "arrive")
    await set_elapsed(session, oid, 155)
    r = await step(client, h, oid, "start_trip")
    assert r.status_code == 200, r.text
    from app.schemas.driver_shift import DriverScenario

    assert r.json()["order"]["details"]["waiting_fee"] == 2 * DriverScenario().wait_per_minute


async def test_road_snapping_must_reach_selected_destination(client, driver_setup, monkeypatch):
    async def remote_road(*args):
        return {"coordinates": [[0, 0], [0, 0.01]], "distance": 1112, "duration": 100}

    monkeypatch.setattr(driver_maps, "route", remote_road)
    assert (await prepared(client, driver_setup)).status_code == 503
