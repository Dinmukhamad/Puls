"""Что оператор может прочитать через API.

Обход всех GET-эндпоинтов под ролью оператора. Из 95 маршрутов 60 были
закрыты, 35 открыты — и среди открытых нашёлся один лишний: GET /api/groups
отдавал оператору тот же ответ, что и администратору, с перечнем всех
групп, их статусом, числом людей и датами создания. У всех изменяющих
методов того же роутера стоит require_roles("manager", "admin"), а у чтения
проверки роли не было вовсе — только факт входа.

Операторскому интерфейсу этот список не нужен: в предзагрузке шелла
groups:list и groups:active лежат внутри ветки для админских ролей, а имена
групп операторский рейтинг берёт из /api/rating/race.

Тест намеренно перечисляет разрешённое поимённо, а не считает количество:
новый маршрут, открытый оператору по недосмотру, должен ронять сборку, а не
растворяться в счётчике.
"""
from __future__ import annotations

import pytest

from tests.test_coin_rules_and_group_scope import _login, _make_role_user

# Собственные данные оператора, игровой каталог и рейтинг. Рейтинг открыт
# намеренно: это соревновательная таблица, она и должна быть видна.
OPERATOR_MAY_READ = {
    "/api/achievements",
    "/api/achievements/me",
    "/api/auth/me",
    "/api/cabinet/me",
    "/api/economy/me",
    "/api/economy/transactions",
    "/api/me/level",
    "/api/missions",
    "/api/missions/worlds",
    "/api/notifications",
    "/api/notifications/unread-count",
    "/api/operator-levels",
    "/api/operators/me",
    "/api/raffles",
    "/api/rating",
    "/api/rating/me",
    "/api/rating/me/comparison",
    "/api/rating/me/dynamics",
    "/api/rating/me/transactions",
    "/api/rating/nominations",
    "/api/rating/operator-dynamics",
    "/api/rating/race",
    "/api/shop/discounts",
    "/api/shop/items",
    "/api/shop/purchases",
    "/api/store/orders/me",
    "/api/store/prizes",
    "/api/tests/my",
    "/api/wallet/me",
    "/api/wheel/history",
    "/api/wheel/my-history",
    "/api/wheel/prizes",
    "/api/wheel/status",
    "/api/wheel/winners-today",
}

QUERY = {"start_date": "2026-07-01", "end_date": "2026-07-31", "period": "week", "limit": 5}


@pytest.fixture
def operator_reader(db_session, make_client):
    user, password = _make_role_user(db_session, role="operator")
    return _login(make_client, user.username, password)


def _plain_get_paths(app) -> list[str]:
    """GET-маршруты без параметров пути: их можно дёрнуть без подстановки."""
    schema = app.openapi()
    return sorted(
        path for path, ops in schema["paths"].items()
        if "get" in ops and "{" not in path and path.startswith("/api/")
    )


def test_operator_read_surface_matches_the_allow_list(client, fastapi_app, operator_reader):
    """Оператор читает ровно то, что ему положено, — ни маршрутом больше."""
    unexpected = []
    for path in _plain_get_paths(fastapi_app):
        if path in OPERATOR_MAY_READ:
            continue
        response = operator_reader.get(path, params=QUERY)
        if response.status_code == 200:
            unexpected.append(path)

    assert unexpected == [], (
        "оператор читает маршруты вне списка разрешённых: "
        + ", ".join(unexpected)
        + ". Либо у маршрута нет проверки роли, либо доступ осознанный — тогда "
          "внесите путь в OPERATOR_MAY_READ и объясните почему."
    )


def test_group_list_is_closed_for_operator(client, operator_reader):
    """Перечень групп — административные данные.

    Кроме названий там статус, число людей и даты создания: оператору это
    не нужно, а изменяющие методы того же роутера давно закрыты.
    """
    response = operator_reader.get("/api/groups")
    assert response.status_code == 403, (
        f"оператор получил список групп ({response.status_code}): {response.text[:160]}"
    )


@pytest.mark.parametrize("role", ["supervisor", "manager", "admin"])
def test_group_list_stays_open_for_admin_roles(db_session, make_client, role):
    """Закрывая от оператора, нельзя закрыть от тех, кому список нужен."""
    user, password = _make_role_user(db_session, role=role)
    role_client = _login(make_client, user.username, password)
    response = role_client.get("/api/groups")
    assert response.status_code == 200, f"роль {role} потеряла доступ: {response.text[:160]}"


def test_allow_list_has_no_stale_paths(fastapi_app):
    """Список разрешённого не должен ссылаться на исчезнувшие маршруты.

    Иначе он тихо перестаёт что-либо охранять: путь удалили, запись
    осталась, и однажды под тем же именем появится совсем другой маршрут.
    """
    existing = set(_plain_get_paths(fastapi_app))
    stale = sorted(OPERATOR_MAY_READ - existing)
    assert stale == [], f"в списке разрешённого маршруты, которых больше нет: {stale}"
