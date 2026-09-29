"""The training dispatch keeps each operator's cabinet and decides on the server what is solved."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.db.base import utcnow
from app.models.city import CitySettings
from app.models.crm import CrmAppeal
from app.models.dispatch import DispatchEvent
from app.services.city import default_missions
from app.services.dispatch import limit_categories
from app.services.dispatch_data import DRIVER_KEYS, contractor_id
from tests.conftest import auth, login, make_user
from tests.conftest import login_with_work_sites as work_login

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/dispatch"
CITY = "/api/v1/learning/city"
ACTIVE, ARCHIVED = contractor_id("zhumabayev"), contractor_id("zhumabayev-old")


async def act(client, headers, path, method="post", request_id=None, **body):
    body["request_id"] = request_id or str(uuid4())
    return await getattr(client, method)(BASE + path, headers=headers, json=body)


def call(state, call_id):
    return next(c for c in state["calls"] if c["id"] == call_id)


def driver(state, key):
    return next(d for d in state["drivers"] if d["id"] == contractor_id(key))


async def claim(client, headers, key):
    return await client.post(f"{CITY}/missions/{key}/claim", headers=headers, json={"revision": 0})


async def test_cabinet_needs_the_work_sites_qr_and_hides_answers(client, operator, head):
    plain = auth(await login(client, operator.login))
    blocked = await client.get(BASE, headers=plain)
    assert blocked.status_code == 403 and blocked.json()["code"] == "work_sites_qr_required"
    assert (await act(client, plain, "/reset")).status_code == 403
    staff = await client.get(BASE, headers=auth(await login(client, head.login)))
    assert staff.status_code == 200
    headers = auth(await work_login(client, operator.login))
    state = (await client.get(BASE, headers=headers)).json()
    assert {p["id"] for p in state["parks"]} >= {"itaxi-krg", "dostoyny-shym"}
    assert len({d["id"] for d in state["drivers"]}) == len(state["drivers"])
    for item in state["calls"]:
        assert item["state"] == "new" and item["done"] == "" and "correct" not in item
    # The grey amount on the balance is the sum of the driver's rows in «Антифрод».
    assert driver(state, "tulegenov")["withdraw_limit"] == 16474.94
    assert driver(state, "kim")["diagnostics"]["reasons"] == ["Восстановите сигнал GPS"]
    order = next(o for o in driver(state, "nurzhanova")["orders"] if o["id"] == "65812440")
    assert order["tariff"] == "Межгород"


async def test_provider_only_counts_on_the_active_account_and_repeats_act_once(
    client, operator, session
):
    headers = auth(await work_login(client, operator.login))
    wrong = await act(client, headers, f"/drivers/{ACTIVE}/details", "put", provider="Яндекс")
    assert wrong.status_code == 400
    old = await act(client, headers, f"/drivers/{ARCHIVED}/details", "put", provider="Sapar")
    assert old.status_code == 200 and "архивный" in old.json()["result"]["note"]
    assert call(old.json()["state"], "provider")["state"] == "new"
    request_id = str(uuid4())
    for _ in range(2):
        done = await act(
            client, headers, f"/drivers/{ACTIVE}/details", "put", request_id, provider="Sapar"
        )
        assert done.status_code == 200
    state = done.json()["state"]
    assert call(state, "provider")["state"] == "solved" and call(state, "provider")["done"]
    assert driver(state, "zhumabayev")["provider"] == "Sapar"
    events = await session.scalars(select(DispatchEvent).where(DispatchEvent.kind == "details"))
    assert len(list(events)) == 2
    missing = await act(client, headers, "/drivers/nobody/details", "put", provider="Sapar")
    assert missing.status_code == 404


async def test_car_call_needs_comfort_kept_tariffs_and_wrap(client, operator):
    headers = auth(await work_login(client, operator.login))
    path = f"/drivers/{contractor_id('seitkaziyev')}/car"
    kept = ["Эконом", "Курьер", "Доставка"]
    steps = [
        ({"tariffs": kept, "wrap": True}, "Комфорт"),
        ({"tariffs": ["Комфорт"], "wrap": True}, "Верни тарифы"),
        ({"tariffs": [*kept, "Комфорт"], "wrap": False}, "Оклейка"),
    ]
    for body, note in steps:
        result = await act(client, headers, path, "put", **body)
        assert result.status_code == 200 and note in result.json()["result"]["note"]
    assert (await act(client, headers, path, "put", tariffs=[], wrap=True)).status_code == 400
    assert (
        await act(client, headers, path, "put", tariffs=["Такси"], wrap=True)
    ).status_code == 400
    done = await act(client, headers, path, "put", tariffs=[*kept, "Комфорт"], wrap=True)
    state = done.json()["state"]
    car = driver(state, "seitkaziyev")["car"]
    assert call(state, "car")["state"] == "solved" and car["wrap"] and not car["wrap_checked"]
    assert "Комфорт" in car["tariffs"]
    courier = f"/drivers/{contractor_id('ospanova')}/car"
    assert (await act(client, headers, courier, "put", tariffs=kept, wrap=False)).status_code == 400


async def test_thermobox_needs_the_couriers_park_and_a_fresh_single_use_code(
    client, operator, session
):
    headers = auth(await work_login(client, operator.login))
    courier = contractor_id("ospanova")
    first = await act(client, headers, "/codes", driver=courier)
    code = first.json()["result"]["code"]
    assert len(code) == 5 and 0 < first.json()["result"]["expires_in"] <= 120
    again = await act(client, headers, "/codes", driver=courier)
    assert again.json()["result"]["code"] == code
    assert call(again.json()["state"], "thermobox")["active_code"]["value"] == code
    box = {"type": "eda", "code": code, "number": "ep 0812"}
    other_park = await act(client, headers, "/inventory", park="itaxi-krg", **box)
    assert other_park.status_code == 400 and "Проверьте парк" in other_park.json()["detail"]
    unknown = await act(
        client, headers, "/inventory", park="itaxi-courier-ala", **{**box, "code": "ZZZZ9"}
    )
    assert "не найден" in unknown.json()["detail"]
    black = await act(
        client, headers, "/inventory", park="itaxi-courier-ala", **{**box, "type": "delivery"}
    )
    assert black.status_code == 200 and "Вернуть" in black.json()["result"]["note"]
    state = black.json()["state"]
    assert call(state, "thermobox")["state"] == "new"
    assert state["inventory"]["stock"]["delivery"] == 48
    assert driver(state, "ospanova")["thermobox"] == {"type": "delivery", "number": "EP0812"}
    used = await act(client, headers, "/inventory/return", park="itaxi-courier-ala", **box)
    assert "уже использован" in used.json()["detail"]
    # A code the courier waited too long with no longer works.
    stale = (await act(client, headers, "/codes", driver=courier)).json()["result"]["code"]
    event = await session.scalar(
        select(DispatchEvent).where(DispatchEvent.kind == "code").order_by(DispatchEvent.id.desc())
    )
    event.payload = {
        **event.payload,
        "expires": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
    }
    await session.commit()
    expired = await act(
        client, headers, "/inventory/return", park="itaxi-courier-ala", **{**box, "code": stale}
    )
    assert "устарел" in expired.json()["detail"]
    fresh = (await act(client, headers, "/codes", driver=courier)).json()["result"]["code"]
    assert fresh != stale
    back = await act(
        client,
        headers,
        "/inventory/return",
        park="itaxi-courier-ala",
        type="delivery",
        code=fresh,
        number="EP0812",
    )
    assert back.status_code == 200 and back.json()["state"]["inventory"]["stock"]["delivery"] == 49
    code = (await act(client, headers, "/codes", driver=courier)).json()["result"]["code"]
    taken = await act(
        client,
        headers,
        "/inventory",
        park="itaxi-courier-ala",
        type="eda",
        code=code,
        number="DL0412",
    )
    assert "уже выдан" in taken.json()["detail"]
    done = await act(
        client,
        headers,
        "/inventory",
        park="itaxi-courier-ala",
        type="eda",
        code=code,
        number="EP0812",
    )
    state = done.json()["state"]
    assert call(state, "thermobox")["state"] == "solved"
    assert state["inventory"]["stock"]["eda"] == 31
    assert state["inventory"]["log"][0]["operation"] == "Выдача"
    assert state["inventory"]["log"][0]["employee"].startswith(operator.login)


async def test_support_ticket_is_kept_but_solves_the_call_only_by_the_rules(client, operator):
    headers = auth(await work_login(client, operator.login))
    ticket = {
        "park": "dostoyny-shym",
        "kind": "text",
        "private": True,
        "theme": "Вопросы об исполнителе",
        "subtheme": "Ограничение доступа к сервису",
        "license": "rs 558210",
        "text": "Прошу проверить ограничение доступа, водитель не согласен",
    }
    assert (
        await act(client, headers, "/tickets", **{**ticket, "subtheme": "Бонус"})
    ).status_code == 400
    assert (
        await act(client, headers, "/tickets", **{**ticket, "license": "12"})
    ).status_code == 400
    first = await act(client, headers, "/tickets", **ticket)
    assert first.status_code == 200
    checks = {c["label"]: c["ok"] for c in first.json()["result"]["checks"]}
    assert not any(ok for label, ok in checks.items() if "Доступ" in label or "ДД!" in label)
    assert call(first.json()["state"], "support")["state"] == "new"
    assert first.json()["state"]["tickets"][0]["mine"] is True
    done = await act(
        client,
        headers,
        "/tickets",
        **{**ticket, "private": False, "text": "ДД! Прошу проверить ограничение доступа"},
    )
    assert done.json()["result"]["solved"] is True
    assert call(done.json()["state"], "support")["state"] == "solved"
    assert [t["license"] for t in done.json()["state"]["tickets"][:2]] == ["RS558210"] * 2


async def test_limit_answers_and_the_ooz_case_waits_for_a_crm_request(client, operator, session):
    headers = auth(await work_login(client, operator.login))
    wrong = await act(client, headers, "/calls/limit_docs/answer", option="ooz")
    assert (
        wrong.json()["result"]
        == {
            "correct": False,
            "text": wrong.json()["result"]["text"],
        }
        and "Антифрод" in wrong.json()["result"]["text"]
    )
    assert (await act(client, headers, "/calls/limit_docs/answer", option="x")).status_code == 400
    assert (await act(client, headers, "/calls/car/answer", option="auto")).status_code == 404
    right = await act(client, headers, "/calls/limit_docs/answer", option="auto")
    assert (
        right.json()["result"]["correct"]
        and call(right.json()["state"], "limit_docs")["attempts"] == 2
    )
    await act(client, headers, "/calls/limit_intercity/answer", option="intercity")
    decided = await act(client, headers, "/calls/limit_duration/answer", option="ooz")
    assert call(decided.json()["state"], "limit_duration")["state"] == "crm"
    abenov = DRIVER_KEYS["abenov"]
    session.add(
        CrmAppeal(
            request_id=str(uuid4()),
            author_id=operator.id,
            author_name="Operator",
            channel="Звонок",
            phone=abenov["phone"],
            license_number="AF 918350",
            contacted_at=utcnow(),
            park="iTaxi",
            city="Астана",
            category_ids=sorted(limit_categories())[:1],
            category_labels=[],
            details={},
            comment="Снять лимит",
            is_ticket=True,
            status="new",
        )
    )
    await session.commit()
    state = (await client.get(BASE, headers=headers)).json()
    assert call(state, "limit_duration")["state"] == "solved"


async def test_reset_restores_the_cabinet_but_keeps_solved_calls_and_owners_apart(
    client, operator, session
):
    headers = auth(await work_login(client, operator.login))
    await act(client, headers, f"/drivers/{ACTIVE}/details", "put", provider="Sapar")
    other = await make_user(session, login="dispatch-other")
    theirs = (await client.get(BASE, headers=auth(await work_login(client, other.login)))).json()
    assert driver(theirs, "zhumabayev")["provider"] != "Sapar"
    assert call(theirs, "provider")["state"] == "new"
    state = (await act(client, headers, "/reset")).json()["state"]
    assert driver(state, "zhumabayev")["provider"] == "Бумажный документооборот"
    assert call(state, "provider")["state"] == "solved"


async def test_dispatch_missions_follow_solved_calls(client, operator, session, head):
    headers = auth(await work_login(client, operator.login))
    city = (await client.get(CITY, headers=headers)).json()
    district = next(d for d in city["districts"] if d["id"] == "dispatch")
    assert not district["soon"]
    assert len(city["plots"]) == 16
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "dispatch_driver")).status_code == 409
    await act(client, headers, f"/drivers/{ACTIVE}/details", "put", provider="Sapar")
    mission = next(
        m
        for m in (await client.get(CITY, headers=headers)).json()["missions"]
        if m["key"] == "dispatch_driver"
    )
    assert mission["state"] == "in_progress" and mission["current"] == 1
    await act(client, headers, "/calls/gps/answer", option="gps")
    assert (await claim(client, headers, "dispatch_driver")).status_code == 200
    assert (await claim(client, headers, "dispatch_limit")).status_code == 409
    # A trainer cannot ask for more calls than the district has.
    config = {"revision": 0, "missions": default_missions()}
    config["missions"]["dispatch_limit"]["target"] = 4
    admin = auth(await login(client, head.login))
    saved = await client.put("/api/v1/admin/learning/city/settings", headers=admin, json=config)
    assert saved.status_code == 422


async def test_saved_curriculum_from_before_dispatch_gets_the_new_missions(
    client, operator, session, head
):
    old = {k: v for k, v in default_missions().items() if not k.startswith("dispatch")}
    old["welcome"]["xp"] = 40
    session.add(CitySettings(id=1, revision=3, missions=old, updated_by_id=head.id))
    await session.commit()
    headers = auth(await login(client, operator.login))
    missions = {m["key"]: m for m in (await client.get(CITY, headers=headers)).json()["missions"]}
    assert missions["dispatch_limit"]["target"] == 3 and missions["welcome"]["xp"] == 40
    staff = auth(await login(client, head.login))
    config = (await client.get("/api/v1/admin/learning/city/settings", headers=staff)).json()
    saved = await client.put("/api/v1/admin/learning/city/settings", headers=staff, json=config)
    assert saved.status_code == 200, saved.text
