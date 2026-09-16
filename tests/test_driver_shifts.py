import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.db.base import utcnow
from app.models.coin import CoinTransaction
from app.models.driver import DriverOrder, DriverSettings
from app.models.driver_auth import TelegramLink
from app.models.driver_shift import DriverSupportCase
from app.models.enums import Role
from app.schemas.driver_shift import DriverScenario
from app.services import driver_maps, telegram
from tests.conftest import auth, login, make_user
from tests.driver_navigation_helpers import A, B, created, fake_route, fix, set_elapsed
from tests.driver_navigation_helpers import step as order_step
from tests.test_driver import BASE, act, confirmed_browser


@pytest.fixture
async def setup(client, session, operator, monkeypatch):
    monkeypatch.setattr(driver_maps, "route", fake_route)
    headers = auth(await login(client, operator.login))
    await confirmed_browser(session, operator, headers)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr("fixture-token"))
    monkeypatch.setattr(settings, "TELEGRAM_BOT_USERNAME", "puls_i_bot")
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_URL", "https://test.invalid/webhook")

    async def fake_bot_call(method, payload):
        assert method == "answerCallbackQuery"
        return True

    monkeypatch.setattr(telegram, "bot_call", fake_bot_call)
    await client.post(f"{BASE}/start", headers=headers)
    await act(client, headers, "taxi")
    await act(client, headers, "park", park_id="itaxi")
    await act(client, headers, "enter")
    return headers


async def start(client, headers, mode="assessment", **extra):
    response = await client.post(
        f"{BASE}/shifts", headers=headers, json={"id": str(uuid4()), "mode": mode, **extra}
    )
    assert response.status_code == 200, response.text
    if response.json()["profile"]["stage"] != "offline":
        await act(client, headers, "taxi")
        await act(client, headers, "park", park_id="itaxi")
        await act(client, headers, "enter")
    return response.json()["shift"]


async def command(client, headers, shift, action, *, request_id=None, **values):
    return await client.put(
        f"{BASE}/shifts/{shift['id']}/action",
        headers=headers,
        json={"action": action, "values": values, "request_id": request_id or str(uuid4())},
    )


async def photo(client, headers, shift):
    for step in range(5):
        assert (await command(client, headers, shift, "photo_step", step=step)).status_code == 200
    assert (await command(client, headers, shift, "photo_submit")).status_code == 200


async def order(client, session, headers, *, route=False):
    from app.models.driver_shift import DriverShift

    state = (await client.get(BASE, headers=headers)).json()
    shift = await session.get(DriverShift, state["shift"]["id"])
    await session.refresh(shift)
    # Fixed base fare isolates the existing commission/support accounting assertions.
    shift.config = {**shift.config, "fare_per_km": 0}
    await session.commit()
    response, _ = await created(client, headers)
    assert response.status_code == 200, response.text
    data, target = response.json(), B
    oid = data["order"]["id"]
    for action in ("arrive", "start_trip", "finish"):
        await set_elapsed(session, oid, 31, allow_movement=True)
        key = str(uuid4())
        response = await order_step(
            client, headers, oid, action, target if action == "finish" else A, request_id=key
        )
        assert response.status_code == 200, response.text
        data = response.json()
        duplicate = await order_step(client, headers, oid, action, request_id=key)
        assert duplicate.json()["order"] == data["order"]
        assert duplicate.json()["shift"] == data["shift"]
        if action == "start_trip" and route:
            target = {**B, "latitude": B["latitude"] + 0.002, "label": "Новый адрес, 44"}
            changed = await client.put(
                f"{BASE}/orders/{oid}/destination",
                headers=headers,
                json={"request_id": str(uuid4()), "destination": target, "location": fix()},
            )
            assert changed.status_code == 200, changed.text
    return data


async def test_shift_gates_snapshot_photo_retry_and_ownership(client, session, setup, operator):
    headers = setup
    shift = await start(client, headers)
    assert shift["mode"] == "assessment" and "support_steps" not in shift["config"]
    assert (await start(client, headers, "free"))["id"] == shift["id"]
    assert (await command(client, headers, shift, "online")).status_code == 409
    assert (await command(client, headers, shift, "photo_submit")).status_code == 409
    key = str(uuid4())
    await command(client, headers, shift, "photo_step", request_id=key, step=0)
    repeat = await command(client, headers, shift, "photo_step", request_id=key, step=0)
    assert repeat.json()["shift"]["data"]["photo_steps"] == [0]
    assert (
        await command(client, headers, shift, "photo_step", request_id=key, step=1)
    ).status_code == 409
    for step in range(1, 5):
        await command(client, headers, shift, "photo_step", step=step)
    await command(client, headers, shift, "photo_submit")
    assert (await command(client, headers, shift, "online")).json()["shift"]["data"]["online"]
    other = await make_user(session, login="other")
    other_headers = auth(await login(client, other.login))
    assert (await command(client, other_headers, shift, "finish")).status_code in (403, 409)
    assert (await client.get(BASE, headers=other_headers)).json()["shift"] is None
    session.add(
        DriverSettings(
            id=1,
            parks=[{"id": "itaxi", "name": "iTaxi", "commission": 2}],
            scenario=DriverScenario(fare=9999).model_dump(),
        )
    )
    await session.commit()
    assert (await client.get(BASE, headers=headers)).json()["shift"]["config"]["fare"] == 1960


async def test_money_orders_commissions_support_full_assessment(client, session, setup):
    headers = setup
    shift = await start(client, headers)
    await photo(client, headers, shift)
    await command(client, headers, shift, "online")
    await command(client, headers, shift, "payment", value="cash")
    data = await order(client, session, headers, route=True)
    assert data["order"]["payment"] == "cash"
    assert data["shift"]["data"]["completed"] == 1
    assert data["shift"]["data"]["balance"] == 1608
    assert [x["amount"] for x in data["shift"]["data"]["ledger"]] == [1960, -270, -43, -39]
    await command(client, headers, shift, "payment", value="card")
    data = await order(client, session, headers)
    assert data["order"]["payment"] == "card"
    d = data["shift"]["data"]
    assert d["reserved"] == 1000 and d["available"] == 2216 and d["payout_problem"]
    pending = next(x for x in d["ledger"] if x["status"] == "pending")
    await command(client, headers, shift, "visit", view="transaction", id=pending["id"])
    link = await client.post(
        f"{BASE}/shifts/{shift['id']}/support",
        headers=headers,
        json={"id": str(uuid4()), "topic": "payment"},
    )
    assert link.status_code == 200, link.text
    token = link.json()["url"].split("start=")[1]
    case_id = link.json()["case"]["id"]

    async def webhook(message=None, callback=None):
        return await client.post(
            "/api/v1/auth/telegram/webhook",
            headers={"X-Telegram-Bot-Api-Secret-Token": telegram.webhook_secret()},
            json={"update_id": 1, "message": message, "callback_query": callback},
        )

    message = {
        "chat": {"id": 12345, "type": "private"},
        "from": {"id": 12345},
        "text": f"/start {token}",
        "message_id": 77,
    }
    response = await webhook(message)
    assert "inline_keyboard" in response.json()["reply_markup"]
    assert "недействительна" in (await webhook(message)).json()["text"]
    for step, choice in enumerate((0, 1, 0)):
        callback = {
            "id": f"callback-{step}",
            "from": {"id": 12345},
            "message": message,
            "data": f"ds:{case_id}:{step}:{choice}",
        }
        response = await webhook(callback=callback)
        assert response.status_code == 200, response.text
        await webhook(callback=callback)
    data = (await client.get(BASE, headers=headers)).json()
    assert data["shift"]["data"]["support_completed"] == 1
    assert data["shift"]["data"]["reserved"] == 0
    assert data["shift"]["data"]["balance"] == 2216
    await command(client, headers, shift, "visit", view="transaction", id=pending["id"])
    await order(client, session, headers)
    for view in ("rating", "priority"):
        await command(client, headers, shift, "visit", view=view)
    await command(client, headers, shift, "provider", value="Sapar")
    await command(client, headers, shift, "doc_sign", id="act")
    done = await command(client, headers, shift, "finish")
    assert done.json()["shift"]["result"]["score"] == 100, done.text
    assert done.json()["shift_best"] == 100
    assert (await command(client, headers, shift, "online")).status_code == 409
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    case = await session.get(DriverSupportCase, case_id)
    await session.refresh(case)
    assert len(case.answers) == 3


async def test_free_mode_wallet_settings_cars_intercity_and_documents(client, session, setup):
    h = setup
    s = await start(client, h, "free")
    failed = await command(client, h, s, "wallet", kind="withdraw", amount=1000)
    assert failed.json()["shift"]["data"]["ledger"][-1]["status"] == "failed"
    assert failed.json()["shift"]["data"]["balance"] == 0
    key = str(uuid4())
    await command(client, h, s, "wallet", request_id=key, kind="topup", amount=10000)
    await command(client, h, s, "wallet", request_id=key, kind="topup", amount=10000)
    assert (await command(client, h, s, "refuel", liters=10)).json()["shift"]["data"][
        "balance"
    ] == 7550
    assert (await command(client, h, s, "setting", key="volume", value=True)).status_code == 400
    await command(client, h, s, "setting", key="theme", value="light")
    await command(
        client, h, s, "car_add", brand="Geely", model="Emgrand", year=2022, plate="SIM 123"
    )
    data = (await client.get(BASE, headers=h)).json()["shift"]["data"]
    car_id = data["cars"][-1]["id"]
    await command(client, h, s, "car_select", id=car_id)
    assert (await command(client, h, s, "online")).status_code == 409
    await photo(client, h, s)
    assert (await command(client, h, s, "online")).status_code == 200
    values = {
        "origin": "Алматы",
        "destination": "Конаев",
        "date": str(utcnow().date()),
        "from_time": "18:00",
        "to_time": "22:00",
        "kind": "seats",
        "seats": 2,
        "price": 5000,
    }
    assert (await command(client, h, s, "intercity_create", **values)).status_code == 400
    values["to_time"] = "20:00"
    assert (await command(client, h, s, "intercity_create", **values)).status_code == 200
    await command(client, h, s, "intercity_book", id="korday")
    assert (await command(client, h, s, "intercity_book", id="korday")).status_code == 409
    assert (await command(client, h, s, "doc_sign", id="act")).status_code == 409
    await command(client, h, s, "promo", code="PULS500")
    assert (await command(client, h, s, "promo", code="PULS500")).status_code == 409
    await command(client, h, s, "hint")
    done = (await command(client, h, s, "finish")).json()["shift"]
    assert done["result"]["score"] is None and done["result"]["penalties"] == 0
    assert done["data"]["settings"]["theme"] == "light"
    assert (await start(client, h, "free"))["id"] != s["id"]


async def test_offer_expiry_and_no_double_priority_penalty(client, session, setup):
    h = setup
    s = await start(client, h)
    await photo(client, h, s)
    await command(client, h, s, "online")
    from app.models.driver_shift import DriverShift

    shift = await session.get(DriverShift, s["id"])
    record = DriverOrder(
        id=str(uuid4()),
        user_id=shift.user_id,
        shift_id=shift.id,
        active_slot=1,
        stage="offer",
        origin=A["label"],
        destination=B["label"],
        payment="cash",
        fare=1960,
        commission=39,
        park={"id": "itaxi", "name": "iTaxi", "commission": 2},
        details={"offer_seconds": 30},
        version=0,
        events=[],
    )
    session.add(record)
    record.stage = "offer"
    record.stage_started_at = utcnow() - timedelta(seconds=60)
    await session.commit()
    response = await client.put(
        f"{BASE}/orders/{record.id}/action",
        headers=h,
        json={"action": "accept", "request_id": str(uuid4())},
    )
    assert response.status_code == 409
    key = str(uuid4())
    for _ in range(2):
        result = await client.put(
            f"{BASE}/orders/{record.id}/action",
            headers=h,
            json={"action": "missed", "request_id": key},
        )
        assert result.json()["shift"]["data"]["priority"] == 23
        assert result.json()["shift"]["data"]["missed"] == 1


async def test_support_wrong_telegram_expiry_and_link_revocation(client, session, setup, operator):
    h = setup
    s = await start(client, h, "free")
    created = await client.post(
        f"{BASE}/shifts/{s['id']}/support", headers=h, json={"id": str(uuid4()), "topic": "payment"}
    )
    token = created.json()["url"].split("start=")[1]
    url = "/api/v1/auth/telegram/webhook"
    wh = {"X-Telegram-Bot-Api-Secret-Token": telegram.webhook_secret()}

    def payload(chat):
        return {
            "update_id": 9,
            "message": {
                "chat": {"id": chat, "type": "private"},
                "from": {"id": chat},
                "text": f"/start {token}",
            },
        }

    response = await client.post(url, headers=wh, json=payload(67890))
    assert "Подключите" in response.json()["text"]
    case = await session.get(DriverSupportCase, created.json()["case"]["id"])
    case.expires_at = utcnow() - timedelta(seconds=1)
    await session.commit()
    assert "истёк" in (await client.post(url, headers=wh, json=payload(12345))).json()["text"]
    link = await session.get(TelegramLink, operator.id)
    link.version += 1
    await session.commit()
    assert (
        "недействительна"
        in (await client.post(url, headers=wh, json=payload(12345))).json()["text"]
    )


async def test_scenario_permissions_validation_and_admin_save(client, session, setup):
    url = "/api/v1/admin/learning/driver-scenario"
    assert (await client.get(url, headers=setup)).status_code == 403
    head = await make_user(session, login="head-config", role=Role.HEAD)
    h = auth(await login(client, head.login))
    config = (await client.get(url, headers=h)).json()
    config["target_orders"] = 5
    assert (await client.put(url, headers=h, json=config)).status_code == 200
    config["support_steps"][0]["correct"] = 3
    assert (await client.put(url, headers=h, json=config)).status_code == 422
    assert (await start(client, setup))["config"]["target_orders"] == 5


async def test_parallel_shift_start_reuses_one_shift(client, setup):
    responses = await asyncio.gather(
        *[
            client.post(f"{BASE}/shifts", headers=setup, json={"id": str(uuid4()), "mode": "free"})
            for _ in range(2)
        ]
    )
    assert all(x.status_code == 200 for x in responses), [x.text for x in responses]
    assert responses[0].json()["shift"]["id"] == responses[1].json()["shift"]["id"]


async def test_team_results_respect_staff_scope(client, session, setup, supervisor):
    await start(client, setup)
    url = "/api/v1/admin/learning/driver-results"
    assert (await client.get(url, headers=setup)).status_code == 403
    own = auth(await login(client, supervisor.login))
    assert (await client.get(url, headers=own)).json()["total"] == 1
    other = await make_user(session, login="other-supervisor", role=Role.SUPERVISOR)
    foreign = auth(await login(client, other.login))
    assert (await client.get(url, headers=foreign)).json()["total"] == 1
