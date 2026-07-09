"""
Сезонный магазин (ТЗ P2): окно доступности (starts_at/ends_at), лимит остатка
(stock_limit), лимит на оператора (purchase_limit_per_operator). 0 = без лимита,
как и у секторов Wheel of WOW — единообразный принцип по проекту.
"""
from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import make_operator_user
from tests.test_coin_rules_and_group_scope import _login


def _op_client(db_session, make_client, balance=100):
    op, user, password = make_operator_user(db_session)
    op.current_balance = balance
    db_session.commit()
    return _login(make_client, user.username, password), op


def test_purchase_blocked_before_starts_at(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(title="Будущий товар", price=10, starts_at=date.today() + timedelta(days=3))
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r.status_code == 409, r.text
    assert "не доступен" in r.json()["detail"]


def test_purchase_blocked_after_ends_at(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(title="Прошедший товар", price=10, ends_at=date.today() - timedelta(days=1))
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r.status_code == 409, r.text
    assert "завершена" in r.json()["detail"]


def test_purchase_allowed_within_season_window(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(
        title="Сезонный товар", price=10,
        starts_at=date.today() - timedelta(days=1), ends_at=date.today() + timedelta(days=1),
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r.status_code == 200, r.text


def test_purchase_blocked_when_stock_limit_reached(db_session, make_client):
    from app.models import entities as m

    c_a, op_a = _op_client(db_session, make_client)
    c_b, op_b = _op_client(db_session, make_client)
    item = m.ShopItem(title="Ограниченный тираж", price=10, stock_limit=1)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r1 = c_a.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r1.status_code == 200, r1.text

    r2 = c_b.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r2.status_code == 409, r2.text
    assert "закончился" in r2.json()["detail"]


def test_rejected_purchase_frees_up_stock(client, db_session, make_client):
    """Отклонённая заявка не должна навсегда съедать место в остатке —
    она не «использует» единицу товара (список исключает rejected)."""
    from app.models import entities as m

    c_a, op_a = _op_client(db_session, make_client)
    c_b, op_b = _op_client(db_session, make_client)
    item = m.ShopItem(title="Товар с отказом", price=10, stock_limit=1)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r1 = c_a.post("/api/shop/purchases", json={"shop_item_id": item.id})
    purchase_id = r1.json()["id"]
    r_reject = client.post(f"/api/shop/purchases/{purchase_id}/reject", json={"reason": "нет в наличии"})
    assert r_reject.status_code == 200, r_reject.text

    r2 = c_b.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r2.status_code == 200, r2.text


def test_purchase_blocked_when_operator_limit_reached(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(title="Не больше одного", price=10, purchase_limit_per_operator=1)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r1 = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r1.status_code == 200, r1.text

    r2 = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r2.status_code == 409, r2.text
    assert "Лимит на одного оператора" in r2.json()["detail"]


def test_list_items_shows_personalized_availability_fields(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(title="С полями", price=10, stock_limit=3, purchase_limit_per_operator=2)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r0 = c.get("/api/shop/items")
    row0 = next(i for i in r0.json() if i["id"] == item.id)
    assert row0["stock_remaining"] == 3
    assert row0["operator_purchased_count"] == 0
    assert row0["operator_limit_reached"] is False
    assert row0["is_available_now"] is True

    c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    r1 = c.get("/api/shop/items")
    row1 = next(i for i in r1.json() if i["id"] == item.id)
    assert row1["stock_remaining"] == 2
    assert row1["operator_purchased_count"] == 1
    assert row1["operator_limit_reached"] is False

    c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    r2 = c.get("/api/shop/items")
    row2 = next(i for i in r2.json() if i["id"] == item.id)
    assert row2["operator_limit_reached"] is True
    assert row2["is_available_now"] is False  # достиг личного лимита


def test_unlimited_item_has_null_stock_remaining(db_session, make_client):
    from app.models import entities as m

    c, op = _op_client(db_session, make_client)
    item = m.ShopItem(title="Без лимита", price=10)  # stock_limit=0 по умолчанию
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r = c.get("/api/shop/items")
    row = next(i for i in r.json() if i["id"] == item.id)
    assert row["stock_remaining"] is None
    assert row["is_available_now"] is True


def test_admin_can_set_seasonal_fields_on_create_and_update(client, db_session):
    r_create = client.post("/api/shop/items", json={
        "title": "Новый сезонный товар", "price": 20,
        "starts_at": "2026-08-01T00:00:00", "ends_at": "2026-08-31T23:59:59",
        "stock_limit": 5, "purchase_limit_per_operator": 1,
    })
    assert r_create.status_code == 200, r_create.text
    item_id = r_create.json()["id"]
    assert r_create.json()["stock_limit"] == 5

    r_update = client.patch(f"/api/shop/items/{item_id}", json={"stock_limit": 10})
    assert r_update.status_code == 200, r_update.text
    assert r_update.json()["stock_limit"] == 10
    assert r_update.json()["purchase_limit_per_operator"] == 1  # не затронуто частичным обновлением
