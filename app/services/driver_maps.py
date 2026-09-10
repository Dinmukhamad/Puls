"""Серверный доступ к Photon/OSRM: фиксированные адреса, кеш и общий лимит БД."""

import asyncio
import math
import time
from datetime import UTC, timedelta

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import DomainError
from app.db.base import utcnow
from app.models.driver_navigation import DriverMapRate

_cache = {}


class MapUnavailable(DomainError):
    status_code = 503
    code = "map_unavailable"


async def reserve(session, provider):
    from app.db.session import SessionLocal

    async with SessionLocal() as limits:
        # Один лимит на всё приложение, включая несколько процессов/инстансов.
        if limits.bind.dialect.name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        else:
            from sqlalchemy.dialects.postgresql import insert
        await limits.execute(
            insert(DriverMapRate)
            .values(provider=provider, next_at=utcnow())
            .on_conflict_do_nothing(index_elements=["provider"])
        )
        row = await limits.scalar(
            select(DriverMapRate)
            .where(DriverMapRate.provider == provider)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        delay = (row.next_at.replace(tzinfo=UTC) - utcnow()).total_seconds()
        if delay > 0:
            await asyncio.sleep(min(delay, 1.1))
        row.next_at = utcnow() + timedelta(seconds=1.1)
        await limits.flush()
        await limits.commit()


async def get_json(session, provider, url, params):
    key = (url, tuple(sorted(params.items())))
    old = _cache.get(key)
    if old and old[0] > time.monotonic():
        return old[1]
    await reserve(session, provider)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(
                url,
                params=params,
                headers={
                    "User-Agent": "Puls-Driver-Simulator/2.2 (https://github.com/Dinmukhamad/Pulse)",
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            if len(response.content) > 2_000_000:
                raise ValueError("Oversized map response")
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid map response")
    except (httpx.HTTPError, ValueError) as exc:
        raise MapUnavailable("Сервис карты временно недоступен. Повторите запрос.") from exc
    if len(_cache) >= 128:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + 300, data)
    return data


def feature(value):
    try:
        lng, lat = value["geometry"]["coordinates"][:2]
        if not all(isinstance(x, float | int) and math.isfinite(x) for x in (lng, lat)):
            return None
        if abs(lat) > 90 or abs(lng) > 180:
            return None
        p = value["properties"]
        street = " ".join(str(p[x]) for x in ("street", "housenumber") if p.get(x))
        parts = [street or p.get("name"), p.get("city") or p.get("district"), p.get("country")]
        label = ", ".join(dict.fromkeys(str(x) for x in parts if x))[:160]
        if not label:
            return None
        return {"latitude": lat, "longitude": lng, "label": label}
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def features(data):
    values = data.get("features")
    if not isinstance(values, list):
        raise MapUnavailable("Не удалось получить адреса. Повторите поиск.")
    return values[:5]


async def search(session, payload):
    params = {"q": payload.query, "limit": 5}
    if payload.near:
        params.update(lat=round(payload.near.latitude, 4), lon=round(payload.near.longitude, 4))
    data = await get_json(
        session, "geocoding", settings.DRIVER_GEOCODING_URL.rstrip("/") + "/api/", params
    )
    return {"items": [x for item in features(data) if (x := feature(item))]}


async def reverse(session, point):
    data = await get_json(
        session,
        "geocoding",
        settings.DRIVER_GEOCODING_URL.rstrip("/") + "/reverse",
        {
            "lat": round(point.latitude, 5),
            "lon": round(point.longitude, 5),
            "limit": 1,
        },
    )
    return {"address": next((x for item in features(data) if (x := feature(item))), None)}


async def route(session, a, b, transport="car"):
    coordinates = (
        f"{a['longitude']:.6f},{a['latitude']:.6f};{b['longitude']:.6f},{b['latitude']:.6f}"
    )
    base = settings.DRIVER_ROUTING_URL.rstrip("/")
    url = f"{base}/routed-{transport}/route/v1/driving/{coordinates}"
    data = await get_json(
        session, "routing", url, {"geometries": "geojson", "overview": "full", "steps": "false"}
    )
    try:
        value = data["routes"][0]
        geometry = value["geometry"]["coordinates"]
        distance, duration = float(value["distance"]), float(value["duration"])
        if data.get("code") != "Ok" or not 1 <= distance <= 500000 or not 1 <= duration <= 172800:
            raise ValueError("Invalid route")
        if not 2 <= len(geometry) <= 30000 or any(
            not isinstance(p, list)
            or len(p) != 2
            or not all(isinstance(v, float | int) and math.isfinite(v) for v in p)
            or abs(p[0]) > 180
            or abs(p[1]) > 90
            for p in geometry
        ):
            raise ValueError("Invalid geometry")
        return {
            "coordinates": geometry,
            "distance": round(distance, 1),
            "duration": round(duration, 1),
        }
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise MapUnavailable("Не удалось построить маршрут. Проверьте выбранные точки.") from exc
