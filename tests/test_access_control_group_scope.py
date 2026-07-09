"""
Усиление прав доступа (ТЗ §10.2): супервайзер ограничен своей группой не
только в /coins/* (см. test_coin_rules_and_group_scope.py), но и в:

  * /shop/purchases — список, approve/reject/complete;
  * /operators — список, детальный просмотр, редактирование, увольнение,
    восстановление, сброс пароля, создание нового оператора.

manager/admin — без ограничений везде.
"""
from __future__ import annotations

from tests.test_coin_rules_and_group_scope import (
    _login,
    _make_group,
    _make_operator_in_group,
    _make_role_user,
)


def _supervisor_with_group(db, group, *, can_manage_operators=False):
    user, pwd = _make_role_user(db, role="supervisor", group_id=group.id)
    if can_manage_operators:
        user.can_manage_operators = True
        db.commit()
    return user, pwd


# ── /shop/purchases ──────────────────────────────────────────────────────────

def test_supervisor_shop_purchases_scoped_to_own_group(db_session, make_client):
    from app.models import entities as m

    group_a = _make_group(db_session, "ShopA")
    group_b = _make_group(db_session, "ShopB")
    op_a = _make_operator_in_group(db_session, group_a, full_name="ПокупательА", balance=100)
    op_b = _make_operator_in_group(db_session, group_b, full_name="ПокупательБ", balance=100)

    item = m.ShopItem(title="Бонус", price=10)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    purchase_a = m.ShopPurchase(operator_id=op_a.id, shop_item_id=item.id, price=10, status="new")
    purchase_b = m.ShopPurchase(operator_id=op_b.id, shop_item_id=item.id, price=10, status="new")
    db_session.add_all([purchase_a, purchase_b])
    db_session.commit()

    supervisor, pwd = _supervisor_with_group(db_session, group_a)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_list = sup_client.get("/api/shop/purchases")
    assert r_list.status_code == 200, r_list.text
    operator_ids = {p["operator_id"] for p in r_list.json()}
    assert op_a.id in operator_ids
    assert op_b.id not in operator_ids

    r_approve_other = sup_client.post(f"/api/shop/purchases/{purchase_b.id}/approve")
    assert r_approve_other.status_code == 403, r_approve_other.text

    r_reject_other = sup_client.post(f"/api/shop/purchases/{purchase_b.id}/reject", json={"reason": "тест"})
    assert r_reject_other.status_code == 403, r_reject_other.text

    r_approve_own = sup_client.post(f"/api/shop/purchases/{purchase_a.id}/approve")
    assert r_approve_own.status_code == 200, r_approve_own.text


def test_manager_shop_purchases_sees_all_groups(client, db_session):
    from app.models import entities as m

    group = _make_group(db_session, "ShopManagerCheck")
    op = _make_operator_in_group(db_session, group, full_name="ЛюбойОператор")
    item = db_session.query(m.ShopItem).first() or m.ShopItem(title="Общий", price=5)
    if not item.id:
        db_session.add(item)
        db_session.commit()
        db_session.refresh(item)
    purchase = m.ShopPurchase(operator_id=op.id, shop_item_id=item.id, price=5, status="new")
    db_session.add(purchase)
    db_session.commit()

    r = client.get("/api/shop/purchases")
    assert r.status_code == 200
    assert any(p["operator_id"] == op.id for p in r.json())


# ── /operators ───────────────────────────────────────────────────────────────

def test_supervisor_operator_list_and_detail_scoped(db_session, make_client):
    group_a = _make_group(db_session, "OpA")
    group_b = _make_group(db_session, "OpB")
    op_a = _make_operator_in_group(db_session, group_a, full_name="ОпероторА")
    op_b = _make_operator_in_group(db_session, group_b, full_name="ОпероторБ")

    supervisor, pwd = _supervisor_with_group(db_session, group_a)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_list = sup_client.get("/api/operators")
    assert r_list.status_code == 200, r_list.text
    ids = {o["id"] for o in r_list.json()}
    assert op_a.id in ids
    assert op_b.id not in ids

    r_own = sup_client.get(f"/api/operators/{op_a.id}")
    assert r_own.status_code == 200

    r_other = sup_client.get(f"/api/operators/{op_b.id}")
    assert r_other.status_code == 403, r_other.text


def test_supervisor_cannot_manage_operator_of_other_group(db_session, make_client):
    group_a = _make_group(db_session, "MgmtA")
    group_b = _make_group(db_session, "MgmtB")
    op_own = _make_operator_in_group(db_session, group_a, full_name="СвойОператор")
    op_other = _make_operator_in_group(db_session, group_b, full_name="ЧужойОператор")

    supervisor, pwd = _supervisor_with_group(db_session, group_a, can_manage_operators=True)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_patch_other = sup_client.patch(f"/api/operators/{op_other.id}", json={"position": "chat_manager"})
    assert r_patch_other.status_code == 403, r_patch_other.text

    r_patch_own = sup_client.patch(f"/api/operators/{op_own.id}", json={"position": "chat_manager"})
    assert r_patch_own.status_code == 200, r_patch_own.text

    r_dismiss_other = sup_client.post(f"/api/operators/{op_other.id}/dismiss")
    assert r_dismiss_other.status_code == 403, r_dismiss_other.text

    r_reset_pwd_other = sup_client.post(f"/api/operators/{op_other.id}/reset-password")
    assert r_reset_pwd_other.status_code == 403, r_reset_pwd_other.text

    r_dismiss_own = sup_client.post(f"/api/operators/{op_own.id}/dismiss")
    assert r_dismiss_own.status_code == 200, r_dismiss_own.text

    r_restore_other = sup_client.post(f"/api/operators/{op_other.id}/restore", json={"participation_status": "participating"})
    assert r_restore_other.status_code == 403, r_restore_other.text

    r_restore_own = sup_client.post(f"/api/operators/{op_own.id}/restore", json={"participation_status": "participating"})
    assert r_restore_own.status_code == 200, r_restore_own.text


def test_supervisor_can_only_create_operator_in_own_group(db_session, make_client):
    group_a = _make_group(db_session, "CreateA")
    group_b = _make_group(db_session, "CreateB")

    supervisor, pwd = _supervisor_with_group(db_session, group_a, can_manage_operators=True)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_other_group = sup_client.post("/api/operators", json={
        "full_name": "Новый Чужой", "group_id": group_b.id,
    })
    assert r_other_group.status_code == 403, r_other_group.text

    r_own_group = sup_client.post("/api/operators", json={
        "full_name": "Новый Свой", "group_id": group_a.id,
    })
    assert r_own_group.status_code == 200, r_own_group.text


def test_manager_operators_not_restricted_by_group(client, db_session):
    group_a = _make_group(db_session, "ManagerA")
    group_b = _make_group(db_session, "ManagerB")
    op_a = _make_operator_in_group(db_session, group_a, full_name="МенеджерВидитА")
    op_b = _make_operator_in_group(db_session, group_b, full_name="МенеджерВидитБ")

    r_list = client.get("/api/operators")
    ids = {o["id"] for o in r_list.json()}
    assert op_a.id in ids
    assert op_b.id in ids

    assert client.get(f"/api/operators/{op_a.id}").status_code == 200
    assert client.get(f"/api/operators/{op_b.id}").status_code == 200
