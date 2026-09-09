import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.models.coin import CoinTransaction
from app.models.driver import DriverOrder
from app.models.enums import Role
from app.models.progress import XpEntry
from app.services import driver_orders
from tests.conftest import auth, login, make_user
from tests.test_driver import BASE, act, confirmed_browser


@pytest.fixture
async def driver_setup(client, session, operator, monkeypatch):
    headers = auth(await login(client, operator.login))
    await confirmed_browser(session, operator, headers)
    await client.post(f"{BASE}/start", headers=headers)
    await act(client, headers, "taxi")
    await act(client, headers, "park", park_id="itaxi")
    await act(client, headers, "enter")
    now = [utcnow()]
    monkeypatch.setattr(driver_orders, "utcnow", lambda: now[0])

    async def step(order, action, *, advance=True, request_id=None):
        if advance:
            now[0] += timedelta(seconds=100)
        return await client.put(
            f"{BASE}/orders/{order['id']}/action",
            headers=headers,
            json={"action": action, "request_id": request_id or str(uuid4())},
        )

    return headers, step


def location_payload():
    point = {"latitude": 43.2389, "longitude": 76.8897}
    return {
        "pickup": point,
        "location": {**point, "accuracy": 10, "captured_at": driver_orders.utcnow().isoformat()},
    }


async def create(client, headers, **overrides):
    payload = {"id": str(uuid4()), "origin": "Учебная улица, 10", "destination": "Проспект, 25"}
    payload.update(location_payload())
    payload.update(overrides)
    return await client.post(f"{BASE}/orders", headers=headers, json=payload)


@pytest.mark.parametrize(
    "problem", ["missing", "missing_pickup", "old", "future", "imprecise", "far", "uncertainty"]
)
async def test_new_order_requires_fresh_nearby_location(client, session, driver_setup, problem):
    headers, _ = driver_setup
    payload = location_payload()
    if problem == "missing":
        payload["location"] = None
    elif problem == "missing_pickup":
        payload["pickup"] = None
    elif problem in ("old", "future"):
        seconds = -31 if problem == "old" else 6
        payload["location"]["captured_at"] = (
            driver_orders.utcnow() + timedelta(seconds=seconds)
        ).isoformat()
    elif problem == "imprecise":
        payload["location"]["accuracy"] = 201
    elif problem == "far":
        payload["pickup"] = {"latitude": 43.3, "longitude": 76.9}
    else:
        # 445 м + погрешность 100 м выходит за радиус подачи.
        payload["pickup"] = {**payload["pickup"], "latitude": 43.2429}
        payload["location"]["accuracy"] = 100
    response = await create(client, headers, **payload)
    assert response.status_code == 409, response.text
    assert await session.scalar(select(func.count()).select_from(DriverOrder)) == 0


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
async def test_location_rejects_invalid_coordinates_and_unzoned_time(
    client, driver_setup, field, value
):
    headers, _ = driver_setup
    payload = location_payload()
    payload["location"][field] = value
    assert (await create(client, headers, **payload)).status_code == 422


async def test_pickup_is_persisted_without_location_history_and_retry_does_not_move_it(
    client, session, driver_setup
):
    headers, step = driver_setup
    payload = location_payload()
    payload["pickup"] = {"latitude": 43.2409, "longitude": 76.8897}
    order = (await create(client, headers, **payload)).json()["order"]
    assert order["details"] == {"pickup": payload["pickup"]}
    await step(order, "offer")  # The original fix is now stale.
    retry = await create(client, headers, id=order["id"], **payload)
    assert retry.status_code == 200, retry.text
    assert retry.json()["order"]["details"]["pickup"] == payload["pickup"]
    payload["pickup"] = {"latitude": 43.239, "longitude": 76.8897}
    assert (await create(client, headers, id=order["id"], **payload)).status_code == 409
    restored = (await client.get(BASE, headers=headers)).json()["order"]
    assert restored["details"] == order["details"]
    assert await session.scalar(select(func.count()).select_from(DriverOrder)) == 1


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


@pytest.mark.parametrize("payment", ["cash", "card"])
async def test_full_order_both_payments_repeat_and_no_puls_rewards(
    client,
    session,
    driver_setup,
    monkeypatch,
    payment,
):
    headers, step = driver_setup
    monkeypatch.setattr(driver_orders.secrets, "choice", lambda options: payment)
    coins_before = await session.scalar(select(func.count()).select_from(CoinTransaction))
    created = await create(client, headers)
    assert created.status_code == 200, created.text
    order = created.json()["order"]
    assert order["payment"] == payment
    assert order["commission"] == 39 and order["net"] == 1921
    assert (await create(client, headers)).status_code == 409
    assert (await act(client, headers, "services")).status_code == 409
    # Повторный запуск и перезагрузка не сбрасывают активную поездку.
    resumed = (await client.post(f"{BASE}/start", headers=headers)).json()
    assert resumed["profile"]["stage"] == "offline"
    assert resumed["order"] == order
    for action, stage in [
        ("offer", "offer"),
        ("accept", "pickup"),
        ("arrive", "waiting"),
        ("start_trip", "trip"),
        ("finish", "payment"),
        ("pay", "complete"),
    ]:
        key = str(uuid4())
        response = await step(order, action, request_id=key)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["order"]["stage"] == stage
        assert data["order"]["payment"] == payment
        assert data["order_summary"]["count"] == (1 if stage == "complete" else 0)
        assert (await client.get(BASE, headers=headers)).json()["order"] == data["order"]
        duplicate = await step(order, action, request_id=key, advance=False)
        assert duplicate.status_code == 200
        assert duplicate.json()["order"] == data["order"]
    assert data["order_summary"] == {"count": 1, "gross": 1960, "commission": 39, "net": 1921}
    assert len(data["order_history"]) == 1
    assert len(data["order"]["events"]) == 6
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == coins_before
    assert await session.scalar(select(func.count()).select_from(XpEntry)) == 0
    second = await create(client, headers, origin="Другой адрес, 3")
    assert second.status_code == 200
    assert second.json()["order"]["id"] != order["id"]
    assert second.json()["order_summary"]["count"] == 1


async def test_order_request_retry_keeps_original_payment(client, driver_setup, monkeypatch):
    headers, step = driver_setup
    order_id = str(uuid4())
    monkeypatch.setattr(driver_orders.secrets, "choice", lambda options: "cash")
    first = (await create(client, headers, id=order_id)).json()["order"]
    monkeypatch.setattr(driver_orders.secrets, "choice", lambda options: "card")
    assert (await create(client, headers, id=order_id)).json()["order"] == first
    assert (await create(client, headers, id=order_id, origin="Другой адрес")).status_code == 409
    key = str(uuid4())
    assert (await step(first, "offer", request_id=key)).status_code == 200
    assert (await step(first, "accept", request_id=key)).status_code == 409


async def test_cannot_skip_steps_or_arrive_before_route_end(client, driver_setup):
    headers, step = driver_setup
    order = (await create(client, headers)).json()["order"]
    assert (await step(order, "offer", advance=False)).status_code == 409
    for action in ("accept", "arrive", "start_trip", "finish", "pay"):
        assert (await step(order, action, advance=False)).status_code == 409
    await step(order, "offer")
    await step(order, "accept")
    assert (await step(order, "arrive", advance=False)).status_code == 409
    await step(order, "arrive")
    assert (await step(order, "start_trip", advance=False)).status_code == 409
    await step(order, "start_trip")
    assert (await step(order, "finish", advance=False)).status_code == 409
    assert (await step(order, "cancel")).status_code == 409
    await step(order, "finish")
    assert (await step(order, "pay", advance=False)).status_code == 409


async def test_cancel_has_no_income_and_releases_active_order(client, driver_setup):
    headers, step = driver_setup
    order = (await create(client, headers)).json()["order"]
    await step(order, "offer")
    await step(order, "accept")
    response = await step(order, "cancel")
    assert response.status_code == 200
    assert response.json()["order"]["stage"] == "cancelled"
    assert response.json()["order_summary"]["count"] == 0
    assert response.json()["order_history"] == []
    assert (await step(order, "arrive")).status_code == 409
    assert (await create(client, headers)).status_code == 200


async def test_two_tabs_can_only_create_one_active_order(client, session, driver_setup):
    headers, _ = driver_setup
    responses = await asyncio.gather(create(client, headers), create(client, headers))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert await session.scalar(select(func.count()).select_from(DriverOrder)) == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"origin": "  "},
        {"destination": "ab"},
        {"origin": "x" * 161},
        {"origin": " Проспект,   25 ", "destination": "проспект, 25"},
        {"payment": "cash"},
        {"fare": 1},
        {"id": "not-a-uuid"},
    ],
)
async def test_route_validation_and_server_controlled_amounts(client, driver_setup, overrides):
    headers, _ = driver_setup
    assert (await create(client, headers, **overrides)).status_code == 422


async def test_order_is_private_and_requires_confirmed_browser(client, session, driver_setup):
    headers, step = driver_setup
    order = (await create(client, headers)).json()["order"]
    unverified = {k: v for k, v in headers.items() if k != "X-Driver-Device"}
    assert (await create(client, unverified)).status_code == 403
    other = await make_user(session, login="order-other", role=Role.OPERATOR)
    other_headers = auth(await login(client, other.login))
    # Различный номер и Telegram позволяют независимо подтвердить другой аккаунт.
    other.phone = "+77001234568"
    import secrets

    from app.models.driver_auth import DriverDevice, TelegramLink
    from app.services.driver_auth import device_hash

    token = secrets.token_urlsafe(32)
    session.add(TelegramLink(user_id=other.id, chat_id=987654, version=1))
    session.add(
        DriverDevice(
            secret_hash=device_hash(other.id, token),
            user_id=other.id,
            phone=other.phone,
            telegram_version=1,
            valid_until=utcnow() + timedelta(days=30),
        )
    )
    await session.commit()
    other_headers["X-Driver-Device"] = token
    await client.post(f"{BASE}/start", headers=other_headers)
    await act(client, other_headers, "taxi")
    await act(client, other_headers, "park", park_id="itaxi")
    await act(client, other_headers, "enter")
    assert (await client.get(BASE, headers=other_headers)).json()["order"] is None
    assert (await create(client, other_headers, id=order["id"])).status_code == 409
    response = await client.put(
        f"{BASE}/orders/{order['id']}/action",
        headers=other_headers,
        json={"action": "offer", "request_id": str(uuid4())},
    )
    assert response.status_code == 404
    assert await session.scalar(select(func.count()).select_from(DriverOrder)) == 1
