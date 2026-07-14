from __future__ import annotations

import json

from tests.conftest import make_operator_user
from tests.test_coin_rules_and_group_scope import _login


def _operator_client(db, make_client, balance=200):
    operator, user, password = make_operator_user(db)
    operator.current_balance = balance
    db.commit()
    return _login(make_client, user.username, password), operator


def _discount_spin(db, operator, *, percent=10, materialize=False):
    from app.models import entities as m

    campaign = m.WheelCampaign(title="Discount test", is_active=False)
    db.add(campaign)
    db.flush()
    prize = m.WheelPrize(
        campaign_id=campaign.id,
        title=f"Скидка {percent}% в магазине",
        prize_type="shop_discount",
        amount=percent,
    )
    db.add(prize)
    db.flush()
    ticket = m.WheelTicket(operator_id=operator.id, campaign_id=campaign.id, status="used")
    db.add(ticket)
    db.flush()
    spin = m.WheelSpin(
        operator_id=operator.id,
        ticket_id=ticket.id,
        campaign_id=campaign.id,
        prize_id=prize.id,
        status="completed",
        result_payload_json=json.dumps({
            "title": prize.title,
            "type": "shop_discount",
            "amount": percent,
        }),
    )
    db.add(spin)
    db.flush()
    if materialize:
        from app.modules.wheel.service import _grant_prize
        _grant_prize(db, operator, campaign, prize, spin)
    db.commit()
    return spin


def test_old_wheel_discount_is_backfilled(db_session, make_client):
    client, operator = _operator_client(db_session, make_client)
    spin = _discount_spin(db_session, operator)

    response = client.get("/api/shop/discounts")
    assert response.status_code == 200, response.text
    coupons = response.json()
    assert len(coupons) == 1
    assert coupons[0]["percent"] == 10

    from app.models import entities as m
    coupon = db_session.query(m.ShopDiscountCoupon).filter_by(wheel_spin_id=spin.id).one()
    assert coupon.status == "available"


def test_purchase_uses_only_one_coupon(db_session, make_client):
    from app.models import entities as m

    client, operator = _operator_client(db_session, make_client, balance=200)
    _discount_spin(db_session, operator)
    _discount_spin(db_session, operator)
    coupons = client.get("/api/shop/discounts").json()
    item = m.ShopItem(title="Подарок", price=100)
    db_session.add(item)
    db_session.commit()

    response = client.post("/api/shop/purchases", json={
        "shop_item_id": item.id,
        "discount_coupon_id": coupons[0]["id"],
    })
    assert response.status_code == 200, response.text
    purchase = response.json()
    assert purchase["original_price"] == 100
    assert purchase["price"] == 90
    assert purchase["discount_amount"] == 10

    second = client.post("/api/shop/purchases", json={
        "shop_item_id": item.id,
        "discount_coupon_id": coupons[0]["id"],
    })
    assert second.status_code == 409, second.text
    available = client.get("/api/shop/discounts").json()
    assert [row["id"] for row in available] == [coupons[1]["id"]]


def test_rejected_purchase_returns_coupon(client, db_session, make_client):
    from app.models import entities as m

    operator_client, operator = _operator_client(db_session, make_client, balance=100)
    _discount_spin(db_session, operator)
    coupon = operator_client.get("/api/shop/discounts").json()[0]
    item = m.ShopItem(title="Кофе", price=100)
    db_session.add(item)
    db_session.commit()
    purchase = operator_client.post("/api/shop/purchases", json={
        "shop_item_id": item.id,
        "discount_coupon_id": coupon["id"],
    }).json()

    rejected = client.post(
        f"/api/shop/purchases/{purchase['id']}/reject",
        json={"reason": "Нет в наличии"},
    )
    assert rejected.status_code == 200, rejected.text
    assert operator_client.get("/api/shop/discounts").json()[0]["id"] == coupon["id"]


def test_approved_purchase_consumes_coupon(client, db_session, make_client):
    from app.models import entities as m

    operator_client, operator = _operator_client(db_session, make_client, balance=100)
    _discount_spin(db_session, operator, materialize=True)
    coupon = operator_client.get("/api/shop/discounts").json()[0]
    item = m.ShopItem(title="Перерыв", price=50)
    db_session.add(item)
    db_session.commit()
    purchase = operator_client.post("/api/shop/purchases", json={
        "shop_item_id": item.id,
        "discount_coupon_id": coupon["id"],
    }).json()

    approved = client.post(f"/api/shop/purchases/{purchase['id']}/approve")
    assert approved.status_code == 200, approved.text
    assert operator_client.get("/api/shop/discounts").json() == []
