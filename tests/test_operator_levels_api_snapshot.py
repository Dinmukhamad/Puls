"""
Снимок контракта API экрана «Уровни» (#operator-levels).

Зачем: редизайн переписывает вёрстку, но обязан опираться на те же поля.
Снимок фиксирует форму ответа — имена ключей и типы, — а не значения:
идентификаторы и даты меняются от прогона к прогону.

Тест изолирован: он сам создаёт уровень с правилом и после себя убирает.
Раньше форма бралась из общих данных, и результат зависел от того, успел
ли соседний тест добавить правило: вложенный список приходил то пустым, то
нет. Теперь rules[] гарантированно непустой, поэтому форма элемента
проверяется всерьёз, а не «пустой список совместим с чем угодно».

Осознанное изменение контракта перегенерируется так:
    PULS_UPDATE_SNAPSHOTS=1 pytest -k levels_api_snapshot
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "operator_levels_contract.json"

# Поля, которым разрешено приходить то значением, то null. Список закрытый:
# всё остальное обязано иметь стабильный тип, иначе экран не сможет на него
# опираться, не подставляя выдуманное значение.
NULLABLE_FIELDS = frozenset({
    "GET /api/admin/operator-levels.item.rules.item.value_min",
    "GET /api/admin/operator-levels.item.rules.item.value_max",
    "GET /api/operator-levels.item.rules.item.value_min",
    "GET /api/operator-levels.item.rules.item.value_max",
})

SNAPSHOT_CODE_PREFIX = "snapshot_"

LEVEL_PAYLOAD = {
    "name": "Снимок контракта",
    "description": "Служебный уровень теста контракта",
    "color": "#123456",
    "icon": "star",
    "sort_order": 9_000,
    "is_active": True,
    "min_total_xp": 10,
    "reward_coins": 5,
    "reward_once": True,
    "coin_multiplier_percent": 1.5,
    "shop_discount_percent": 2.5,
}

RULE_PAYLOAD = {
    "metric_code": "tenure_days",
    "operator": "between",
    "value_min": 0,
    "value_max": 30,
    "is_required": True,
}


@pytest.fixture()
def level_with_rule(client, request):
    """Свой уровень с правилом — снимок не должен зависеть от чужих данных.

    Финализатор регистрируется сразу после создания уровня, до всех
    остальных проверок. Раньше уборка стояла в try, который начинался уже
    после assert на создание правила: упавшая проверка оставляла уровень в
    базе навсегда — client сессионный, и мусор жил до конца всего прогона.

    Финализатор вместо try/finally выбран сознательно: ошибка уборки
    придёт отдельной teardown-ошибкой и не подменит собой настоящую
    причину падения теста.
    """
    payload = dict(LEVEL_PAYLOAD, code=f"{SNAPSHOT_CODE_PREFIX}{uuid.uuid4().hex[:8]}")
    created = client.post("/api/admin/operator-levels", json=payload)
    assert created.status_code in (200, 201), created.text
    level = created.json()

    def remove_level():
        removed = client.delete(f"/api/admin/operator-levels/{level['id']}")
        # Молча провалившаяся уборка копит служебные уровни от прогона к
        # прогону, поэтому падаем громко.
        assert removed.status_code in (200, 204, 404), (
            f"служебный уровень {level['id']} остался в базе: "
            f"{removed.status_code} {removed.text[:200]}"
        )

    request.addfinalizer(remove_level)

    rule = client.post(f"/api/admin/operator-levels/{level['id']}/rules", json=RULE_PAYLOAD)
    assert rule.status_code in (200, 201), rule.text
    return level["code"]


def shape(value):
    """Форма значения: типы вместо данных.

    Список описывается отдельным узлом с признаком типа: так пустой список
    остаётся списком в снимке и не притворяется совпадающим с любым другим.
    """
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return {"__type__": "list", "item": shape(value[0]) if value else None}
    if value is None:
        return "null"
    return type(value).__name__


def compare(expected, actual, path: str, problems: list[str]) -> None:
    if isinstance(expected, dict) and isinstance(actual, dict):
        # Узел списка сравнивается отдельно: тип обязателен всегда, форма
        # элемента — когда снимок её знает.
        if expected.get("__type__") == "list" or actual.get("__type__") == "list":
            if expected.get("__type__") != actual.get("__type__"):
                problems.append(f"{path}: список заменён на {actual.get('__type__', 'не список')}")
                return
            if expected.get("item") is None:
                return  # снимок снят без элементов — форму проверить было не на чем
            if actual.get("item") is None:
                problems.append(
                    f"{path}: список пуст, форма элемента не проверена — "
                    f"тест должен создавать свои данные")
                return
            compare(expected["item"], actual["item"], f"{path}.item", problems)
            return
        for key in sorted(set(expected) | set(actual)):
            where = f"{path}.{key}" if path else key
            if key not in actual:
                problems.append(f"пропало поле {where}")
            elif key not in expected:
                problems.append(f"появилось поле {where} — перегенерируйте снимок")
            else:
                compare(expected[key], actual[key], where, problems)
        return
    if expected != actual:
        if path in NULLABLE_FIELDS and "null" in (expected, actual):
            return
        problems.append(f"{path}: было {expected}, стало {actual}")


def collect(client, code: str) -> dict:
    """Форма ответов. Из списков берём собственный уровень, а не первый попавшийся."""
    out = {}
    for name, path in [
        ("GET /api/admin/operator-levels", "/api/admin/operator-levels"),
        ("GET /api/operator-levels", "/api/operator-levels"),
    ]:
        response = client.get(path)
        assert response.status_code == 200, f"{name} → {response.status_code}: {response.text[:200]}"
        body = response.json()
        assert isinstance(body, list), f"{name} должен отдавать список"
        mine = next((item for item in body if item.get("code") == code), None)
        assert mine is not None, f"{name}: созданный тестом уровень не вернулся"
        out[name] = {"__type__": "list", "item": shape(mine)}

    rewards = client.get("/api/admin/operator-levels/rewards")
    assert rewards.status_code == 200, rewards.text
    out["GET /api/admin/operator-levels/rewards"] = shape(rewards.json())
    return out


def test_levels_api_snapshot(client, level_with_rule):
    actual = collect(client, level_with_rule)

    if os.getenv("PULS_UPDATE_SNAPSHOTS") or not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2), encoding="utf-8")
        if not os.getenv("PULS_UPDATE_SNAPSHOTS"):
            pytest.skip(f"снимок создан впервые: {FIXTURE.name}")
        return

    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    problems: list[str] = []
    compare(expected, actual, "", problems)
    assert not problems, (
        "контракт API уровней изменился:\n  " + "\n  ".join(problems) + "\n"
        "Если это осознанно — перегенерируйте снимок:\n"
        "  PULS_UPDATE_SNAPSHOTS=1 pytest -k levels_api_snapshot"
    )


def test_rule_shape_is_actually_checked(client, level_with_rule):
    """Страховка от возвращения дырки: правило в снимке обязано быть."""
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rules = expected["GET /api/admin/operator-levels"]["item"]["rules"]
    assert rules["__type__"] == "list"
    assert rules["item"] is not None, "снимок снят без правил — форма элемента не проверяется"
    for field in ("metric_code", "operator", "value_min", "value_max", "is_required"):
        assert field in rules["item"], f"в форме правила нет поля {field}"


def test_level_card_has_fields_the_screen_needs(client):
    """Поля, без которых экран нельзя собрать, не подставляя выдуманные значения."""
    levels = client.get("/api/admin/operator-levels").json()
    assert levels, "сид не создал ни одного уровня"
    for field in ("id", "code", "name", "color", "sort_order", "is_active",
                  "reward_coins", "reward_once", "rules"):
        assert field in levels[0], f"в карточке уровня нет поля {field}"


def test_levels_sorted_by_sort_order(client):
    levels = client.get("/api/admin/operator-levels").json()
    orders = [item["sort_order"] for item in levels]
    assert orders == sorted(orders), f"сервер отдал уровни не по порядку: {orders}"


@pytest.mark.parametrize("path", [
    "/api/admin/operator-levels",
    "/api/admin/operator-levels/rewards",
])
def test_operator_denied_on_levels_admin(operator_client, path):
    """Экран уровней — для manager и admin. Оператору данные не отдаются."""
    response = operator_client.get(path)
    assert response.status_code in (401, 403), f"{path} → {response.status_code}"


def test_snapshot_fixture_leaves_no_active_leftovers(client):
    """Служебные уровни фикстуры не должны переживать свои тесты активными.

    Идёт последним в файле: к этому моменту финализаторы предыдущих тестов
    уже отработали. client сессионный, поэтому протечка была бы видна.

    Проверяется именно активность, а не отсутствие строки: DELETE у уровней
    мягкий (см. test_delete_is_soft_deactivation), строку он не убирает.
    Опасен для соседних тестов и для расчёта именно активный уровень.
    """
    levels = client.get("/api/admin/operator-levels").json()
    leaked = [item["code"] for item in levels
              if str(item.get("code", "")).startswith(SNAPSHOT_CODE_PREFIX)
              and item.get("is_active")]
    assert not leaked, f"фикстура оставила активные служебные уровни: {leaked}"
