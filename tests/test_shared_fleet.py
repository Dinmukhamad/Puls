"""CRM «Учётные записи водителей» and «Диспетчерская» share one training fleet per operator."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.dispatch import build
from app.services.dispatch_data import DRIVER_KEYS, contractor_id
from tests.conftest import auth, make_user
from tests.conftest import login_with_work_sites as work_login

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/dispatch"
SAPAROVA, OMAROV = DRIVER_KEYS["saparova"]["id"], DRIVER_KEYS["omarov"]["id"]
NEW_CAR = {
    "brand": "Hyundai", "model": "Elantra", "color": "Белый", "year": 2022, "plate": "455ktk02",
    "callsign": "455KTK02", "tariffs": ["Эконом", "Комфорт"],
}  # fmt: skip
NEWCOMER = {
    "park": "tenge-ast", "profession": "Водитель такси", "self_employed": False,
    "last_name": "Учебный", "first_name": "Данияр", "phone": "8 701 555 44 33",
    "iin": "990101300123", "license": "kz123456", "license_issued": "2020-05-01",
    "license_expires": "2030-05-01",
    "car": {"brand": "Kia", "model": "K5", "color": "Серый", "year": 2021, "plate": "321abc01"},
}  # fmt: skip


# The CRM client tests run on the seeded fleet; `PULS_WRITE_FLEET_FIXTURE=1 pytest …` rewrites it.
FIXTURE = Path(__file__).parents[1] / "frontend/src/pages/crm/drivers/fleet.fixture.json"
FIXTURE_FIELDS = (
    "id", "park", "last_name", "first_name", "middle_name", "phone", "license", "license_country",
    "license_issued", "license_expires", "experience_since", "iin", "address", "works", "status",
    "employment", "profession", "rule", "provider", "balance", "account_limit", "rating", "car",
    "created", "crm_id", "driver_no", "cash_limit", "codes", "photo_control", "stats", "history",
    "updated_at",
)  # fmt: skip


async def act(client, headers, path, method="post", request_id=None, **body):
    body["request_id"] = request_id or str(uuid4())
    return await getattr(client, method)(BASE + path, headers=headers, json=body)


def account(state, driver_id):
    return next(d for d in state["drivers"] if d["id"] == driver_id)


async def test_every_account_has_a_crm_card_and_crm_accounts_keep_their_ids(client, operator):
    headers = auth(await work_login(client, operator.login))
    state = (await client.get(BASE, headers=headers)).json()
    crm_ids = [d["crm_id"] for d in state["drivers"]]
    assert len(set(crm_ids)) == len(crm_ids) and all(crm_ids)
    saparova = account(state, SAPAROVA)
    assert saparova["crm_id"] == 11046704 and saparova["employment"] == "Физическое лицо"
    assert saparova["history"] == [{"at": saparova["created"], "text": "Учётная запись создана"}]
    assert saparova["photo_control"] == "Пройден" and saparova["stats"] == [0, 0, 0, 0]
    baibosynov = account(state, DRIVER_KEYS["baibosynov"]["id"])
    assert baibosynov["photo_control"] == "Нет данных" and baibosynov["car"]["plate"] == "803ASD02"
    # A cabinet account gets its trip counts from its own orders.
    assert account(state, contractor_id("kim"))["stats"][3] > 0
    parks = {p["id"] for p in state["parks"]}
    assert {d["park"] for d in state["drivers"]} <= parks


async def test_a_car_changed_in_crm_is_the_one_the_cabinet_shows(client, operator):
    headers = auth(await work_login(client, operator.login))
    path = f"/drivers/{OMAROV}/crm/car"
    other = await act(client, headers, path, "put", car={**NEW_CAR, "callsign": "omarov"})
    assert other.status_code == 400 and "Позывной" in other.json()["detail"]
    unknown = await act(client, headers, path, "put", car={**NEW_CAR, "tariffs": ["Бизнес"]})
    assert unknown.status_code == 400
    done = await act(client, headers, path, "put", car=NEW_CAR)
    assert done.status_code == 200
    omarov = account(done.json()["state"], OMAROV)
    assert omarov["car"]["plate"] == "455KTK02" and omarov["car"]["model"] == "Elantra"
    assert omarov["photo_control"] == "Требуется"
    assert omarov["history"][0]["text"].startswith("Автомобиль изменён в CRM: Hyundai Elantra")
    # The cabinet edits the same car, and CRM sees it in the history.
    tariffs = await act(
        client, headers, f"/drivers/{OMAROV}/car", "put", tariffs=["Эконом"], wrap=True
    )
    omarov = account(tariffs.json()["state"], OMAROV)
    assert omarov["car"]["tariffs"] == ["Эконом"] and omarov["car"]["plate"] == "455KTK02"
    assert omarov["history"][0]["text"].startswith("Диспетчерская: тарифы — Эконом")
    photo = await act(client, headers, f"/drivers/{OMAROV}/crm/photo")
    assert account(photo.json()["state"], OMAROV)["photo_control"] == "Пройден"
    again = await act(client, headers, f"/drivers/{OMAROV}/crm/photo")
    assert again.status_code == 400


async def test_crm_switches_employment_limit_rule_and_codes_of_the_account(client, operator):
    headers = auth(await work_login(client, operator.login))
    smz = {
        "last_name": "Сапарова", "first_name": "Айгерим", "middle_name": "Маратовна",
        "address": "г. Алматы, ул. Абая, 10", "iin": "950505400321", "rule": "Для всех 2%",
        "account_limit": -50,
    }  # fmt: skip
    bad = await act(client, headers, f"/drivers/{SAPAROVA}/crm/smz", **{**smz, "iin": "12"})
    assert bad.status_code == 400
    done = await act(client, headers, f"/drivers/{SAPAROVA}/crm/smz", **smz)
    saparova = account(done.json()["state"], SAPAROVA)
    assert saparova["employment"] == "Парковый самозанятый" and saparova["iin"] == smz["iin"]
    twice = await act(client, headers, f"/drivers/{SAPAROVA}/crm/smz", **smz)
    assert twice.status_code == 400
    back = await act(client, headers, f"/drivers/{SAPAROVA}/crm/individual")
    assert account(back.json()["state"], SAPAROVA)["employment"] == "Физическое лицо"
    limit = await act(client, headers, f"/drivers/{SAPAROVA}/crm/limit", enabled=True)
    assert account(limit.json()["state"], SAPAROVA)["cash_limit"] is True
    request_id = str(uuid4())
    for _ in range(2):
        code = await act(client, headers, f"/drivers/{SAPAROVA}/crm/code", request_id=request_id)
    assert account(code.json()["state"], SAPAROVA)["codes"] == 1
    wrong = await act(client, headers, f"/drivers/{SAPAROVA}/crm/rule", rule="Без комиссии")
    assert wrong.status_code == 400
    rule = await act(
        client, headers, f"/drivers/{SAPAROVA}/crm/rule", rule="Акция парк 0%", reason="Акция"
    )
    saparova = account(rule.json()["state"], SAPAROVA)
    assert saparova["rule"] == "Акция парк 0%"
    assert saparova["history"][0]["text"] == "Условия работы: «Акция парк 0%» — Акция"
    assert len(saparova["history"]) == 6
    missing = await act(client, headers, "/drivers/nobody/crm/code")
    assert missing.status_code == 404
    unknown = "0" * 32
    assert (await act(client, headers, f"/drivers/{unknown}/crm/code")).status_code == 404
    assert (await act(client, headers, "/codes", driver=unknown)).status_code == 404


async def test_a_driver_registered_in_crm_joins_the_park_until_a_reset(
    client, operator, session
):
    headers = auth(await work_login(client, operator.login))
    taken = await act(client, headers, "/crm/drivers", **{**NEWCOMER, "phone": "+77471112233"})
    assert taken.status_code == 400 and SAPAROVA in taken.json()["detail"]
    request_id = str(uuid4())
    for _ in range(2):
        done = await act(client, headers, "/crm/drivers", request_id=request_id, **NEWCOMER)
        assert done.status_code == 200
    new_id = done.json()["result"]["driver"]
    state = done.json()["state"]
    assert sum(1 for d in state["drivers"] if d["last_name"] == "Учебный") == 1
    newcomer = account(state, new_id)
    assert newcomer["park"] == "tenge-ast" and newcomer["source"] == "CRM"
    assert newcomer["phone"] == "+77015554433" and newcomer["license"] == "KZ123456"
    assert newcomer["car"]["plate"] == "321ABC01" and newcomer["car"]["callsign"] == "321ABC01"
    assert newcomer["history"][-1]["text"] == "Учётная запись создана через CRM"
    assert newcomer["employment"] == "Физическое лицо" and newcomer["orders"] == []
    # The new account is a fleet account like any other.
    car = await act(
        client, headers, f"/drivers/{new_id}/crm/car", "put",
        car={**NEW_CAR, "plate": "321ABC01", "callsign": "321ABC01", "model": "K5"},
    )  # fmt: skip
    assert car.status_code == 200
    assert account(car.json()["state"], new_id)["photo_control"] == "Нет данных"
    # Every operator has an own fleet: another one does not see the account.
    other = await make_user(session, login="fleet-other")
    theirs = (await client.get(BASE, headers=auth(await work_login(client, other.login)))).json()
    assert all(d["id"] != new_id for d in theirs["drivers"])
    reset = await act(client, headers, "/reset")
    assert all(d["id"] != new_id for d in reset.json()["state"]["drivers"])


async def test_the_crm_client_fixture_is_the_seeded_fleet():
    state = build(
        [], user=SimpleNamespace(email=None, login="operator"), now=datetime(2026, 9, 30, 12),
        utc_now=datetime(2026, 9, 30, 7, tzinfo=UTC),
    )  # fmt: skip
    expected = {
        "parks": state["parks"],
        "rules": state["rules"],
        "catalog": {"tariffs": state["catalog"]["tariffs"]},
        "drivers": [{k: d[k] for k in FIXTURE_FIELDS} for d in state["drivers"]],
    }
    if os.environ.get("PULS_WRITE_FLEET_FIXTURE"):
        FIXTURE.write_text(json.dumps(expected, ensure_ascii=False, indent=1) + "\n")
    assert json.loads(FIXTURE.read_text()) == expected
