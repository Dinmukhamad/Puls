import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.models.access import AccessRule
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.settings import AuditLog
from app.models.user import CoinAccount
from app.services.coins import post_transaction
from app.services.rules import get_rules
from tests.conftest import auth, login, make_group, make_user
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


async def test_wallet_picker_and_history_cover_only_supervised_groups(
    client, session, operator, supervisor
):
    second_group = await make_group(session, code="WALLET-G2", supervisor_id=supervisor.id)
    second = await make_user(session, login="wallet-team-second", group_id=second_group.id)
    inactive = await make_user(
        session, login="wallet-team-inactive", group_id=operator.group_id
    )
    inactive.is_active = False
    other_supervisor = await make_user(session, login="wallet-other-sv", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="WALLET-OTHER", supervisor_id=other_supervisor.id)
    outsider = await make_user(session, login="wallet-team-outsider", group_id=other_group.id)
    unassigned = await make_user(session, login="wallet-team-unassigned")
    for recipient, amount in [(operator, 10), (second, 20), (inactive, 30), (outsider, 99)]:
        await post_transaction(
            session,
            user_id=recipient.id,
            amount=amount,
            tx_type=TxType.MANUAL_CREDIT,
            reason="Начальный баланс",
        )
    account = await session.get(CoinAccount, second.id)
    account.reserved = 7
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    path = "/api/v1/admin/wallet/operators"
    pages = [
        (await client.get(path + f"?size=1&page={page}", headers=headers)).json()
        for page in range(1, 4)
    ]
    assert all(page["total"] == 3 for page in pages)
    assert {page["items"][0]["user_id"] for page in pages} == {
        operator.id, second.id, inactive.id
    }
    found = await client.get(path + "?search=wallet-team-second", headers=headers)
    assert found.status_code == 200, found.text
    assert found.json()["items"] == [{
        "user_id": second.id,
        "full_name": second.full_name,
        "group_name": second_group.name,
        "is_active": True,
        "balance": 20,
        "reserved": 7,
        "available": 13,
    }]
    found = (await client.get(path + f"?user_id={inactive.id}", headers=headers)).json()
    assert found["items"][0]["is_active"] is False
    for hidden in (outsider, unassigned, supervisor):
        result = await client.get(path + f"?user_id={hidden.id}", headers=headers)
        assert result.json()["total"] == 0
        assert (
            await client.get(f"/api/v1/admin/wallet?user_id={hidden.id}", headers=headers)
        ).status_code == 403
    result = (await client.get("/api/v1/admin/wallet?size=1", headers=headers)).json()
    assert result["summary"]["balance"] == 60
    assert result["summary"]["reserved"] == 7
    assert result["summary"]["available"] == 53
    assert result["history"]["total"] == 3
    credit = await client.post(
        "/api/v1/admin/coins/manual",
        headers=headers,
        json={"user_id": second.id, "amount": 7, "reason": "Бонус второй группе"},
    )
    assert credit.status_code == 200, credit.text
    assert credit.json()["balance_after"] == 27


async def test_granted_legacy_ledger_still_limits_supervisor_to_own_operators(
    client, session, operator, supervisor
):
    outsider = await make_user(session, login="wallet-legacy-outsider")
    for user in (operator, outsider):
        await post_transaction(
            session,
            user_id=user.id,
            amount=10,
            reason="Запись старого журнала",
            tx_type=TxType.MANUAL_CREDIT,
        )
    session.add(AccessRule(
        target_type="user", target_id=str(supervisor.id), section="motivation", effect="allow"
    ))
    await session.commit()
    own_transaction = await session.scalar(select(CoinTransaction.id).where(
        CoinTransaction.user_id == operator.id
    ))
    headers = auth(await login(client, supervisor.login))
    response = await client.get("/api/v1/admin/coins/transactions", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert [item["id"] for item in response.json()["items"]] == [own_transaction]
    hidden = await client.get(
        f"/api/v1/admin/coins/transactions?user_id={outsider.id}", headers=headers
    )
    assert hidden.status_code == 200
    assert hidden.json()["total"] == 0


async def test_user_card_ledger_has_team_scope_and_original_author(
    client, session, operator, supervisor, head
):
    outsider = await make_user(session, login="wallet-card-outsider")
    head_headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=head_headers,
        json={"user_id": operator.id, "amount": 10, "reason": "Бонус оператора в карточке"},
    )
    assert response.status_code == 200, response.text
    original_name = head.full_name
    head.full_name = "Изменённое имя руководителя"
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    response = await client.get(
        f"/api/v1/admin/users/{operator.id}/transactions", headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["author_name"] == original_name
    assert (
        await client.get(f"/api/v1/admin/users/{outsider.id}/transactions", headers=headers)
    ).status_code == 403
    assert (
        await client.get(f"/api/v1/admin/users/{outsider.id}/transactions", headers=head_headers)
    ).status_code == 200
    legacy = await client.get("/api/v1/admin/coins/transactions", headers=head_headers)
    assert legacy.json()["items"][0]["author_name"] == original_name
    session.add(AccessRule(
        target_type="user", target_id=str(operator.id), section="motivation", effect="allow"
    ))
    await session.commit()
    own_headers = auth(await login(client, operator.login))
    own = await client.get(
        f"/api/v1/admin/users/{operator.id}/transactions", headers=own_headers
    )
    assert own.status_code == 200, own.text
    assert own.json()["items"][0]["author_name"] == original_name
    assert (
        await client.get(f"/api/v1/admin/users/{outsider.id}/transactions", headers=own_headers)
    ).status_code == 404
    own_picker = await client.get("/api/v1/admin/wallet/operators", headers=own_headers)
    assert [item["user_id"] for item in own_picker.json()["items"]] == [operator.id]


@pytest.mark.parametrize("role", [Role.HEAD, Role.ADMIN])
async def test_coin_managers_can_credit_debit_and_read_every_operator(
    client, session, operator, role
):
    actor = await make_user(session, login="wallet-manager", role=role)
    other = await make_user(session, login="wallet-any-operator")
    headers = auth(await login(client, actor.login))
    picker = await client.get("/api/v1/admin/wallet/operators", headers=headers)
    assert picker.status_code == 200, picker.text
    assert {row["user_id"] for row in picker.json()["items"]} == {operator.id, other.id}
    for amount in (25, -5):
        response = await client.post(
            "/api/v1/admin/coins/manual",
            headers=headers,
            json={
                "user_id": other.id,
                "amount": amount,
                "reason": "Ручная операция руководителя",
                "request_id": f"wallet-manager-{role}-{amount}",
            },
        )
        assert response.status_code == 200, response.text
    report = await client.get(f"/api/v1/admin/wallet?user_id={other.id}", headers=headers)
    assert report.status_code == 200, report.text
    result = report.json()
    assert result["summary"]["balance"] == 20
    assert result["summary"]["awarded"] == 25
    assert result["summary"]["spent"] == 5
    assert [item["balance_after"] for item in result["history"]["items"]] == [20, 25]
    assert all(item["author_name"] == actor.full_name for item in result["history"]["items"])
    assert all(item["author_role"] == role for item in result["history"]["items"])
    assert await session.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == "coins.manual"
    )) == 2
    wrong_target = await client.post(
        "/api/v1/admin/coins/manual",
        headers=headers,
        json={"user_id": actor.id, "amount": 1, "reason": "Неверная роль получателя"},
    )
    assert wrong_target.status_code == 400
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 2


@pytest.mark.parametrize("role", [Role.TRAINER, Role.OPERATOR])
async def test_non_managers_cannot_modify_operator_coins(client, session, operator, role):
    actor = await make_user(session, login="wallet-forbidden", role=role)
    headers = auth(await login(client, actor.login))
    for path in ("/api/v1/admin/wallet", "/api/v1/admin/wallet/operators"):
        assert (await client.get(path, headers=headers)).status_code == 403
    for amount in (10, -10):
        response = await client.post(
            "/api/v1/admin/coins/manual",
            headers=headers,
            json={"user_id": operator.id, "amount": amount, "reason": "Недопустимая операция"},
        )
        assert response.status_code == 403
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    assert (await session.get(CoinAccount, operator.id)).balance == 0


async def test_wallet_author_snapshots_are_preserved_without_profile_exposure(
    client, session, head, operator
):
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=headers,
        json={"user_id": operator.id, "amount": 10, "reason": "История с настоящим автором"},
    )
    assert response.status_code == 200, response.text
    original_name = head.full_name
    head.full_name = "Новое имя автора"
    for amount, kind, meta in [
        (1, TxType.LEARNING_REWARD, None),
        (2, TxType.MANUAL_CREDIT, {"actor_name": "Удалённый автор", "actor_role": "admin"}),
        (3, TxType.MANUAL_CREDIT, None),
    ]:
        await post_transaction(
            session,
            user_id=operator.id,
            amount=amount,
            tx_type=kind,
            reason="Старая запись",
            meta=meta,
        )
    await session.commit()
    own = auth(await login(client, operator.login))
    history = (await client.get("/api/v1/me/wallet", headers=own)).json()["history"]["items"]
    assert history[-1]["author_name"] == original_name
    assert history[-1]["author_role"] == "head"
    assert history[0]["author_name"] is None and history[0]["is_system"] is False
    assert history[1]["author_name"] == "Удалённый автор" and history[1]["is_system"] is False
    assert history[2]["author_name"] is None and history[2]["is_system"] is True
    assert not {"created_by_id", "login", "email", "phone", "meta"}.intersection(history[-1])


async def test_manual_reason_remains_required_with_zero_configured_minimum(
    client, session, head, operator
):
    rules = await get_rules(session)
    rules.manual_reason_min_length = 0
    await session.commit()
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=headers,
        json={"user_id": operator.id, "amount": 10, "reason": "   "},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "reason_required"
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


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
    assert history["items"][0]["author_role"] == Role.HEAD
    assert history["items"][0]["is_system"] is False


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


async def test_gratitude_confirmation_rejects_changed_bonus_without_writes(
    client, session, head, operator
):
    rules = await get_rules(session)
    checked_bonus = rules.driver_gratitude_bonus
    rules.driver_gratitude_bonus = checked_bonus + 1
    await session.commit()
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/coins/gratitude", headers=headers,
        json={
            "user_id": operator.id, "driver_ref": "confirmation",
            "request_id": "wallet-gratitude-checked-001", "expected_amount": checked_bonus,
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "gratitude_bonus_changed"
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    assert await session.scalar(select(func.count(Notification.id))) == 0
    assert (await session.get(CoinAccount, operator.id)).balance == 0


@pytest.mark.parametrize("confirmed", [False, True])
async def test_gratitude_replay_uses_original_bonus_after_rules_change(
    client, session, head, operator, confirmed
):
    rules = await get_rules(session)
    bonus = rules.driver_gratitude_bonus
    headers = auth(await login(client, head.login))
    payload = {
        "user_id": operator.id, "driver_ref": "frozen-ref",
        "request_id": "wallet-gratitude-frozen-001",
        **({"expected_amount": bonus} if confirmed else {}),
    }
    first = await client.post("/api/v1/admin/coins/gratitude", headers=headers, json=payload)
    assert first.status_code == 200, first.text
    rules.driver_gratitude_bonus = bonus + 1
    await session.commit()
    repeated = await client.post("/api/v1/admin/coins/gratitude", headers=headers, json=payload)
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["id"] == first.json()["id"]
    assert repeated.json()["amount"] == bonus
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1
    assert await session.scalar(select(func.count(Notification.id))) == 1
    changed_ref = await client.post(
        "/api/v1/admin/coins/gratitude", headers=headers,
        json={**payload, "driver_ref": "another-ref"},
    )
    assert changed_ref.status_code == 409
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1


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
    ).status_code == 200
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
        assert result.json()["total"] == 2
        assert result.json()["items"][0]["kind"] == kind
        assert result.json()["items"][0]["user_id"] == outsider.id
        second = await client.get(
            f"/api/v1/admin/learning-results?kind={kind}&size=1&page=2", headers=headers
        )
        assert second.json()["items"][0]["user_id"] == operator.id
