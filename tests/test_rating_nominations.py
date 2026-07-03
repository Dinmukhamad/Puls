"""
P0.1: /api/rating/nominations — кеш реально работает и не падает (ТЗ 11.1/11.2).

Проверяем:
  * первый запрос строит номинации из данных и НЕ падает с NameError;
  * повторный запрос в течение TTL отдаёт кеш (данные "заморожены");
  * invalidate_nominations_cache()/rating_cache_invalidate() сбрасывают кеш;
  * по истечении TTL кеш обновляется;
  * пустой рейтинг тоже кешируется ({"items": []});
  * is_current_user персонализируется НА КАЖДЫЙ запрос поверх общего кеша —
    первый пользователь не «застолбляет» свой флаг для всех.
"""
from __future__ import annotations

from tests.conftest import make_operator_user


def _rows(winner_id: int, winner_name: str = "Топ Оператор"):
    """Минимальный набор полей, которые читает _build_nominations."""
    return [
        {
            "operator_id": winner_id,
            "operator_name": winner_name,
            "contest_points": 120.0,
            "final_score": 120.0,
            "coins_earned": 24,
            "rank_delta": 3,
        },
        {
            "operator_id": winner_id + 1,
            "operator_name": "Второй Оператор",
            "contest_points": 90.0,
            "final_score": 90.0,
            "coins_earned": 10,
            "rank_delta": -1,
        },
    ]


def test_first_request_builds_then_serves_cache(client, monkeypatch):
    import app.routers.rating as rating_router

    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(101, "Победитель v1"))
    r = client.get("/api/rating/nominations")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, "номинации должны построиться из данных рейтинга"
    assert items[0]["winner_name"] == "Победитель v1"
    assert items[0]["winner_operator_id"] == 101
    # у админа нет привязанного оператора — флаг всегда False
    assert all(it["is_current_user"] is False for it in items)

    # Данные «изменились», но TTL не истёк — отдаётся кеш
    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(202, "Победитель v2"))
    r2 = client.get("/api/rating/nominations")
    assert r2.status_code == 200
    assert r2.json()["items"][0]["winner_name"] == "Победитель v1", "в пределах TTL должен работать кеш"


def test_invalidate_refreshes_data(client, monkeypatch):
    import app.routers.rating as rating_router
    from app.services.rating import invalidate_nominations_cache

    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(101, "Победитель v1"))
    assert client.get("/api/rating/nominations").json()["items"][0]["winner_name"] == "Победитель v1"

    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(202, "Победитель v2"))
    invalidate_nominations_cache()
    assert client.get("/api/rating/nominations").json()["items"][0]["winner_name"] == "Победитель v2"


def test_ttl_expiry_rebuilds(client, monkeypatch):
    """«Через 5 минут кеш обновляется» — состариваем запись вручную."""
    import app.routers.rating as rating_router
    from app.services import rating as rating_service

    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(101, "Победитель v1"))
    client.get("/api/rating/nominations")

    # Старим кеш за границу TTL и подменяем данные
    rating_service._NOMINATIONS_CACHE["v"]["ts"] -= rating_service._NOMINATIONS_TTL + 1
    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(202, "Победитель v2"))

    r = client.get("/api/rating/nominations")
    assert r.json()["items"][0]["winner_name"] == "Победитель v2", "после TTL кеш должен пересобраться"


def test_empty_rating_is_cached_too(client, monkeypatch):
    import app.routers.rating as rating_router

    monkeypatch.setattr(rating_router, "rating_rows", lambda db: [])
    assert client.get("/api/rating/nominations").json() == {"items": []}

    # Появились данные, но пустой результат закеширован — в пределах TTL всё ещё []
    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(101))
    assert client.get("/api/rating/nominations").json() == {"items": []}


def test_is_current_user_is_per_request_not_cached(client, make_client, db_session, monkeypatch):
    """Регресс на утечку персонального флага через общий кеш."""
    import app.routers.rating as rating_router

    op, user, password = make_operator_user(db_session)
    monkeypatch.setattr(rating_router, "rating_rows", lambda db: _rows(op.id, op.full_name))

    # 1) Админ прогревает кеш — у него все флаги False
    admin_items = client.get("/api/rating/nominations").json()["items"]
    assert all(it["is_current_user"] is False for it in admin_items)

    # 2) Оператор-победитель читает ИЗ ТОГО ЖЕ кеша — но флаг уже его
    opc = make_client()
    assert opc.post("/api/auth/login", json={"username": user.username, "password": password}).status_code == 200
    op_items = opc.get("/api/rating/nominations").json()["items"]
    assert op_items[0]["winner_operator_id"] == op.id
    assert op_items[0]["is_current_user"] is True

    # 3) И снова админ — кеш общий, флаг по-прежнему персональный
    admin_again = client.get("/api/rating/nominations").json()["items"]
    assert all(it["is_current_user"] is False for it in admin_again)
