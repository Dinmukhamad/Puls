"""Users list: canonical display names and group filtering."""
from __future__ import annotations

from datetime import date

from app.models.entities import Group
from tests.conftest import make_operator_user


def test_users_list_prefers_linked_operator_name(client, db_session):
    operator, user, _ = make_operator_user(db_session)
    user.full_name = "Устаревшее имя аккаунта"
    operator.full_name = "Актуальное имя оператора"
    db_session.commit()

    response = client.get("/api/users?limit=200")

    assert response.status_code == 200, response.text
    item = next(row for row in response.json()["items"] if row["id"] == user.id)
    assert item["full_name"] == "Актуальное имя оператора"


def test_users_list_group_filter_is_applied(client, db_session):
    group_one = Group(name="Фильтр группа 1", status="active")
    group_two = Group(name="Фильтр группа 2", status="active")
    db_session.add_all([group_one, group_two])
    db_session.flush()

    operator_one, user_one, _ = make_operator_user(db_session)
    operator_two, user_two, _ = make_operator_user(db_session)
    operator_one.group_id = user_one.group_id = group_one.id
    operator_one.group_name = group_one.name
    operator_two.group_id = user_two.group_id = group_two.id
    operator_two.group_name = group_two.name
    db_session.commit()

    response = client.get(f"/api/users?group_id={group_one.id}&limit=200")

    assert response.status_code == 200, response.text
    ids = {row["id"] for row in response.json()["items"]}
    assert user_one.id in ids
    assert user_two.id not in ids


def test_update_operator_profile_fields(client, db_session):
    group = Group(name="Рабочая группа", status="active")
    db_session.add(group)
    db_session.flush()
    operator, user, _ = make_operator_user(db_session)
    db_session.commit()

    response = client.patch(
        f"/api/users/{user.id}",
        json={
            "full_name": "Обновленный оператор",
            "group_id": group.id,
            "position": "chat_manager",
            "participation_status": "not_participating",
            "start_date": "2026-07-01",
            "rate": 0.75,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["full_name"] == "Обновленный оператор"
    assert payload["group_id"] == group.id
    assert payload["position"] == "chat_manager"
    assert payload["participation_status"] == "not_participating"
    assert payload["start_date"] == "2026-07-01"
    assert payload["rate"] == 0.75

    db_session.refresh(operator)
    assert operator.full_name == "Обновленный оператор"
    assert operator.group_id == group.id
    assert operator.start_date == date(2026, 7, 1)
