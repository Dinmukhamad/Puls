"""Заказы с обязательным маршрутом и GPS; совместимость уже начатых старых заказов."""

import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.models.coin import CoinTransaction
from app.models.driver import DriverOrder
from app.models.driver_navigation import DriverNavigation, DriverRouteDraft
from app.models.progress import XpEntry
from app.services import driver_maps, driver_orders
from tests.conftest import auth, login, make_user
from tests.driver_navigation_helpers import (
    A,
    B,
    created,
    fake_route,
    fix,
    prepared,
    set_elapsed,
    step,
)
from tests.test_driver import BASE, act, confirmed_browser


@pytest.fixture
async def driver_setup(client, session, operator, monkeypatch):
    headers = auth(await login(client, operator.login))
    await confirmed_browser(session, operator, headers)
    await client.post(f"{BASE}/start", headers=headers)
    await act(client, headers, "taxi")
    await act(client, headers, "park", park_id="itaxi")
    await act(client, headers, "enter")
    monkeypatch.setattr(driver_maps, "route", fake_route)
    return headers


async def test_route_is_mandatory_and_requires_verified_browser(client, driver_setup):
    h = driver_setup
    r = await client.post(
        f"{BASE}/orders",
        headers=h,
        json={
            "id": str(uuid4()),
            "origin": A["label"],
            "destination": B["label"],
            "location": fix(),
        },
    )
    assert r.status_code == 409
    assert (
        await prepared(client, {k: v for k, v in h.items() if k != "X-Driver-Device"})
    ).status_code == 403


@pytest.mark.parametrize("problem", ["missing", "old", "future", "imprecise", "far", "uncertainty"])
async def test_route_requires_fresh_nearby_location(client, session, driver_setup, problem):
    location, a = fix(), A
    if problem == "missing":
        location = None
    elif problem in ("old", "future"):
        location = fix(now=utcnow() + timedelta(seconds=-31 if problem == "old" else 6))
    elif problem == "imprecise":
        location["accuracy"] = 201
    elif problem == "far":
        a = {**A, "latitude": 43.3}
    else:
        a, location["accuracy"] = {**A, "latitude": A["latitude"] + 0.004}, 100
    r = await client.post(
        f"{BASE}/routes",
        headers=driver_setup,
        json={"pickup": a, "destination": B, "mode": "real", "location": location},
    )
    assert r.status_code == 409, r.text
    assert await session.scalar(select(func.count()).select_from(DriverRouteDraft)) == 0


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude", 91),
        ("longitude", -181),
        ("accuracy", -1),
        ("latitude", True),
        ("longitude", "76.9"),
        ("captured_at", "2026-09-09T10:00:00"),
    ],
)
async def test_invalid_location(client, driver_setup, field, value):
    assert (await prepared(client, driver_setup, location=fix(**{field: value}))).status_code == 422


async def test_routes_overlap_replace_expire_and_fail(
    client, session, driver_setup, operator, monkeypatch
):
    h = driver_setup
    assert (await prepared(client, h, b={**A, "label": "Другой дом"})).status_code == 409
    first, second = (await prepared(client, h)).json(), (await prepared(client, h)).json()
    assert first["id"] != second["id"]
    assert await session.scalar(select(func.count()).select_from(DriverRouteDraft)) == 1
    p = {
        "id": str(uuid4()),
        "route_id": first["id"],
        "origin": A["label"],
        "destination": B["label"],
        "location": fix(),
    }
    assert (await client.post(f"{BASE}/orders", headers=h, json=p)).status_code == 409
    draft = await session.get(DriverRouteDraft, operator.id)
    draft.expires_at = utcnow() - timedelta(seconds=1)
    await session.commit()
    p["route_id"] = second["id"]
    assert (await client.post(f"{BASE}/orders", headers=h, json=p)).status_code == 409

    async def unavailable(*args):
        raise driver_maps.MapUnavailable("Нет маршрута")

    monkeypatch.setattr(driver_maps, "route", unavailable)
    assert (await prepared(client, h)).status_code == 503


@pytest.mark.parametrize("payment", ["cash", "card"])
async def test_full_gps_trip_retry_money_once_no_puls_rewards(
    client, session, driver_setup, monkeypatch, payment
):
    h = driver_setup
    monkeypatch.setattr(driver_orders.secrets, "choice", lambda _: payment)
    coins = await session.scalar(select(func.count()).select_from(CoinTransaction))
    r, p = await created(client, h)
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order["stage"] == "pickup" and order["payment"] == payment
    assert r.json()["navigation"]["can_arrive"]
    assert (await client.post(f"{BASE}/orders", headers=h, json=p)).json()["order"] == order
    assert (await created(client, h))[0].status_code == 409
    assert (await act(client, h, "services")).status_code == 409
    assert (await client.post(f"{BASE}/start", headers=h)).json()["order"] == order
    for action, target, point in [
        ("arrive", "waiting", A),
        ("start_trip", "trip", A),
        ("finish", "complete", B),
    ]:
        await set_elapsed(session, order["id"], 31, allow_movement=True)
        key = str(uuid4())
        r = await step(client, h, order["id"], action, point, request_id=key)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["order"]["stage"] == target
        assert (await step(client, h, order["id"], action, point, request_id=key)).json()[
            "order"
        ] == data["order"]
    assert data["order_summary"]["count"] == 1 and len(data["order_history"]) == 1
    assert data["navigation"] is None
    spec = data["order"]["details"]["navigation"]
    assert spec["score"] == 100 and 800 < spec["actual_distance"] < 1000
    assert await session.scalar(select(func.count()).select_from(DriverNavigation)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == coins
    assert await session.scalar(select(func.count()).select_from(XpEntry)) == 0
    assert (await created(client, h))[0].status_code == 200


async def test_arrival_waiting_finish_use_gps_not_elapsed_time(client, session, driver_setup):
    h, pickup = driver_setup, {**A, "latitude": A["latitude"] + 0.003}
    r, _ = await created(client, h, a=pickup, location=fix())
    oid = r.json()["order"]["id"]
    await set_elapsed(session, oid, 10000, allow_movement=True)
    assert (await step(client, h, oid, "arrive")).status_code == 409
    assert (await step(client, h, oid, "arrive", pickup)).status_code == 200
    assert (await step(client, h, oid, "start_trip", pickup)).status_code == 409
    await set_elapsed(session, oid, 31)
    assert (await step(client, h, oid, "start_trip", pickup)).status_code == 200
    await set_elapsed(session, oid, 10000, allow_movement=True)
    assert (await step(client, h, oid, "finish", pickup)).status_code == 409
    assert (
        await step(
            client, h, oid, "finish", B, location=fix(B, now=utcnow() - timedelta(seconds=31))
        )
    ).status_code == 409
    assert (
        await step(client, h, oid, "finish", B, location=fix(B, accuracy=80))
    ).status_code == 409
    assert (await step(client, h, oid, "finish", B)).status_code == 200


async def test_gps_loss_and_cancel_preserve_stage_cleanup_position(client, session, driver_setup):
    h = driver_setup
    r, _ = await created(client, h)
    oid = r.json()["order"]["id"]
    r = await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={"location": None})
    assert r.json()["navigation"]["status"] == "GPS_LOST"
    assert r.json()["navigation"]["current"]["latitude"] == A["latitude"]
    assert not r.json()["navigation"]["can_arrive"]
    assert (await step(client, h, oid, "arrive", location=None)).status_code == 409
    r = await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={"location": fix()})
    assert r.json()["navigation"]["can_arrive"]
    nav = await session.get(DriverNavigation, oid)
    assert "history" not in nav.data and "positions" not in nav.data
    r = await step(client, h, oid, "cancel")
    assert r.json()["navigation"] is None and r.json()["order_summary"]["count"] == 0
    assert (await created(client, h))[0].status_code == 200


async def test_request_retry_keeps_pickup_payment_and_rejects_new_route(
    client, driver_setup, monkeypatch
):
    h = driver_setup
    r, p = await created(client, h)
    order = r.json()["order"]
    monkeypatch.setattr(driver_orders.secrets, "choice", lambda _: "card")
    p["location"] = fix(B)
    assert (await client.post(f"{BASE}/orders", headers=h, json=p)).json()["order"] == order
    p["route_id"] = str(uuid4())
    assert (await client.post(f"{BASE}/orders", headers=h, json=p)).status_code == 409
    key = str(uuid4())
    assert (await step(client, h, order["id"], "arrive", request_id=key)).status_code == 200
    assert (await step(client, h, order["id"], "start_trip", request_id=key)).status_code == 409


async def test_two_tabs_only_create_one_active_order(client, session, driver_setup):
    route = (await prepared(client, driver_setup)).json()
    p = {
        "route_id": route["id"],
        "origin": A["label"],
        "destination": B["label"],
        "location": fix(),
    }
    responses = await asyncio.gather(
        *(
            client.post(f"{BASE}/orders", headers=driver_setup, json={**p, "id": str(uuid4())})
            for _ in range(2)
        )
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert await session.scalar(select(func.count()).select_from(DriverOrder)) == 1


async def test_orders_and_positions_are_private(client, session, driver_setup):
    r, _ = await created(client, driver_setup)
    oid = r.json()["order"]["id"]
    other = await make_user(session, login="order-other")
    h = auth(await login(client, other.login))
    assert (await client.get(BASE, headers=h)).json()["order"] is None
    assert (
        await client.post(f"{BASE}/orders/{oid}/position", headers=h, json={"location": fix()})
    ).status_code == 403
    assert (await step(client, h, oid, "arrive")).status_code == 403


@pytest.mark.parametrize(
    "values",
    [
        {"origin": " "},
        {"destination": "ab"},
        {"origin": "x" * 161},
        {"origin": "Проспект, 25", "destination": " проспект,  25 "},
        {"fare": 1},
        {"payment": "cash"},
        {"id": "bad"},
    ],
)
async def test_route_validation_and_server_controlled_amounts(client, driver_setup, values):
    p = {"id": str(uuid4()), "origin": A["label"], "destination": B["label"], **values}
    assert (await client.post(f"{BASE}/orders", headers=driver_setup, json=p)).status_code == 422


async def test_legacy_order_can_finish_after_update(client, session, driver_setup, operator):
    order = DriverOrder(
        id=str(uuid4()),
        user_id=operator.id,
        active_slot=1,
        stage="pickup",
        origin=A["label"],
        destination=B["label"],
        payment="card",
        fare=1960,
        commission=39,
        park={"id": "itaxi", "name": "iTaxi", "commission": 2},
        details={},
        version=0,
        events=[],
    )
    session.add(order)
    await session.commit()
    for action in ["arrive", "start_trip", "finish", "pay"]:
        await set_elapsed(session, order.id, 100)
        r = await step(client, driver_setup, order.id, action, location=None)
        assert r.status_code == 200, r.text
    assert r.json()["order"]["stage"] == "complete" and r.json()["order_summary"]["net"] == 1921


def test_pickup_distance_accounts_for_accuracy_boundary_and_dateline():
    from math import degrees

    from app.core.errors import ConflictError
    from app.schemas.driver import DriverGeoPoint, DriverLocation
    from app.services.driver_location import validate_pickup

    now = utcnow()
    fix = DriverLocation(latitude=0, longitude=179.999, accuracy=10, captured_at=now)
    nearby = DriverGeoPoint(latitude=0, longitude=-179.999)
    assert validate_pickup(fix, nearby, now) == nearby.model_dump()
    fix.longitude = 0
    assert validate_pickup(fix, DriverGeoPoint(latitude=degrees(489 / 6371000), longitude=0), now)
    with pytest.raises(ConflictError):
        validate_pickup(fix, DriverGeoPoint(latitude=degrees(491 / 6371000), longitude=0), now)
