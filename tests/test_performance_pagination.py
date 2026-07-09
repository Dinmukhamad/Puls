"""
Нагрузочная оптимизация (ТЗ §11):

  * индексы на weekly_results/weekly_accrual_details по периоду без
    operator_id, на coin_transactions.created_at/source_type/created_by_user_id,
    на shop_purchases.created_at — созданы и в ORM, и в миграции 0026;
  * пагинация добавлена туда, где раньше отдавалось всё сразу: /operators,
    /shop/purchases, /coins/requests, /weekly-results, /rating.
"""
from __future__ import annotations

from datetime import date

from tests.conftest import make_operator
from tests.test_weekly_accrual_engine import _weekly_row


def test_operators_list_pagination(client, db_session):
    for i in range(5):
        make_operator(db_session, full_name=f"ПагинацияОператор{i}")

    r_all = client.get("/api/operators")
    total = len(r_all.json())
    assert total >= 5

    r_page = client.get("/api/operators?limit=2&offset=0")
    assert r_page.status_code == 200, r_page.text
    assert len(r_page.json()) == 2

    r_page2 = client.get("/api/operators?limit=2&offset=2")
    ids_1 = {o["id"] for o in r_page.json()}
    ids_2 = {o["id"] for o in r_page2.json()}
    assert not ids_1 & ids_2


def test_operators_limit_capped(client):
    r = client.get("/api/operators?limit=99999")
    assert r.status_code == 422


def test_shop_purchases_pagination(client, db_session):
    from app.models import entities as m

    op = make_operator(db_session, full_name="ЗаявкиПагинация")
    item = m.ShopItem(title="Пагинация-товар", price=5)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    for _ in range(4):
        db_session.add(m.ShopPurchase(operator_id=op.id, shop_item_id=item.id, price=5, status="new"))
    db_session.commit()

    r = client.get("/api/shop/purchases?limit=2&offset=0")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2


def test_coins_requests_pagination_and_total(client, db_session):
    from app.models import entities as m

    op = make_operator(db_session, full_name="КоинРеквестыПагинация")
    item = m.ShopItem(title="Реквест-товар", price=5)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    for _ in range(5):
        db_session.add(m.ShopPurchase(operator_id=op.id, shop_item_id=item.id, price=5, status="new"))
    db_session.commit()

    r = client.get("/api/coins/requests?group_id=all&limit=2&offset=0")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["items"]) == 2
    assert data["total"] >= 5, "total должен считать все подходящие строки, а не только страницу"


def test_weekly_results_list_pagination(client, db_session):
    for i in range(3):
        _weekly_row(db_session, full_name=f"ИтогиПагинация{i}", final_score=10,
                    week_start=date(2026, 10, 5), week_end=date(2026, 10, 11))

    r = client.get("/api/weekly-results?limit=1&offset=0")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


def test_rating_pagination(client, db_session):
    r = client.get("/api/rating?limit=1&offset=0")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "limit" in data and "offset" in data
    assert len(data["items"]) <= 1
