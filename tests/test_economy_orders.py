"""Автотесты фазы 3 экономики (ТЗ §20: «Магазин», «Ledger»):

- Idempotency-Key покупки: повтор запроса не создаёт второй заказ/резерв;
- жизненный цикл: issued (issued_by, completed_at), refunded (обратная
  идемпотентная транзакция, склад возвращён), expired (оба случая: заявка
  не обработана / приз не забран);
- складские счётчики: reserve → issue → return, остаток в каталоге,
  последняя единица не продаётся дважды.
"""
from __future__ import annotations

from datetime import timedelta

from tests.conftest import make_operator_user


def _login_operator(db_session, make_client, balance=1000):
    op, user, password = make_operator_user(db_session)
    op.current_balance = balance
    db_session.commit()
    c = make_client()
    assert c.post("/api/auth/login",
                  json={"username": user.username, "password": password}).status_code == 200
    return op, c


def _mk_item(client, price=200, **kw):
    r = client.post("/api/shop/items", json={"title": kw.pop("title", "Приз"),
                                             "description": "", "price": price, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Идемпотентность покупки
# ---------------------------------------------------------------------------

def test_purchase_idempotency_key_prevents_double_order(client, db_session, make_client):
    item = _mk_item(client, price=200)
    op, c = _login_operator(db_session, make_client, balance=500)

    payload = {"shop_item_id": item["id"], "idempotency_key": f"order:test:{op.id}:1"}
    r1 = c.post("/api/shop/purchases", json=payload)
    r2 = c.post("/api/shop/purchases", json=payload)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"], "повтор должен вернуть тот же заказ"

    db_session.expire_all()
    db_session.refresh(op)
    assert op.current_balance == 300, "резерв списан один раз"
    assert op.reserved_balance == 200


# ---------------------------------------------------------------------------
# Жизненный цикл: issued / refunded / expired
# ---------------------------------------------------------------------------

def test_issue_sets_issuer_and_refund_reverses(client, db_session, make_client):
    from app.models.entities import CoinTransaction, ShopPurchase

    item = _mk_item(client, price=300)
    op, c = _login_operator(db_session, make_client, balance=400)
    pid = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]

    assert client.post(f"/api/shop/purchases/{pid}/approve").status_code == 200
    db_session.expire_all()
    purchase = db_session.get(ShopPurchase, pid)
    assert purchase.expires_at is not None, "у готового приза есть дедлайн получения"

    assert client.post(f"/api/shop/purchases/{pid}/complete").status_code == 200
    db_session.expire_all()
    purchase = db_session.get(ShopPurchase, pid)
    assert purchase.status == "completed"
    assert purchase.issued_by_user_id is not None
    assert purchase.expires_at is None

    # Возврат: только админ, обратная транзакция, идемпотентно
    r = client.post(f"/api/shop/purchases/{pid}/refund", json={"reason": "Брак приза"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded"
    db_session.expire_all()
    db_session.refresh(op)
    assert op.current_balance == 400, "коины вернулись полностью"
    assert op.total_spent == 0

    # Повторный возврат не создаёт вторую транзакцию
    r = client.post(f"/api/shop/purchases/{pid}/refund", json={"reason": "Повтор"})
    db_session.expire_all()
    db_session.refresh(op)
    assert op.current_balance == 400
    refunds = db_session.query(CoinTransaction).filter_by(
        related_purchase_id=pid, type="refund").count()
    assert refunds == 1


def test_operator_cannot_refund(client, db_session, make_client):
    item = _mk_item(client, price=100)
    op, c = _login_operator(db_session, make_client, balance=200)
    pid = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]
    client.post(f"/api/shop/purchases/{pid}/approve")
    client.post(f"/api/shop/purchases/{pid}/complete")
    assert c.post(f"/api/shop/purchases/{pid}/refund",
                  json={"reason": "Хочу назад"}).status_code == 403


def test_expire_unprocessed_and_unclaimed_orders(client, db_session, make_client):
    from app.core.datetime_utils import now_utc
    from app.models.entities import ShopPurchase
    from app.modules.wallet.service import expire_stale_purchases

    item = _mk_item(client, price=100)
    op, c = _login_operator(db_session, make_client, balance=300)

    # Случай 1: заявка висит необработанной дольше лимита
    pid_stale = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]

    # Случай 2: приз готов, но дедлайн получения прошёл
    pid_ready = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]
    assert client.post(f"/api/shop/purchases/{pid_ready}/approve").status_code == 200
    db_session.expire_all()
    stale = db_session.get(ShopPurchase, pid_stale)
    stale.created_at = now_utc() - timedelta(days=8)
    ready = db_session.get(ShopPurchase, pid_ready)
    ready.expires_at = now_utc() - timedelta(hours=1)
    db_session.commit()

    result = expire_stale_purchases(db_session)
    db_session.commit()
    assert result == {"expired_pending": 1, "expired_ready": 1}

    db_session.expire_all()
    assert db_session.get(ShopPurchase, pid_stale).status == "expired"
    assert db_session.get(ShopPurchase, pid_ready).status == "expired"
    db_session.refresh(op)
    assert op.current_balance == 300, "оба возврата проведены"
    assert op.reserved_balance == 0
    assert op.total_spent == 0

    # Повторный запуск идемпотентен
    result = expire_stale_purchases(db_session)
    db_session.commit()
    assert result == {"expired_pending": 0, "expired_ready": 0}
    db_session.refresh(op)
    assert op.current_balance == 300


def test_expire_admin_endpoint(client):
    r = client.post("/api/admin/economy/orders/expire")
    assert r.status_code == 200
    assert set(r.json()) == {"expired_pending", "expired_ready"}


# ---------------------------------------------------------------------------
# Складские счётчики
# ---------------------------------------------------------------------------

def _inv_row(client, item_id):
    rows = client.get("/api/admin/economy/inventory").json()
    return next(r for r in rows if r["shop_item_id"] == item_id)


def test_inventory_counters_full_cycle(client, db_session, make_client):
    item = _mk_item(client, price=50, title="Лимитированный мерч")
    r = client.post("/api/admin/economy/inventory", json={
        "shop_item_id": item["id"], "add_received": 2, "min_stock_alert": 1,
    })
    assert r.status_code == 200, r.text
    assert r.json()["available"] == 2

    op, c = _login_operator(db_session, make_client, balance=500)

    # Резерв при покупке
    pid = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]
    inv = _inv_row(client, item["id"])
    assert inv["quantity_reserved"] == 1 and inv["available"] == 1
    assert inv["low_stock"] is True, "остаток на пороге min_stock_alert"

    # Каталог показывает остаток по складу
    card = next(x for x in c.get("/api/shop/items").json() if x["id"] == item["id"])
    assert card["stock_remaining"] == 1

    # Выдача: резерв → выдано
    client.post(f"/api/shop/purchases/{pid}/approve")
    client.post(f"/api/shop/purchases/{pid}/complete")
    inv = _inv_row(client, item["id"])
    assert inv["quantity_reserved"] == 0 and inv["quantity_issued"] == 1
    assert inv["available"] == 1

    # Возврат: quantity_issued — исторический журнал выдач (не уменьшается),
    # возврат отражается в returned; единица снова в остатке
    client.post(f"/api/shop/purchases/{pid}/refund", json={"reason": "Возврат"})
    inv = _inv_row(client, item["id"])
    assert inv["quantity_issued"] == 1 and inv["quantity_returned"] == 1
    assert inv["available"] == 2


def test_inventory_last_unit_not_oversold(client, db_session, make_client):
    item = _mk_item(client, price=10, title="Последняя единица")
    client.post("/api/admin/economy/inventory", json={
        "shop_item_id": item["id"], "add_received": 1,
    })
    op1, c1 = _login_operator(db_session, make_client, balance=100)
    op2, c2 = _login_operator(db_session, make_client, balance=100)

    assert c1.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).status_code == 200
    r = c2.post("/api/shop/purchases", json={"shop_item_id": item["id"]})
    assert r.status_code == 409, "второй покупатель получает «Товар закончился»"
    db_session.expire_all()
    db_session.refresh(op2)
    assert op2.current_balance == 100, "у второго ничего не списано"


def test_reject_releases_inventory_reserve(client, db_session, make_client):
    item = _mk_item(client, price=10, title="Отклоняемый")
    client.post("/api/admin/economy/inventory", json={
        "shop_item_id": item["id"], "add_received": 1,
    })
    op, c = _login_operator(db_session, make_client, balance=100)
    pid = c.post("/api/shop/purchases", json={"shop_item_id": item["id"]}).json()["id"]
    assert client.post(f"/api/shop/purchases/{pid}/reject",
                       json={"reason": "Не положено"}).status_code == 200
    inv = _inv_row(client, item["id"])
    assert inv["quantity_reserved"] == 0 and inv["available"] == 1
