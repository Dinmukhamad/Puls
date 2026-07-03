"""
P1.1: /coins/overview считает «сегодня» по Asia/Almaty, а не по UTC-дню сервера.

Транзакция, созданная в самом начале локального дня (00:00 по Алматы =
19:00 UTC ПРЕДЫДУЩЕГО дня), обязана попасть в «сегодня». Старая логика
через date.today() (UTC) относила её ко «вчера».
"""
from __future__ import annotations

from datetime import timedelta

from app.core.datetime_utils import local_day_bounds_utc
from tests.conftest import make_operator


def _overview(client):
    r = client.get("/api/coins/overview")
    assert r.status_code == 200, r.text
    return r.json()


def test_early_morning_local_tx_counts_as_today(client, db_session):
    from app.models import entities as m

    op = make_operator(db_session, balance=0)
    before = _overview(client)

    start_utc, _end_utc = local_day_bounds_utc()
    # UTC-дата этой метки — вчерашняя: именно её терял старый date.today()
    assert start_utc.date() < (start_utc + timedelta(hours=5)).date()

    tx_in = m.CoinTransaction(
        operator_id=op.id, amount=777, type="manual_accrual",
        comment="00:00 по Алматы", created_at=start_utc,
    )
    # Секунда ДО начала локального дня — не должна попасть в «сегодня»
    tx_out = m.CoinTransaction(
        operator_id=op.id, amount=555, type="manual_accrual",
        comment="23:59:59 вчера по Алматы", created_at=start_utc - timedelta(seconds=1),
    )
    db_session.add_all([tx_in, tx_out])
    db_session.commit()

    after = _overview(client)
    assert after["today_operations"] - before["today_operations"] == 1
    assert after["today_credited"] - before["today_credited"] == 777
