"""Приёмочные сценарии ТЗ «Экономика коинов и магазин призов» v1.0."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.database.db import Base
from app.models import entities as m
from app.modules.economy.service import economy_analytics
from app.modules.tests.service import _maybe_award_reward
from app.services.economy_seed import (
    START_SEASON_CODE,
    STARTER_CATALOG,
    TEST_REWARD_RULES,
    ensure_economy_blueprint,
)
from tests.conftest import make_operator, make_operator_user


def _operator_client(db_session, make_client, *, balance: int = 1000):
    operator, user, password = make_operator_user(db_session)
    operator.current_balance = balance
    db_session.commit()
    client = make_client()
    response = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": password},
    )
    assert response.status_code == 200, response.text
    return operator, client


def test_blueprint_seed_is_draft_complete_and_idempotent(db_session):
    ensure_economy_blueprint(db_session)
    ensure_economy_blueprint(db_session)
    db_session.commit()

    season = db_session.scalar(
        select(m.EconomySeason).where(m.EconomySeason.code == START_SEASON_CODE)
    )
    assert season is not None
    assert season.status == "draft"
    assert season.ends_at - season.starts_at == timedelta(weeks=6)
    assert timedelta(days=7) <= season.ends_at - season.notification_at <= timedelta(days=14)
    assert season.config_json["requires_management_approval"] is True
    assert season.config_json["coins_expire"] is False

    expected_codes = {row[0] for row in STARTER_CATALOG}
    items = list(db_session.scalars(select(m.ShopItem).where(m.ShopItem.code.in_(expected_codes))))
    assert len(items) == len(STARTER_CATALOG) == 23
    assert all(item.is_active is False for item in items)
    assert len({item.code for item in items}) == 23

    by_code = {item.code: item for item in items}
    assert (by_code["chocolate"].price, by_code["wireless-headphones"].price) == (350, 3000)
    seasonal_prices = {
        row.shop_item.code: row.coin_price
        for row in db_session.scalars(
            select(m.ShopItemPrice).where(m.ShopItemPrice.season_id == season.id)
        )
        if row.shop_item.code in expected_codes
    }
    assert len(seasonal_prices) == 23
    assert seasonal_prices["chocolate"] == 250
    assert seasonal_prices["wireless-headphones"] == 2000

    expected_rules = {code: amount for code, _name, amount, _threshold in TEST_REWARD_RULES}
    actual_rules = {
        rule.source_code: rule.amount
        for rule in db_session.scalars(
            select(m.RewardRule).where(
                m.RewardRule.source_type == "test",
                m.RewardRule.source_code.in_(expected_rules),
            )
        )
    }
    assert actual_rules == expected_rules

    mission_rewards = {
        mission.code: mission.reward_coins
        for mission in db_session.scalars(
            select(m.Mission).where(
                m.Mission.code.in_(
                    {
                        "login_first_time",
                        "photo_control_basics",
                        "smz_sapar_provider_transfer",
                        "smz_sign_previous_month_acts",
                    }
                )
            )
        )
    }
    assert mission_rewards == {
        "login_first_time": 100,
        "photo_control_basics": 150,
        "smz_sapar_provider_transfer": 150,
        "smz_sign_previous_month_acts": 200,
    }


def test_store_contract_hides_drafts_and_is_idempotent(client, db_session, make_client):
    code = f"acceptance-prize-{now_utc().timestamp():.0f}"
    create = client.post(
        "/api/admin/store/prizes",
        json={
            "code": code,
            "title": "Приёмочный цифровой приз",
            "description": "Код приходит в кабинет",
            "category": "gifts",
            "prize_type": "digital",
            "issue_policy": "После подтверждения руководителем",
            "issue_days": 3,
            "price": 700,
            "is_active": False,
        },
    )
    assert create.status_code == 200, create.text
    item = create.json()
    assert item["name"] == item["title"]
    assert item["prize_type"] == "digital"

    operator, operator_client = _operator_client(db_session, make_client, balance=900)
    assert code not in {row["code"] for row in operator_client.get("/api/store/prizes").json()}

    activated = client.patch(
        f"/api/admin/store/prizes/{item['id']}",
        json={"is_active": True},
    )
    assert activated.status_code == 200, activated.text
    inventory = client.post(
        "/api/admin/store/inventory",
        json={"shop_item_id": item["id"], "add_received": 1, "min_stock_alert": 1},
    )
    assert inventory.status_code == 200, inventory.text
    assert any(
        row["shop_item_id"] == item["id"]
        for row in client.get("/api/admin/store/inventory").json()
    )
    prize = next(
        row for row in operator_client.get("/api/store/prizes").json() if row["code"] == code
    )
    assert prize["effective_price"] == 700
    assert prize["regular_price"] == 700

    missing_header = operator_client.post(
        "/api/store/orders",
        json={"shop_item_id": item["id"]},
    )
    assert missing_header.status_code == 422

    headers = {"Idempotency-Key": f"acceptance:{operator.id}:{item['id']}"}
    first = operator_client.post(
        "/api/store/orders",
        json={"shop_item_id": item["id"]},
        headers=headers,
    )
    repeated = operator_client.post(
        "/api/store/orders",
        json={"shop_item_id": item["id"]},
        headers=headers,
    )
    assert first.status_code == repeated.status_code == 200
    assert first.json()["id"] == repeated.json()["id"]
    assert first.json()["workflow_status"] == "reserved"
    assert first.json()["order_number"].startswith("PULS-")

    db_session.expire_all()
    db_session.refresh(operator)
    assert operator.current_balance == 200
    assert operator.reserved_balance == 700
    orders = operator_client.get("/api/store/orders/me").json()
    assert [row["id"] for row in orders].count(first.json()["id"]) == 1

    purchase_id = first.json()["id"]
    ready = client.post(f"/api/admin/store/orders/{purchase_id}/ready")
    assert ready.status_code == 200, ready.text
    assert ready.json()["workflow_status"] == "ready"
    ready_orders = client.get("/api/admin/store/orders", params={"status": "ready"}).json()
    assert any(row["id"] == purchase_id for row in ready_orders)
    issued = client.post(f"/api/admin/store/orders/{purchase_id}/issue")
    assert issued.status_code == 200, issued.text
    assert issued.json()["workflow_status"] == "issued"
    assert issued.json()["issued_at"] is not None

    refunded = client.post(
        f"/api/admin/store/orders/{purchase_id}/refund",
        json={"reason": "Приёмочная отмена"},
    )
    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["workflow_status"] == "refunded"
    db_session.expire_all()
    db_session.refresh(operator)
    assert operator.current_balance == 900
    assert operator.total_spent == 0
    reason_codes = {
        tx.reason_code
        for tx in db_session.scalars(
            select(m.CoinTransaction).where(m.CoinTransaction.related_purchase_id == purchase_id)
        )
    }
    assert {"purchase_reservation", "purchase_approved", "prize_issued", "purchase_refund"} <= reason_codes
    audits = list(
        db_session.scalars(
            select(m.AuditLog).where(
                m.AuditLog.entity_type == "shop_purchase",
                m.AuditLog.entity_id == purchase_id,
                m.AuditLog.action == "shop_order_status_change",
            )
        )
    )
    assert len(audits) == 3


def _finished_attempt(db, test, operator, number: int, score: float):
    attempt = m.TestAttempt(
        test_id=test.id,
        operator_id=operator.id,
        status="finished",
        expires_at=now_utc(),
        finished_at=now_utc(),
        score_percent=score,
        attempt_number=number,
    )
    db.add(attempt)
    db.flush()
    _maybe_award_reward(db, attempt, test, None)
    db.commit()
    db.refresh(attempt)
    return attempt


def test_test_reward_bands_do_not_farm_and_below_80_is_zero(db_session):
    test = m.Test(
        title="Тарифный тест экономики",
        status="open",
        reward_type="coins",
        reward_coins=999,
        reward_min_percent=0,
        reward_mode="economy",
        allow_retake=True,
        max_attempts=10,
    )
    db_session.add(test)
    db_session.flush()

    below_operator = make_operator(db_session)
    below = _finished_attempt(db_session, test, below_operator, 1, 79)
    assert below.reward_coins == 0
    db_session.refresh(below_operator)
    assert below_operator.current_balance == 0

    operator = make_operator(db_session)
    first = _finished_attempt(db_session, test, operator, 1, 85)
    improved = _finished_attempt(db_session, test, operator, 2, 95)
    perfect = _finished_attempt(db_session, test, operator, 3, 100)

    assert (first.reward_coins, improved.reward_coins, perfect.reward_coins) == (40, 20, 0)
    db_session.refresh(operator)
    assert operator.current_balance == 60
    reason_codes = [
        tx.reason_code
        for tx in db_session.scalars(
            select(m.CoinTransaction).where(
                m.CoinTransaction.operator_id == operator.id,
                m.CoinTransaction.source_type == "test",
            )
        )
    ]
    assert reason_codes.count("score_80_89") == 1
    assert reason_codes.count("score_improved") == 1
    assert "score_90_99" not in reason_codes
    assert "score_100" not in reason_codes


def test_economy_analytics_excludes_unconfirmed_reservations_from_spend():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    moment = now_utc()
    with Session(engine) as db:
        first = m.Operator(
            full_name="Первый оператор",
            group_name="Аналитика",
            employment_status="active",
            participation_status="participating",
            is_active=True,
            current_balance=300,
            created_at=moment - timedelta(days=20),
        )
        second = m.Operator(
            full_name="Второй оператор",
            group_name="Аналитика",
            employment_status="active",
            participation_status="participating",
            is_active=True,
            current_balance=100,
            created_at=moment - timedelta(days=30),
        )
        item = m.ShopItem(title="Приз аналитики", price=200, is_active=True)
        db.add_all([first, second, item])
        db.flush()
        db.add(
            m.CoinTransaction(
                operator_id=first.id,
                amount=100,
                type="reward",
                comment="Награда за миссию",
                source_type="mission",
                reason_code="mission_complete",
                created_at=moment - timedelta(days=1),
            )
        )
        db.add_all(
            [
                m.ShopPurchase(
                    operator_id=first.id,
                    shop_item_id=item.id,
                    price=200,
                    status="new",
                    created_at=moment - timedelta(days=2),
                ),
                m.ShopPurchase(
                    operator_id=first.id,
                    shop_item_id=item.id,
                    price=100,
                    status="approved",
                    created_at=moment - timedelta(days=10),
                ),
                m.ShopPurchase(
                    operator_id=second.id,
                    shop_item_id=item.id,
                    price=50,
                    status="completed",
                    created_at=moment - timedelta(days=10),
                ),
            ]
        )
        db.commit()

        result = economy_analytics(db, at=moment)

    assert result["active_operators"] == 2
    assert result["median_earnings"] == {"7": 50.0, "14": 50.0, "30": 50.0}
    assert result["median_days_to_first_purchase"] == 15.0
    assert result["purchased_within_14_days_percent"] == 50.0
    assert result["accrued_coins"] == 100
    assert result["spent_coins"] == 150
    assert result["orders_count"] == 3
    assert result["issued_orders_count"] == 1


def test_store_frontend_uses_effective_price_and_stable_idempotency_key():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    view = (root / "js/src/views/rating/20-rating-shop-summary.view.js").read_text("utf-8")
    api = (root / "js/src/api/domains/10-main-domains.api.js").read_text("utf-8")
    css = (root / "css/src/views/99-shop-operator-redesign.css").read_text("utf-8")

    for token in ("До 400", "До 700", "До 1 100", "Цифровые", "Физические", "Привилегии"):
        assert token in view
    assert "effective_price" in view
    assert "regular_price" in view
    assert "sessionStorage" in view
    assert "Idempotency-Key" in api
    assert "/api/store/orders" in api
    assert ":focus-visible" in css
