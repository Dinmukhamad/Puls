import time

import httpx
import pytest

from app.models.driver_navigation import DriverMapRate
from app.schemas.driver_navigation import AddressSearch, RoutePoint
from app.services import driver_maps
from tests.driver_navigation_helpers import A, B


@pytest.fixture
def provider(monkeypatch):
    driver_maps._cache.clear()
    calls, body = [], {"features": []}

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=body)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        driver_maps.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(respond), **kw),
    )
    return calls, body


async def test_address_proxy_explicit_search_bias_cache_and_reverse(session, provider):
    calls, body = provider
    body["features"] = [
        {
            "geometry": {"coordinates": [76.9, 43.24]},
            "properties": {
                "street": "Абая",
                "housenumber": "10",
                "city": "Алматы",
                "country": "Казахстан",
            },
        },
        {"geometry": None},
    ]
    payload = AddressSearch(query="Абая 10", near=RoutePoint(**A))
    first = await driver_maps.search(session, payload)
    assert first["items"][0]["label"] == "Абая 10, Алматы, Казахстан"
    assert len(first["items"]) == 1
    assert (await driver_maps.search(session, payload)) == first and len(calls) == 1
    assert calls[0].url.params["lat"] == str(A["latitude"])
    assert calls[0].headers["User-Agent"].startswith("Puls-Driver-Simulator/")
    reverse = await driver_maps.reverse(session, RoutePoint(**A))
    assert reverse["address"] == first["items"][0]


@pytest.mark.parametrize("value", [None, "bad", {}, 42])
async def test_bad_geocoder_response_is_controlled_error(session, provider, value):
    _, body = provider
    body["features"] = value
    with pytest.raises(driver_maps.MapUnavailable):
        await driver_maps.search(session, AddressSearch(query="Алматы"))


async def test_osrm_geojson_order_distance_and_walk_profile(session, provider):
    calls, body = provider
    coordinates = [[A["longitude"], A["latitude"]], [B["longitude"], B["latitude"]]]
    body.update(
        code="Ok",
        routes=[{"distance": 890.2, "duration": 610.1, "geometry": {"coordinates": coordinates}}],
    )
    result = await driver_maps.route(session, A, B, "foot")
    assert result == {"coordinates": coordinates, "distance": 890.2, "duration": 610.1}
    assert "/routed-foot/route/v1/driving/76.889700,43.238900;" in str(calls[0].url)
    assert calls[0].url.params["geometries"] == "geojson"


@pytest.mark.parametrize("problem", ["no_route", "nan", "bounds", "empty", "distance"])
async def test_invalid_route_never_becomes_a_straight_line_fallback(session, provider, problem):
    _, body = provider
    body.update(
        code="Ok",
        routes=[
            {
                "distance": 890,
                "duration": 100,
                "geometry": {"coordinates": [[76.88, 43.23], [76.89, 43.24]]},
            }
        ],
    )
    route = body["routes"][0]
    if problem == "no_route":
        body["code"] = "NoRoute"
    elif problem == "nan":
        route["duration"] = "nan"
    elif problem == "bounds":
        route["geometry"]["coordinates"][0] = [200, 100]
    elif problem == "empty":
        route["geometry"]["coordinates"] = []
    else:
        route["distance"] = 0
    with pytest.raises(driver_maps.MapUnavailable):
        await driver_maps.route(session, A, B)


async def test_global_provider_limit_survives_request_rollback(session):
    started = time.monotonic()
    await driver_maps.reserve(session, "routing")
    await session.rollback()
    await driver_maps.reserve(session, "routing")
    assert time.monotonic() - started >= 1
    assert await session.get(DriverMapRate, "routing") is not None
