"""Дубль названия группы отвечает 409, а не падает с 500.

Проверка уникальности опиралась на func.lower() в СУБД. Встроенный lower()
в SQLite работает только с латиницей, поэтому «Группа контроля» и «группа
контроля» там считались разными: проверка промахивалась, срабатывало
ограничение UNIQUE и пользователь получал 500 вместо понятного сообщения
у поля. В PostgreSQL lower() кириллицу обрабатывает, но полагаться на
различие СУБД нельзя — поведение должно быть одинаковым.

Клиент сессионный, поэтому у каждого теста свои названия групп: иначе они
цепляются друг за друга.
"""
from __future__ import annotations

import pytest


def _create(client, name: str):
    return client.post("/api/groups", json={"name": name, "status": "active"})


@pytest.mark.parametrize(
    "base, duplicate",
    [
        ("Дубль точный", "Дубль точный"),
        ("Дубль регистр", "дубль регистр"),
        ("Дубль пробелы", "  ДУБЛЬ ПРОБЕЛЫ  "),
        ("Duplicate latin", "duplicate LATIN"),
    ],
)
def test_duplicate_name_returns_409(client, base, duplicate):
    first = _create(client, base)
    assert first.status_code == 200, first.text

    response = _create(client, duplicate)

    assert response.status_code == 409, (
        f"дубль «{duplicate}» вернул {response.status_code}, ожидался 409: {response.text}"
    )
    assert "уже существует" in response.json()["detail"]


def test_rename_to_existing_name_returns_409(client):
    assert _create(client, "Переименование первая").status_code == 200
    second = _create(client, "Переименование вторая")
    assert second.status_code == 200, second.text

    response = client.patch(
        f"/api/groups/{second.json()['id']}",
        json={"name": "переименование первая"},
    )

    assert response.status_code == 409, (
        f"переименование в занятое имя вернуло {response.status_code}: {response.text}"
    )


def test_rename_keeping_own_name_is_allowed(client):
    created = _create(client, "Своё имя группы")
    assert created.status_code == 200, created.text
    group_id = created.json()["id"]

    # Собственное имя занятым считаться не должно, иначе нельзя поменять
    # только регистр написания или один лишь статус.
    response = client.patch(f"/api/groups/{group_id}", json={"name": "СВОЁ ИМЯ ГРУППЫ"})

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "СВОЁ ИМЯ ГРУППЫ"
