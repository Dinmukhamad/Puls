from datetime import timedelta
from uuid import uuid4

from app.db.base import utcnow
from app.models.driver import DriverOrder
from app.models.driver_navigation import DriverNavigation
from tests.test_driver import BASE

A = {"latitude": 43.2389, "longitude": 76.8897, "label": "Абай, 10"}
B = {"latitude": 43.2469, "longitude": 76.8897, "label": "Достык, 25"}


def fix(point=A, now=None, **values):
    return {
        "latitude": point["latitude"],
        "longitude": point["longitude"],
        "accuracy": 10,
        "captured_at": (now or utcnow()).isoformat(),
        **values,
    }


async def fake_route(session, a, b, transport="car"):
    from app.services.driver_route_math import distance

    return {
        "coordinates": [[a["longitude"], a["latitude"]], [b["longitude"], b["latitude"]]],
        "distance": round(distance(a, b), 1),
        "duration": 100,
    }


async def prepared(client, headers, *, a=A, b=B, mode="real", location=None):
    return await client.post(
        f"{BASE}/routes",
        headers=headers,
        json={"pickup": a, "destination": b, "mode": mode, "location": location or fix(a)},
    )


async def created(client, headers, *, a=A, b=B, mode="real", location=None):
    route = await prepared(client, headers, a=a, b=b, mode=mode, location=location)
    assert route.status_code == 200, route.text
    payload = {
        "id": str(uuid4()),
        "route_id": route.json()["id"],
        "origin": a["label"],
        "destination": b["label"],
        "location": location or fix(a),
    }
    return await client.post(f"{BASE}/orders", headers=headers, json=payload), payload


async def set_elapsed(session, order_id, seconds, *, allow_movement=False):
    order = await session.get(DriverOrder, order_id)
    await session.refresh(order)
    order.stage_started_at = utcnow() - timedelta(seconds=seconds)
    if allow_movement:
        nav = await session.get(DriverNavigation, order_id)
        await session.refresh(nav)
        nav.current = {**nav.current, "captured_at": (utcnow() - timedelta(seconds=30)).isoformat()}
    await session.commit()


async def step(client, headers, order_id, action, point=A, **extra):
    return await client.put(
        f"{BASE}/orders/{order_id}/action",
        headers=headers,
        json={"action": action, "request_id": str(uuid4()), "location": fix(point), **extra},
    )
