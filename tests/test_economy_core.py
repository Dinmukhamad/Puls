"""Автотесты экономики коинов (ТЗ §20: группы «Награды», «Ledger», «Сезоны», «Права»).

Покрытие фазы 1–2:
- идемпотентность ledger: повторный ключ не создаёт вторую выплату;
- reward rules: порог, одноразовость, сезонный приоритет;
- сезоны: активный сезон, эффективная цена, снапшот сезона в покупке,
  сохранение цены заказа после смены цен;
- права: self-award запрещён, начисление свыше лимита требует подтверждения.
"""
from __future__ import annotations

from datetime import timedelta

from tests.conftest import make_operator, make_operator_user


def _mk_season(client, code, *, starts_delta_h=-1, ends_delta_h=24, status="active"):
    from app.core.datetime_utils import now_utc
    now = now_utc()
    r = client.post(
        "/api/admin/economy/seasons",
        json={
            "code": code,
            "name": f"Сезон {code}",
            "starts_at": (now + timedelta(hours=starts_delta_h)).isoformat(),
            "ends_at": (now + timedelta(hours=ends_delta_h)).isoformat(),
            "status": status,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Ledger: идемпотентность
# ---------------------------------------------------------------------------

def test_add_transaction_idempotency_key_prevents_double_payout(client, db_session):
    from app.modules.wallet.service import add_transaction

    op = make_operator(db_session, balance=0)
    key = f"test:idem:operator:{op.id}:once"

    tx1 = add_transaction(db_session, op, 100, "reward", "Первая выплата",
                          idempotency_key=key)
    db_session.commit()
    balance_after_first = db_session.get(type(op), op.id).current_balance

    tx2 = add_transaction(db_session, op, 100, "reward", "Повтор",
                          idempotency_key=key)
    db_session.commit()
    db_session.refresh(op)

    assert balance_after_first == 100
    assert op.current_balance == 100, "повторный ключ не должен менять баланс"
    assert tx2.id == tx1.id, "должна вернуться исходная транзакция"


def test_accrue_reward_duplicate_event_returns_original(client, db_session):
    from app.modules.economy.service import accrue_reward

    r = client.post(
        "/api/admin/economy/rules",
        json={
            "source_type": "onboarding",
            "source_code": "profile_filled",
            "name": "Заполнение игрового профиля",
            "amount": 30,
        },
    )
    assert r.status_code == 200, r.text

    op = make_operator(db_session, balance=0)
    first = accrue_reward(db_session, op, source_type="onboarding",
                          source_code="profile_filled")
    db_session.commit()
    second = accrue_reward(db_session, op, source_type="onboarding",
                           source_code="profile_filled")
    db_session.commit()
    db_session.refresh(op)

    assert first["awarded"] is True and first["amount"] == 30
    assert second["awarded"] is False and second["reason"] == "duplicate"
    assert second["transaction_id"] == first["transaction_id"]
    assert op.current_balance == 30


# ---------------------------------------------------------------------------
# Reward rules: порог и сезонный приоритет
# ---------------------------------------------------------------------------

def test_reward_rule_threshold_blocks_low_score(client, db_session):
    from app.modules.economy.service import accrue_reward

    r = client.post(
        "/api/admin/economy/rules",
        json={
            "source_type": "test",
            "source_code": "score_80_89",
            "amount": 40,
            "threshold": 80,
        },
    )
    assert r.status_code == 200, r.text

    op = make_operator(db_session)
    below = accrue_reward(db_session, op, source_type="test", source_code="score_80_89",
                          score=79, event_key="attempt1")
    ok = accrue_reward(db_session, op, source_type="test", source_code="score_80_89",
                       score=85, event_key="attempt2")
    db_session.commit()

    assert below["awarded"] is False and below["reason"] == "below_threshold"
    assert ok["awarded"] is True and ok["amount"] == 40


def test_seasonal_rule_overrides_global(client, db_session):
    from app.modules.economy.service import accrue_reward

    season = _mk_season(client, "start-rules")
    # Глобальное правило 100, сезонное 150 — сезонное приоритетнее (ТЗ §4.2)
    assert client.post("/api/admin/economy/rules", json={
        "source_type": "mission", "source_code": "sapar_first_complete", "amount": 100,
    }).status_code == 200
    assert client.post("/api/admin/economy/rules", json={
        "source_type": "mission", "source_code": "sapar_first_complete", "amount": 150,
        "season_id": season["id"],
    }).status_code == 200

    op = make_operator(db_session)
    result = accrue_reward(db_session, op, source_type="mission",
                           source_code="sapar_first_complete")
    db_session.commit()
    assert result["awarded"] is True
    assert result["amount"] == 150, "в активный сезон действует сезонная сумма"


# ---------------------------------------------------------------------------
# Сезоны: эффективная цена и снапшоты покупки
# ---------------------------------------------------------------------------

def test_seasonal_price_in_catalog_and_purchase_snapshot(client, db_session, make_client):
    season = _mk_season(client, "start-prices")

    r = client.post("/api/shop/items", json={
        "title": "Фирменная кружка Puls", "description": "", "price": 950,
    })
    assert r.status_code == 200, r.text
    item = r.json()

    # Стартовая цена 750 при обычной 950 (ТЗ §8.2)
    r = client.post("/api/admin/economy/item-prices", json={
        "shop_item_id": item["id"], "season_id": season["id"], "coin_price": 750,
    })
    assert r.status_code == 200, r.text

    op, user, password = make_operator_user(db_session)
    op.current_balance = 800
    db_session.commit()

    op_client = make_client()
    assert op_client.post("/api/auth/login",
                          json={"username": user.username, "password": password}).status_code == 200

    # Каталог: эффективная цена + метка + будущая цена (ТЗ «нельзя повышать цены скрытно»)
    rows = op_client.get("/api/shop/items").json()
    card = next(x for x in rows if x["id"] == item["id"])
    assert card["effective_price"] == 750
    assert card["regular_price"] == 950
    assert card["is_seasonal_price"] is True
    assert card["season_ends_at"] is not None

    # Покупка идёт по сезонной цене; снапшот сезона и цены в заказе (ТЗ §12.1)
    r = op_client.post("/api/shop/purchases", json={"shop_item_id": item["id"]})
    assert r.status_code == 200, r.text
    db_session.expire_all()
    from app.models.entities import ShopPurchase
    purchase = db_session.get(ShopPurchase, r.json()["id"])
    assert purchase.price == 750
    assert purchase.season_id == season["id"]
    db_session.refresh(op)
    assert op.current_balance == 50

    # Повышение сезонной цены НЕ меняет существующий заказ (ТЗ §7.4, §19)
    assert client.post("/api/admin/economy/item-prices", json={
        "shop_item_id": item["id"], "season_id": season["id"], "coin_price": 900,
    }).status_code == 200
    db_session.expire_all()
    purchase = db_session.get(ShopPurchase, purchase.id)
    assert purchase.price == 750, "price_snapshot неизменен после смены цены"


def test_no_active_season_uses_regular_price(client, db_session, make_client):
    r = client.post("/api/shop/items", json={
        "title": "Шоколад (вне сезона)", "description": "", "price": 350,
    })
    item = r.json()
    op, user, password = make_operator_user(db_session)
    op_client = make_client()
    op_client.post("/api/auth/login", json={"username": user.username, "password": password})
    rows = op_client.get("/api/shop/items").json()
    card = next(x for x in rows if x["id"] == item["id"])
    # Активный сезон из других тестов может существовать, но без записи цены
    # для этого товара эффективная цена = базовая, без стартовой метки.
    assert card["effective_price"] == 350
    assert card["is_seasonal_price"] is False


# ---------------------------------------------------------------------------
# Права: self-award и лимит ручного начисления
# ---------------------------------------------------------------------------

def test_admin_cannot_award_self(client, db_session, make_client):
    from app.core.security import hash_password
    from app.models import entities as m

    op = make_operator(db_session)
    admin2 = m.User(
        full_name="Админ с оператором", username="admin_with_op",
        password_hash=hash_password("AdminOp123!"), role="admin",
        operator_id=op.id, is_active=True, must_change_password=False,
    )
    db_session.add(admin2)
    db_session.commit()

    c = make_client()
    assert c.post("/api/auth/login",
                  json={"username": "admin_with_op", "password": "AdminOp123!"}).status_code == 200
    r = c.post("/api/coins/manual-operation", json={
        "operator_id": op.id, "operation": "credit", "amount": 50, "reason": "Себе",
    })
    assert r.status_code == 403, r.text
    assert "самому себе" in r.json()["detail"]

    # Списание самому себе лимитом не блокируется (контролируется балансом)
    op.current_balance = 100
    db_session.commit()
    r = c.post("/api/coins/manual-operation", json={
        "operator_id": op.id, "operation": "debit", "amount": 10, "reason": "Корректировка",
    })
    assert r.status_code == 200, r.text


def test_manual_accrual_over_limit_requires_confirmation(client, db_session):
    op = make_operator(db_session)
    payload = {
        "operator_id": op.id, "operation": "credit", "amount": 150,
        "reason": "Особое достижение",
    }
    r = client.post("/api/coins/manual-operation", json=payload)
    assert r.status_code == 409, r.text

    r = client.post("/api/coins/manual-operation",
                    json={**payload, "confirm_over_limit": True})
    assert r.status_code == 200, r.text
    db_session.expire_all()
    db_session.refresh(op)
    assert op.current_balance == 150

    # До лимита включительно подтверждение не требуется
    r = client.post("/api/coins/manual-operation", json={
        "operator_id": op.id, "operation": "credit", "amount": 100, "reason": "Бонус",
    })
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# /economy/me
# ---------------------------------------------------------------------------

def test_economy_me_returns_balance_season_and_goal(client, db_session, make_client):
    _mk_season(client, "start-me")
    r = client.post("/api/shop/items", json={
        "title": "Недостижимый приз", "description": "", "price": 100000,
    })
    assert r.status_code == 200

    op, user, password = make_operator_user(db_session)
    op.current_balance = 120
    db_session.commit()

    c = make_client()
    c.post("/api/auth/login", json={"username": user.username, "password": password})
    data = c.get("/api/economy/me").json()
    assert data["balance"] == 120
    assert data["season"] is not None
    assert data["nearest_goal"] is not None
    assert data["nearest_goal"]["missing"] == data["nearest_goal"]["price"] - 120

    tx = c.get("/api/economy/transactions").json()
    assert "items" in tx


def test_operator_cannot_read_admin_economy(client, db_session, make_client):
    op, user, password = make_operator_user(db_session)
    c = make_client()
    c.post("/api/auth/login", json={"username": user.username, "password": password})
    assert c.get("/api/admin/economy/seasons").status_code == 403
    assert c.get("/api/admin/economy/rules").status_code == 403
