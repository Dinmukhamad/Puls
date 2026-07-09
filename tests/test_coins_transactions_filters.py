"""
ТЗ §6: фильтры и пагинация истории операций (/coins/transactions).

Раньше фильтров было два (type, operator_id, даты), эндпоинт отдавал все
строки сразу, без limit/offset. Проверяем новые фильтры (source, created_by)
и то, что пагинация реально ограничивает выборку, а total считает все
подходящие строки, а не только текущую страницу.
"""
from __future__ import annotations

from tests.conftest import make_operator


def _add_tx(db, operator, amount, tx_type, source_type=None, created_by_user_id=None):
    from app.models import entities as m

    tx = m.CoinTransaction(
        operator_id=operator.id,
        amount=amount,
        type=tx_type,
        comment="тест",
        source_type=source_type,
        created_by_user_id=created_by_user_id,
    )
    db.add(tx)
    db.commit()
    return tx


def test_source_filter(client, db_session):
    op = make_operator(db_session, full_name="ИсточникТест")
    _add_tx(db_session, op, 10, "weekly_accrual", source_type="weekly_auto_accrual")
    _add_tx(db_session, op, 5, "manual_add", source_type=None)

    r = client.get(f"/api/coins/transactions?operator_id={op.id}&source=weekly_auto_accrual")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["source_type"] == "weekly_auto_accrual"


def test_created_by_filter(client, db_session):
    from app.models import entities as m

    admin_user = db_session.query(m.User).filter_by(username="admin").one()
    op = make_operator(db_session, full_name="АвторТест")
    _add_tx(db_session, op, 10, "manual_add", created_by_user_id=admin_user.id)
    _add_tx(db_session, op, 5, "manual_add", created_by_user_id=None)

    r = client.get(f"/api/coins/transactions?operator_id={op.id}&created_by={admin_user.id}")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["created_by_user_id"] == admin_user.id


def test_pagination_limits_page_but_total_counts_all(client, db_session):
    op = make_operator(db_session, full_name="ПагинацияТест")
    for i in range(7):
        _add_tx(db_session, op, i + 1, "manual_add")

    r = client.get(f"/api/coins/transactions?operator_id={op.id}&limit=3&offset=0")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["items"]) == 3
    assert data["total"] == 7
    assert data["limit"] == 3
    assert data["offset"] == 0

    r2 = client.get(f"/api/coins/transactions?operator_id={op.id}&limit=3&offset=3")
    page2 = r2.json()["items"]
    assert len(page2) == 3
    ids_page1 = {i["id"] for i in data["items"]}
    ids_page2 = {i["id"] for i in page2}
    assert not ids_page1 & ids_page2, "страницы не должны пересекаться"

    r3 = client.get(f"/api/coins/transactions?operator_id={op.id}&limit=3&offset=6")
    assert len(r3.json()["items"]) == 1  # последняя, неполная страница


def test_limit_is_capped(client, db_session):
    op = make_operator(db_session, full_name="ЛимитТест")
    r = client.get(f"/api/coins/transactions?operator_id={op.id}&limit=9999")
    assert r.status_code == 422, "limit выше разрешённого максимума должен отклоняться"


def test_export_respects_filters(client, db_session):
    op = make_operator(db_session, full_name="ЭкспортФильтр")
    _add_tx(db_session, op, 10, "weekly_accrual", source_type="weekly_auto_accrual")
    _add_tx(db_session, op, 5, "manual_add")

    r = client.get(f"/api/coins/transactions/export?operator_id={op.id}&source=weekly_auto_accrual")
    assert r.status_code == 200, r.text
    body = r.text
    assert "weekly_accrual" in body
    assert "manual_add" not in body
