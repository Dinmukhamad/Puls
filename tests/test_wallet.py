import asyncio
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.models.coin import CoinTransaction
from app.models.enums import TxType
from app.models.progress import Notification
from app.models.user import CoinAccount
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_user
from tests.test_learning import publish


async def test_wallet_date_totals_types_and_current_balance(client, session, operator):
    balance = 0
    for day, amount, kind in [
        (1, 1000, TxType.MANUAL_CREDIT),
        (5, 100, TxType.MANUAL_CREDIT),
        (5, -40, TxType.PURCHASE),
        (5, 20, TxType.PURCHASE_REFUND),
        (6, 30, TxType.MANUAL_CREDIT),
    ]:
        balance += amount
        session.add(
            CoinTransaction(
                user_id=operator.id,
                amount=amount,
                tx_type=kind,
                reason=f"Операция {amount}",
                balance_after=balance,
                created_at=datetime(2026, 9, day, 23, 59, 59, tzinfo=UTC),
            )
        )
    account = await session.get(CoinAccount, operator.id)
    account.balance = balance
    account.reserved = 25
    account.total_earned = 1130
    await session.commit()
    headers = auth(await login(client, operator.login))
    path = "/api/v1/me/wallet?date_from=2026-09-05&date_to=2026-09-05"
    response = await client.get(path + "&size=1", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["summary"] == {
        "balance": 1110,
        "reserved": 25,
        "available": 1085,
        "accounts": 1,
        "earned_total": 1130,
        "awarded": 100,
        "spent": 40,
        "refunded": 20,
    }
    assert data["history"]["total"] == 3
    assert len(data["history"]["items"]) == 1
    for kind, expected in [("refund", 20), ("writeoff", -40), ("purchase", -40), ("accrual", 100)]:
        result = (await client.get(path + f"&kind={kind}", headers=headers)).json()
        assert result["summary"] == data["summary"]
        assert result["history"]["total"] == 1
        assert result["history"]["items"][0]["amount"] == expected


async def test_wallet_scope_and_invalid_dates(client, session, operator, supervisor):
    outsider = await make_user(session, login="wallet-outsider")
    account = await session.get(CoinAccount, outsider.id)
    account.balance = 9999
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    response = await client.get("/api/v1/admin/wallet", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["accounts"] == 1
    assert response.json()["summary"]["balance"] == 0
    assert (
        await client.get(f"/api/v1/admin/wallet?user_id={outsider.id}", headers=headers)
    ).status_code == 403
    own = auth(await login(client, operator.login))
    assert (await client.get("/api/v1/admin/wallet", headers=own)).status_code == 403
    for query in ["date_from=2026-09-06&date_to=2026-09-05", "date_to=9999-12-31"]:
        assert (await client.get("/api/v1/me/wallet?" + query, headers=own)).status_code == 400
    assert (await client.get("/api/v1/me/wallet?kind=unknown", headers=own)).status_code == 422


async def test_manual_coins_concurrent_replay_and_payload_conflict(client, session, head, operator):
    headers = auth(await login(client, head.login))
    payload = {
        "user_id": operator.id,
        "amount": 100,
        "reason": "Помощь сотруднику",
        "request_id": "wallet-manual-once-001",
    }
    responses = await asyncio.gather(
        *[
            client.post("/api/v1/admin/coins/manual", headers=headers, json=payload)
            for _ in range(2)
        ]
    )
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1
    assert await session.scalar(select(func.count(Notification.id))) == 1
    assert (await session.get(CoinAccount, operator.id)).balance == 100
    outsider = await make_user(session, login="wallet-another-target")
    for change in [{"amount": 99}, {"reason": "Другая причина"}, {"user_id": outsider.id}]:
        result = await client.post(
            "/api/v1/admin/coins/manual", headers=headers, json={**payload, **change}
        )
        assert result.status_code == 409, result.text
    own = auth(await login(client, operator.login))
    notification = (await client.get("/api/v1/me/notifications", headers=own)).json()["items"][0]
    assert notification["link"] == "/wallet"
    history = (await client.get("/api/v1/me/wallet", headers=own)).json()["history"]
    assert history["items"][0]["author_name"] == head.full_name


async def test_wallet_manual_debit_respects_reserve_and_scope(
    client, session, supervisor, operator
):
    account = await session.get(CoinAccount, operator.id)
    account.balance = 100
    account.reserved = 80
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    payload = {
        "user_id": operator.id,
        "amount": -30,
        "reason": "Корректировка результата",
        "request_id": "wallet-debit-once-001",
    }
    response = await client.post("/api/v1/admin/coins/manual", headers=headers, json=payload)
    assert response.status_code == 409
    assert response.json()["code"] == "insufficient_coins"
    payload["amount"] = -20
    response = await client.post("/api/v1/admin/coins/manual", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["balance_after"] == 80
    await session.refresh(account)
    assert account.reserved == 80
    outsider = await make_user(session, login="wallet-debit-outsider")
    assert (
        await client.post(
            "/api/v1/admin/coins/manual", headers=headers, json={**payload, "user_id": outsider.id}
        )
    ).status_code == 403


async def test_gratitude_retries_do_not_duplicate_coins(client, session, head, operator):
    headers = auth(await login(client, head.login))
    payload = {
        "user_id": operator.id,
        "driver_ref": "1234",
        "request_id": "wallet-gratitude-once-001",
    }
    first = await client.post("/api/v1/admin/coins/gratitude", headers=headers, json=payload)
    second = await client.post("/api/v1/admin/coins/gratitude", headers=headers, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert await session.scalar(select(func.count(Notification.id))) == 1


async def test_employee_coin_progress_summary_is_scoped(client, session, supervisor, operator):
    await post_transaction(
        session,
        user_id=operator.id,
        amount=600,
        reason="Заработок сотрудника",
        tx_type=TxType.MANUAL_CREDIT,
        idempotency_key="employee-summary",
    )
    await session.commit()
    outsider = await make_user(session, login="xp-hidden-employee")
    headers = auth(await login(client, supervisor.login))
    result = await client.get(f"/api/v1/admin/progress/users/{operator.id}", headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 600
    assert result.json()["current"]["title"] == "Специалист"
    assert (
        await client.get(f"/api/v1/admin/progress/users/{outsider.id}", headers=headers)
    ).status_code == 404
    own = auth(await login(client, operator.login))
    assert (
        await client.get(f"/api/v1/admin/progress/users/{operator.id}", headers=own)
    ).status_code == 403


async def test_employee_learning_filters_before_pagination_and_respects_scope(
    client, session, head, operator, supervisor
):
    outsider = await make_user(session, login="learning-hidden-employee")
    own = auth(await login(client, operator.login))
    other = auth(await login(client, outsider.login))
    for kind in ["test", "mission", "simulator"]:
        material = await publish(client, head, kind=kind)
        for headers in [own, other]:
            result = await client.post(f"/api/v1/learning/{material['id']}/start", headers=headers)
            assert result.status_code == 200, result.text
    headers = auth(await login(client, supervisor.login))
    for kind in ["test", "mission", "simulator"]:
        result = await client.get(
            f"/api/v1/admin/learning-results?kind={kind}&size=1", headers=headers
        )
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 1
        assert result.json()["items"][0]["kind"] == kind
        assert result.json()["items"][0]["user_id"] == operator.id
