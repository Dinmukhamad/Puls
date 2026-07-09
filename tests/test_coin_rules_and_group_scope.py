"""
Новое ТЗ §4 (настройки правил начисления) и §10 (усиление прав доступа):

  * GET/PUT /settings/coin-rules — курс/бонусы настраиваемые, не зашиты в код;
    супервайзер может только смотреть, менять может manager/admin;
  * points_to_coins() учитывает изменённый курс при следующем расчёте;
  * /coins/* эндпоинты, ранее отдававшие данные всех групп любому supervisor,
    теперь ограничены его собственной группой (баг, найденный в аудите).
"""
from __future__ import annotations

import uuid

from tests.conftest import make_operator


def _make_group(db, name: str | None = None):
    from app.models import entities as m

    group = m.Group(name=name or f"Группа {uuid.uuid4().hex[:8]}")
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _make_operator_in_group(db, group, **kwargs):
    op = make_operator(db, **kwargs)
    op.group_id = group.id
    db.commit()
    db.refresh(op)
    return op


def _make_role_user(db, *, role: str, group_id: int | None = None, password: str = "RolePass123!"):
    from app.core.security import hash_password
    from app.models import entities as m

    user = m.User(
        full_name=f"{role} {uuid.uuid4().hex[:6]}",
        username=f"{role}_{uuid.uuid4().hex[:10]}",
        password_hash=hash_password(password),
        role=role,
        group_id=group_id,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, password


def _login(make_client, username: str, password: str):
    c = make_client()
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


# ── §4: настройки правил начисления ─────────────────────────────────────────

def test_coin_rules_defaults_and_view_access(client, db_session, make_client):
    r = client.get("/api/settings/coin-rules")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["points_per_coin"] == 5
    assert data["rounding_mode"] == "floor"
    assert data["top_1_bonus"] == 15
    # Регрессия: эти 5 полей были в модели, но отсутствовали в CoinRuleRead —
    # API их молча не отдавал, фронт показывал галочки выключенными, а Сохранить
    # реально выключало номинации, даже если админ их не трогал.
    assert data["nomination_calls_enabled"] is True
    assert data["nomination_quality_enabled"] is True
    assert data["nomination_efficiency_enabled"] is True
    assert data["nomination_progress_enabled"] is True
    assert data["nomination_thanks_enabled"] is True

    supervisor, pwd = _make_role_user(db_session, role="supervisor")
    sup_client = _login(make_client, supervisor.username, pwd)
    r_sup = sup_client.get("/api/settings/coin-rules")
    assert r_sup.status_code == 200, r_sup.text


def test_operator_cannot_see_coin_rules(db_session, make_client):
    op, user, pwd = _make_operator_user_local(db_session)
    op_client = _login(make_client, user.username, pwd)
    r = op_client.get("/api/settings/coin-rules")
    assert r.status_code == 403


def _make_operator_user_local(db_session):
    from tests.conftest import make_operator_user
    return make_operator_user(db_session)


def test_supervisor_cannot_change_coin_rules(db_session, make_client):
    supervisor, pwd = _make_role_user(db_session, role="supervisor")
    sup_client = _login(make_client, supervisor.username, pwd)
    r = sup_client.put("/api/settings/coin-rules", json={"points_per_coin": 4})
    assert r.status_code == 403


def test_manager_can_update_coin_rules_and_rate_is_used(client, db_session):
    r = client.put("/api/settings/coin-rules", json={"points_per_coin": 10, "top_1_bonus": 20})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["points_per_coin"] == 10
    assert data["top_1_bonus"] == 20
    # бонусы, которые не передавали — не тронуты
    assert data["top_2_bonus"] == 10

    from app.modules.wallet.service import points_to_coins
    assert points_to_coins(95, db_session) == 9  # floor(95/10), а не floor(95/5)

    # старый вызов без сессии не завязан на настройки — поведение по умолчанию
    assert points_to_coins(95) == 19  # floor(95/5)

    # возвращаем курс на дефолт, чтобы не аукнулось другим тестам сессии
    r_reset = client.put("/api/settings/coin-rules", json={"points_per_coin": 5, "top_1_bonus": 15})
    assert r_reset.status_code == 200


def test_update_nomination_toggle_persists_and_others_untouched(client):
    """Регрессия: PUT с одним переключённым тумблером не должен молча
    выключать остальные четыре (раньше все 5 не были объявлены в
    CoinRuleUpdate и просто отбрасывались Pydantic'ом)."""
    r = client.put("/api/settings/coin-rules", json={"nomination_thanks_enabled": False})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["nomination_thanks_enabled"] is False
    assert data["nomination_calls_enabled"] is True
    assert data["nomination_quality_enabled"] is True
    assert data["nomination_efficiency_enabled"] is True
    assert data["nomination_progress_enabled"] is True

    r_reset = client.put("/api/settings/coin-rules", json={"nomination_thanks_enabled": True})
    assert r_reset.status_code == 200
    assert r_reset.json()["nomination_thanks_enabled"] is True


# ── §10: супервайзер ограничен своей группой в /coins/* ─────────────────────

def test_supervisor_scoped_to_own_group_in_coins_endpoints(db_session, make_client):
    from app.models import entities as m

    group_a = _make_group(db_session, "Группа A supervisor-scope")
    group_b = _make_group(db_session, "Группа B supervisor-scope")
    op_a = _make_operator_in_group(db_session, group_a, full_name="Оператор А")
    op_b = _make_operator_in_group(db_session, group_b, full_name="Оператор Б")

    tx_a = m.CoinTransaction(operator_id=op_a.id, amount=50, type="manual_accrual", comment="группа A")
    tx_b = m.CoinTransaction(operator_id=op_b.id, amount=60, type="manual_accrual", comment="группа Б")
    db_session.add_all([tx_a, tx_b])
    db_session.commit()

    supervisor, pwd = _make_role_user(db_session, role="supervisor", group_id=group_a.id)
    sup_client = _login(make_client, supervisor.username, pwd)

    # /coins/transactions — раньше супервайзер видел обе группы
    r = sup_client.get("/api/coins/transactions")
    assert r.status_code == 200, r.text
    names = " ".join(row["operator_name"] for row in r.json()["items"])
    assert "Оператор А" in names
    assert "Оператор Б" not in names

    # /coins/overview — счётчики и списки тоже только по своей группе
    r_overview = sup_client.get("/api/coins/overview")
    assert r_overview.status_code == 200, r_overview.text
    overview_names = " ".join(row["operator_name"] for row in r_overview.json()["latest_transactions"])
    assert "Оператор Б" not in overview_names

    # /coins/manual-operation на чужого оператора — 403, не молчаливый успех
    r_manual = sup_client.post("/api/coins/manual-operation", json={
        "operator_id": op_b.id, "operation": "credit", "amount": 10, "reason": "тест",
    })
    assert r_manual.status_code == 403, r_manual.text

    # в своей группе — по-прежнему можно
    r_manual_own = sup_client.post("/api/coins/manual-operation", json={
        "operator_id": op_a.id, "operation": "credit", "amount": 10, "reason": "тест",
    })
    assert r_manual_own.status_code == 200, r_manual_own.text


def test_supervisor_cannot_approve_purchase_of_other_group(db_session, make_client):
    from app.models import entities as m

    group_a = _make_group(db_session, "Группа A purchase-scope")
    group_b = _make_group(db_session, "Группа B purchase-scope")
    op_b = _make_operator_in_group(db_session, group_b, full_name="Покупатель Б", balance=100)

    item = m.ShopItem(title="Тестовый бонус", price=50)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    purchase = m.ShopPurchase(operator_id=op_b.id, shop_item_id=item.id, price=50, status="new")
    db_session.add(purchase)
    db_session.commit()
    db_session.refresh(purchase)

    supervisor, pwd = _make_role_user(db_session, role="supervisor", group_id=group_a.id)
    sup_client = _login(make_client, supervisor.username, pwd)

    r = sup_client.post(f"/api/coins/requests/{purchase.id}/approve")
    assert r.status_code == 403, r.text
