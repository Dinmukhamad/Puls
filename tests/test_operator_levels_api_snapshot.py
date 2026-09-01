"""
Снимок контракта API экрана «Уровни» (#operator-levels).

Зачем: редизайн переписывает вёрстку, но обязан опираться на те же поля.
Снимок фиксирует форму ответа — имена ключей и типы, — а не значения:
идентификаторы и даты меняются от прогона к прогону и в сравнении только
мешают. Если поле исчезнет, переименуется или сменит тип, тест упадёт до
того, как это заметят на экране.

Файл снимка лежит в tests/fixtures. При осознанном изменении контракта его
нужно перегенерировать: PULS_UPDATE_SNAPSHOTS=1 pytest -k levels_api_snapshot
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "operator_levels_contract.json"

# Ключи, значения которых не воспроизводимы между прогонами.
VOLATILE = {"id", "level_id", "operator_id", "created_at", "updated_at", "assigned_at"}


def shape(value):
    """Форма значения: типы вместо данных, ключи отсортированы."""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        # Список описывается формой первого элемента: у однородных коллекций
        # этого достаточно, а длина зависит от данных и в контракт не входит.
        return [shape(value[0])] if value else []
    if value is None:
        return "null"
    return type(value).__name__


def collect(client) -> dict:
    endpoints = {
        "GET /api/admin/operator-levels": "/api/admin/operator-levels",
        "GET /api/admin/operator-levels/rewards": "/api/admin/operator-levels/rewards",
        "GET /api/operator-levels": "/api/operator-levels",
    }
    out = {}
    for name, path in endpoints.items():
        response = client.get(path)
        assert response.status_code == 200, f"{name} → {response.status_code}: {response.text[:200]}"
        out[name] = shape(response.json())
    return out


def test_levels_api_snapshot(client):
    actual = collect(client)

    if os.getenv("PULS_UPDATE_SNAPSHOTS") or not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2), encoding="utf-8")
        if not os.getenv("PULS_UPDATE_SNAPSHOTS"):
            pytest.skip(f"снимок создан впервые: {FIXTURE.name}")
        return

    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert actual == expected, (
        "контракт API уровней изменился.\n"
        "Если это осознанно — перегенерируйте снимок:\n"
        "  PULS_UPDATE_SNAPSHOTS=1 pytest -k levels_api_snapshot"
    )


def test_level_card_has_fields_the_screen_needs(client):
    """Поля, без которых экран нельзя собрать, не подставляя выдуманные значения."""
    levels = client.get("/api/admin/operator-levels").json()
    assert levels, "сид не создал ни одного уровня — снимок будет пустым"
    level = levels[0]
    for field in ("id", "code", "name", "color", "sort_order", "is_active"):
        assert field in level, f"в карточке уровня нет поля {field}"
    # Порядок карточек задаёт сервер: экран обязан сортировать по sort_order,
    # а не по порядку прихода.
    assert all("sort_order" in item for item in levels)


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
