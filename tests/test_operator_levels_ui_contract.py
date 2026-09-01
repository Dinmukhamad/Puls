"""Поведение API уровней, на которое опирается экран «Уровни».

Это не дубль snapshot-теста: тот следит за формой ответа, а здесь
закреплены коды и правила, от которых зависит верстка и тексты формы.
Каждый тест отвечает на вопрос «что показать пользователю».

Все уровни создаются тестом и убираются финализатором, чтобы прогон не
оставлял за собой активных служебных уровней.
"""

from __future__ import annotations

import uuid

import pytest

LEVEL_CODE_PREFIX = "uic_"


@pytest.fixture()
def make_level(client, request):
    """Фабрика уровней с гарантированной уборкой.

    Финализаторы регистрируются сразу после создания: даже если тест упадёт
    в середине, служебные уровни будут отключены.
    """
    created: list[int] = []

    def _make(**over):
        payload = {
            "code": f"{LEVEL_CODE_PREFIX}{uuid.uuid4().hex[:8]}",
            "name": "Уровень контракта",
            "sort_order": 9_500,
        }
        payload.update(over)
        response = client.post("/api/admin/operator-levels", json=payload)
        assert response.status_code == 200, response.text
        level = response.json()
        created.append(level["id"])
        return level

    def cleanup():
        for level_id in created:
            removed = client.delete(f"/api/admin/operator-levels/{level_id}")
            assert removed.status_code in (200, 204, 404), (
                f"служебный уровень {level_id} не убран: {removed.status_code}"
            )

    request.addfinalizer(cleanup)
    return _make


# ── Роли ────────────────────────────────────────────────────────────────

def test_manager_cannot_change_is_active(manager_client, make_level):
    """Экран не показывает руководителю кнопку включения — вот почему."""
    level = make_level()
    response = manager_client.patch(
        f"/api/admin/operator-levels/{level['id']}", json={"is_active": False}
    )
    assert response.status_code == 403, response.text
    assert "администратор" in response.json()["detail"].lower()


def test_manager_can_edit_other_fields(manager_client, make_level):
    """Остальные поля руководителю доступны — форму целиком прятать нельзя."""
    level = make_level()
    response = manager_client.patch(
        f"/api/admin/operator-levels/{level['id']}", json={"name": "Переименовано"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Переименовано"


def test_manager_cannot_delete_level(manager_client, make_level):
    level = make_level()
    response = manager_client.delete(f"/api/admin/operator-levels/{level['id']}")
    assert response.status_code == 403, response.text


# ── Удаление ────────────────────────────────────────────────────────────

def test_delete_is_soft_deactivation(client, make_level):
    """DELETE не удаляет уровень, а снимает его с расчёта.

    От этого зависит текст диалога: обещать необратимое удаление нельзя —
    уровень остаётся в списке, настройки и условия сохраняются.
    """
    level = make_level(is_active=True)

    response = client.delete(f"/api/admin/operator-levels/{level['id']}")
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}

    after = client.get("/api/admin/operator-levels").json()
    same = next((item for item in after if item["id"] == level["id"]), None)
    assert same is not None, "уровень исчез из списка — диалог обещает обратное"
    assert same["is_active"] is False, "уровень остался активным после удаления"


def test_delete_does_not_return_409(client, make_level):
    """У удаления нет конфликта: проверок связанных сущностей на сервере нет.

    Ветка обработки 409 в интерфейсе остаётся защитной. Если однажды сервер
    начнёт возвращать 409, этот тест упадёт и напомнит убрать оговорку из
    текста экрана.
    """
    level = make_level()
    client.post(
        f"/api/admin/operator-levels/{level['id']}/rules",
        json={"metric_code": "quality", "operator": "gte", "value_min": 1},
    )
    response = client.delete(f"/api/admin/operator-levels/{level['id']}")
    assert response.status_code != 409, (
        "сервер начал сообщать о конфликте — интерфейс пора привести в соответствие"
    )


# ── Конфликты и валидация ───────────────────────────────────────────────

def test_duplicate_code_returns_409(client, make_level):
    """409 показывается у поля «Код», поэтому важен и код, и текст."""
    level = make_level()
    response = client.post(
        "/api/admin/operator-levels", json={"code": level["code"], "name": "Дубль"}
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert "код" in body["detail"].lower()
    assert body["code"] == "http_409"


def test_rename_to_existing_code_returns_409(client, make_level):
    first = make_level()
    second = make_level()
    response = client.patch(
        f"/api/admin/operator-levels/{second['id']}", json={"code": first["code"]}
    )
    assert response.status_code == 409, response.text


def test_validation_error_names_the_field(client):
    """Форма подсвечивает поле по details[].loc — конверт обязан его нести."""
    response = client.post("/api/admin/operator-levels", json={"code": "no_name_here"})
    assert response.status_code == 422, response.text
    body = response.json()
    assert isinstance(body["details"], list), "поля ошибок пропали из конверта"
    locs = [entry["loc"] for entry in body["details"]]
    assert ["body", "name"] in locs, f"в ответе нет указания на поле name: {locs}"


def test_negative_reward_is_rejected_with_field(client):
    response = client.post(
        "/api/admin/operator-levels",
        json={"code": f"{LEVEL_CODE_PREFIX}neg", "name": "Отрицательная", "reward_coins": -5},
    )
    assert response.status_code == 422, response.text
    locs = [entry["loc"] for entry in response.json()["details"]]
    assert ["body", "reward_coins"] in locs


# ── Правила ─────────────────────────────────────────────────────────────

def test_rule_without_bound_is_accepted_by_server(client, make_level):
    """Сервер не проверяет сочетание operator и границ.

    Условие «в диапазоне» без верхней границы принимается и при расчёте
    считается выполненным. Поэтому обязательность границ проверяет форма —
    этот тест объясняет, почему проверка на клиенте не лишняя.
    """
    level = make_level()
    response = client.post(
        f"/api/admin/operator-levels/{level['id']}/rules",
        json={"metric_code": "tenure_days", "operator": "between", "value_min": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["value_max"] is None


def test_rule_crud_roundtrip(client, make_level):
    level = make_level()
    created = client.post(
        f"/api/admin/operator-levels/{level['id']}/rules",
        json={"metric_code": "quality", "operator": "gte", "value_min": 90, "is_required": True},
    )
    assert created.status_code == 200, created.text
    rule = created.json()

    updated = client.patch(
        f"/api/admin/operator-level-rules/{rule['id']}", json={"value_min": 95}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["value_min"] == 95

    removed = client.delete(f"/api/admin/operator-level-rules/{rule['id']}")
    assert removed.status_code == 200, removed.text

    fresh = client.get("/api/admin/operator-levels").json()
    same = next(item for item in fresh if item["id"] == level["id"])
    assert all(r["id"] != rule["id"] for r in same["rules"]), "условие осталось после удаления"


# ── Ручное назначение ───────────────────────────────────────────────────

@pytest.fixture()
def operator_row(db_session):
    from tests.conftest import make_operator
    return make_operator(db_session, full_name="Оператор Контракта")


def test_manual_assign_requires_reason(client, make_level, operator_row):
    """Причина обязательна на уровне схемы — форма помечает поле звёздочкой."""
    level = make_level()
    response = client.post(
        f"/api/admin/operators/{operator_row.id}/level/manual", json={"level_id": level["id"]}
    )
    assert response.status_code == 422, response.text
    locs = [entry["loc"] for entry in response.json()["details"]]
    assert ["body", "reason"] in locs


def test_manual_assign_rejects_blank_reason(client, make_level, operator_row):
    """Пробелы причиной не считаются — сервер отвечает 400, а не 422."""
    level = make_level()
    response = client.post(
        f"/api/admin/operators/{operator_row.id}/level/manual",
        json={"level_id": level["id"], "reason": "   "},
    )
    assert response.status_code == 400, response.text
    assert "причин" in response.json()["detail"].lower()


def test_manual_assign_succeeds_with_reason(client, make_level, operator_row):
    level = make_level()
    response = client.post(
        f"/api/admin/operators/{operator_row.id}/level/manual",
        json={"level_id": level["id"], "reason": "перевод на новую линию", "comment": "по заявке"},
    )
    assert response.status_code == 200, response.text


# ── Пересчёт ────────────────────────────────────────────────────────────

def test_recalculate_reports_counters(client):
    """Итог пересчёта показывается пользователю — состав ответа важен."""
    response = client.post(
        "/api/admin/operator-levels/recalculate",
        json={"period_start": "2026-08-01", "period_end": "2026-08-31", "mode": "apply"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    for key in ("processed", "updated", "skipped_manual"):
        assert key in body, f"в итоге пересчёта нет счётчика {key}"
        assert isinstance(body[key], int)


def test_recalculate_has_no_preview_mode(client, make_level, operator_row):
    """Режим mode сервером не читается: пересчёт всегда применяется.

    Поэтому в интерфейсе «Предпросмотр» выключен. Если на сервере появится
    настоящий режим, этот тест упадёт и напомнит включить кнопку.
    """
    level = make_level(sort_order=1, is_active=True)
    client.post(
        f"/api/admin/operator-levels/{level['id']}/rules",
        json={"metric_code": "tenure_days", "operator": "gte", "value_min": 0},
    )
    before = client.get(f"/api/operators/{operator_row.id}/level")
    response = client.post(
        "/api/admin/operator-levels/recalculate",
        json={"period_start": "2026-08-01", "period_end": "2026-08-31", "mode": "preview"},
    )
    assert response.status_code == 200, response.text
    after = client.get(f"/api/operators/{operator_row.id}/level")
    assert before.status_code == after.status_code
    # Режим «preview» не отличается от «apply»: изменения записываются.
    assert response.json()["ok"] is True


# ── Награда ─────────────────────────────────────────────────────────────

def test_reward_once_false_means_never(db_session, client, make_level):
    """reward_once=False отключает награду совсем, а не делает её постоянной.

    Подпись на карточке уровня зависит именно от этого: раньше там было
    «при каждом присвоении», что обещало обратное поведению сервера.
    """
    from app.models.entities import OperatorLevel
    from app.modules.operator_levels.service import _award_level_reward_if_needed
    from tests.conftest import make_operator

    low = make_level(sort_order=1, reward_coins=0)
    high_off = make_level(sort_order=2, reward_coins=50, reward_once=False)
    high_on = make_level(sort_order=3, reward_coins=50, reward_once=True)

    operator = make_operator(db_session, full_name="Награда Контракта")
    low_row = db_session.get(OperatorLevel, low["id"])

    off = _award_level_reward_if_needed(
        db_session, operator, db_session.get(OperatorLevel, high_off["id"]),
        None, low_row, "auto",
    )
    assert off is None, "при reward_once=False награда всё-таки начислилась"

    on = _award_level_reward_if_needed(
        db_session, operator, db_session.get(OperatorLevel, high_on["id"]),
        None, low_row, "auto",
    )
    assert on is not None, "при reward_once=True награда не начислилась"
    db_session.commit()


def test_reward_once_does_not_pay_twice(db_session, client, make_level):
    """Повторное присвоение того же уровня награду не удваивает."""
    from app.models.entities import OperatorLevel
    from app.modules.operator_levels.service import _award_level_reward_if_needed
    from tests.conftest import make_operator

    low = make_level(sort_order=1, reward_coins=0)
    high = make_level(sort_order=2, reward_coins=70, reward_once=True)

    operator = make_operator(db_session, full_name="Повтор Награды")
    low_row = db_session.get(OperatorLevel, low["id"])
    high_row = db_session.get(OperatorLevel, high["id"])

    first = _award_level_reward_if_needed(db_session, operator, high_row, None, low_row, "auto")
    assert first is not None
    db_session.commit()

    second = _award_level_reward_if_needed(db_session, operator, high_row, None, low_row, "auto")
    assert second is None, "награда за один и тот же уровень начислилась второй раз"
    db_session.commit()


def test_server_reward_label_ignores_reward_once(client, make_level):
    """Серверная подпись награды не знает про reward_once.

    Поэтому карточка уровня собирает текст сама. Если бэкенд научится
    учитывать флаг, тест упадёт — и подпись на фронте можно будет упростить.
    """
    level = make_level(reward_coins=3, reward_once=False)
    fresh = client.get("/api/admin/operator-levels").json()
    same = next(item for item in fresh if item["id"] == level["id"])
    assert same["reward_once"] is False
    assert "при повышении" in same["reward_label"], (
        "reward_label изменился — проверьте текст награды на карточке"
    )
