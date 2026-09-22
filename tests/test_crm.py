"""CRM history must be shared, durable, validated and isolated from live workflows."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.crm import CrmAppeal
from app.models.enums import Role
from app.services.crm_catalog import category_id
from tests.conftest import auth, login, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/crm"


def path_ids(labels):
    return [category_id(labels[: i + 1]) for i in range(len(labels))]


def payload(path=None, **kwargs):
    return dict(
        request_id=str(uuid4()),
        channel="Звонок",
        phone="+7 700 000 00 01",
        license_number="TEST-12345",
        driver_id="",
        contacted_at="2026-09-22T10:00:00+05:00",
        park="iTaxi",
        city="Алматы",
        category_ids=path_ids(path or ["Тестовый звонок/Чат"]),
        comment="Тестовый звонок",
        **kwargs,
    )


async def create(client, headers, body, files=None):
    return await client.post(
        BASE + "/appeals", headers=headers, data={"payload": json.dumps(body)}, files=files
    )


async def test_shared_persistent_history_and_idempotent_save(client, session, operator):
    headers = auth(await login(client, operator.login))
    body = payload()
    saved = await create(client, headers, body)
    assert saved.status_code == 201, saved.text
    data = saved.json()
    assert data["author_name"] == operator.full_name
    assert data["status"] == "recorded"
    assert "05:00:00" in data["contacted_at"]  # Input 10:00 +05:00 is stored in UTC.
    again = await create(client, headers, body)
    assert again.json()["id"] == data["id"]
    second = await make_user(session, login="crm-op2")
    other = auth(await login(client, second.login))
    # Different user and API requests use fresh database sessions, not client memory.
    history = (await client.get(BASE + "/appeals", headers=other)).json()
    assert history["total"] == 1
    assert history["items"][0]["author_id"] == operator.id
    reopened = await client.get(BASE + f"/appeals/{data['id']}", headers=other)
    assert reopened.json()["license_number"] == "TEST-12345"
    new = await create(client, other, body)
    assert new.json()["id"] != data["id"]
    filtered = await client.get(
        BASE + "/appeals", params={"q": "TEST-12345", "size": 1, "page": 2}, headers=headers
    )
    assert filtered.json()["total"] == 2
    assert len(filtered.json()["items"]) == 1
    assert await session.scalar(select(func.count()).select_from(CrmAppeal)) == 2


@pytest.mark.parametrize(
    "change",
    [
        {"phone": "abcde"},
        {"license_number": " "},
        {"city": "Unknown"},
        {"author_id": 999},
        {"author_name": "Forged name"},
        {"category_ids": path_ids(["Водитель"])},
        {"category_ids": path_ids(["Водитель", "Обычный водитель", "Регистрация"])},
        {
            "category_ids": [
                category_id(["Тестовый звонок/Чат"]),
                category_id(["Пассажир", "Двойная оплата"]),
            ]
        },
    ],
)
async def test_invalid_appeals_are_rejected_atomically(client, session, operator, change):
    headers = auth(await login(client, operator.login))
    body = payload()
    body.update(change)
    response = await create(client, headers, body)
    assert response.status_code == 422, response.text
    assert await session.scalar(select(func.count()).select_from(CrmAppeal)) == 0


async def test_phone_change_needs_link_two_numbers_and_image(client, session, operator):
    headers = auth(await login(client, operator.login))
    body = payload(
        [
            "Водитель",
            "Обычный водитель",
            "Запрос",
            "Таксопарк",
            "Обработка запросов/ООЗ",
            "Смена номера",
        ],
        is_ticket=True,
    )
    assert (await create(client, headers, body)).status_code == 422
    body["comment"] = (
        "Старый: +7 700 000 00 01\nНовый: +7 700 000 00 02\nhttps://dispatch.example/drivers/test"
    )
    assert (await create(client, headers, body)).status_code == 422
    image = b"\x89PNG\r\n\x1a\n" + b"test-image"
    saved = await create(client, headers, body, [("files", ("screen.png", image, "image/png"))])
    assert saved.status_code == 201, saved.text
    assert saved.json()["status"] == "new"
    file = saved.json()["attachments"][0]
    other = await make_user(session, login="file-viewer")
    response = await client.get(
        BASE + f"/attachments/{file['id']}", headers=auth(await login(client, other.login))
    )
    assert response.content == image
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "attachment;" in response.headers["content-disposition"]
    assert (await client.get(BASE + f"/attachments/{file['id']}")).status_code == 401


@pytest.mark.parametrize(
    "rule_path,details",
    [
        (
            ["Сотрудничество"],
            {
                "company": "Учебная компания",
                "callback": "+77000000001",
                "service": "Учебная услуга",
            },
        ),
        (
            ["Водитель", "Самозанятый водитель", "Жалоба/Благодарность", "Жалоба", "ОТП"],
            {"employee": "Тестовый сотрудник"},
        ),
        (
            [
                "Водитель",
                "Обычный водитель",
                "Запрос",
                "Таксопарк",
                "Запросы по Такси.Про",
                "Ошибка при выводе средств",
            ],
            {"transaction": "TEST-RRN-123"},
        ),
        (
            [
                "Водитель",
                "Обычный водитель",
                "Запрос",
                "Таксопарк",
                "Обработка запросов/ООЗ",
                "Изменение условия работы",
            ],
            {"conditions": "Комиссия 2%"},
        ),
        (
            [
                "Водитель",
                "Обычный водитель",
                "Запрос",
                "Таксопарк",
                "Запросы по Такси.Про",
                "Ошибка при пополнении Каспи",
            ],
            {"error_description": "Повторите через 15 минут"},
        ),
    ],
)
async def test_category_requirements(client, operator, rule_path, details):
    headers = auth(await login(client, operator.login))
    body = payload(rule_path)
    body["comment"] = "Описание ситуации https://dispatch.example/drivers/test"
    assert (await create(client, headers, body)).status_code == 422
    body["details"] = details
    response = await create(client, headers, body)
    assert response.status_code == 201, response.text


async def test_training_editor_categories_status_and_inherited_rules(client, session, operator):
    operator_headers = auth(await login(client, operator.login))
    trainer = await make_user(session, login="crm-trainer", role=Role.TRAINER)
    trainer_headers = auth(await login(client, trainer.login))
    root = [
        "Водитель",
        "Обычный водитель",
        "Запрос",
        "Таксопарк",
        "Обработка запросов/ООЗ",
        "Смена номера",
    ]
    addition = {
        "parent_id": category_id(root),
        "label": "Уточнение номера",
        "hint": "Сверьте данные",
    }
    url = "/api/v1/admin/learning/crm/categories"
    assert (await client.post(url, headers=operator_headers, json=addition)).status_code == 403
    response = await client.post(url, headers=trainer_headers, json=addition)
    assert response.status_code == 201, response.text
    assert (await client.post(url, headers=trainer_headers, json=addition)).status_code == 409
    catalog = (await client.get(BASE + "/catalog", headers=operator_headers)).json()
    assert any(node["label"] == addition["label"] for node in catalog["categories"])
    body = payload([*root, addition["label"]])
    assert (
        await create(client, operator_headers, body)
    ).status_code == 422  # Cannot bypass parent requirements.
    saved = (await create(client, operator_headers, payload(is_ticket=True))).json()
    status_url = f"/api/v1/admin/learning/crm/appeals/{saved['id']}/status"
    assert (
        await client.patch(status_url, headers=operator_headers, json={"status": "closed"})
    ).status_code == 403
    assert (
        await client.patch(status_url, headers=trainer_headers, json={"status": "in_progress"})
    ).json()["status"] == "in_progress"
    assert (await client.get(BASE + "/appeals", headers=trainer_headers)).json()["total"] == 1


@pytest.mark.parametrize(
    "content,mime",
    [(b"<svg onload='alert(1)'/>", "image/png"), (b"x" * (2 * 1024 * 1024 + 1), "image/png")],
    ids=["unsafe", "oversized"],
)
async def test_reject_unsafe_or_oversized_attachments(client, operator, content, mime):
    headers = auth(await login(client, operator.login))
    response = await create(client, headers, payload(), [("files", ("upload.png", content, mime))])
    assert response.status_code == 422
    assert (await client.get(BASE + "/appeals", headers=headers)).json()["total"] == 0
