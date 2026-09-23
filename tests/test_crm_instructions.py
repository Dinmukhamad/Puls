import pytest

from app.models.enums import Role
from app.services.crm_catalog import category_id
from tests.conftest import auth, make_user
from tests.conftest import login_with_work_sites as login

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/crm/catalog"
EDIT = "/api/v1/admin/learning/crm/instructions/"
PHONE_PATH = [
    "Водитель",
    "Обычный водитель",
    "Запрос",
    "Таксопарк",
    "Обработка запросов/ООЗ",
    "Смена номера",
]


@pytest.mark.parametrize("role", [Role.SUPERVISOR, Role.HEAD, Role.ADMIN, Role.TRAINER])
async def test_staff_edit_instruction_is_shared_and_preserves_categories(
    client, session, operator, role
):
    staff = await make_user(session, login="instruction-editor", role=role)
    headers = auth(await login(client, staff.login))
    operator_headers = auth(await login(client, operator.login))
    before = (await client.get(BASE, headers=operator_headers)).json()
    key = "category:" + category_id(PHONE_PATH)
    instruction = before["instructions"][key]
    assert "Октелл" in instruction["body"]
    assert any("скриншот" in step for step in instruction["steps"])
    update = {
        "title": "Смена номера: памятка",
        "body": "Новая инструкция для команды",
        "steps": ["Сверьте номер", "Приложите скриншот"],
        "revision": 0,
    }
    response = await client.put(EDIT + key, headers=headers, json=update)
    assert response.status_code == 200, response.text
    after = (await client.get(BASE, headers=operator_headers)).json()
    assert after["instructions"][key]["title"] == update["title"]
    assert after["instructions"][key]["revision"] == 1
    assert before["categories"] == after["categories"]
    # A stale editor cannot overwrite the instruction another colleague saved.
    assert (await client.put(EDIT + key, headers=headers, json=update)).status_code == 409
    update["revision"] = 1
    update["body"] = "Повторная редакция"
    assert (await client.put(EDIT + key, headers=headers, json=update)).json()["revision"] == 2
    assert (await client.get(BASE, headers=operator_headers)).json()["instructions"][key][
        "body"
    ] == "Повторная редакция"


async def test_operator_cannot_edit_and_unknown_instruction_is_rejected(client, session, operator):
    body = {"title": "Title", "body": "Text", "steps": [], "revision": 0}
    headers = auth(await login(client, operator.login))
    assert (await client.put(EDIT + "guide:welcome", headers=headers, json=body)).status_code == 403
    assert (await client.put(EDIT + "guide:welcome", json=body)).status_code == 401
    staff = await make_user(session, login="guide-supervisor", role=Role.SUPERVISOR)
    staff_headers = auth(await login(client, staff.login))
    assert (
        await client.put(EDIT + "guide:unknown", headers=staff_headers, json=body)
    ).status_code == 404
    body["title"] = "  "
    assert (
        await client.put(EDIT + "guide:welcome", headers=staff_headers, json=body)
    ).status_code == 422
    body["title"] = "Добро пожаловать"
    body["steps"] = [" "]
    assert (
        await client.put(EDIT + "guide:welcome", headers=staff_headers, json=body)
    ).status_code == 422
    body["steps"] = ["Создайте обращение"]
    assert (
        await client.put(EDIT + "guide:welcome", headers=staff_headers, json=body)
    ).status_code == 200
    assert (await client.get(BASE, headers=headers)).json()["instructions"]["guide:welcome"][
        "title"
    ] == "Добро пожаловать"
