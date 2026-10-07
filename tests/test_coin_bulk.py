"""Financial batch boundaries: scoped recipients, atomic debit, confirmed retry."""

import asyncio
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import func, select, update

from app.core.config import settings
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.models.progress import Notification
from app.models.settings import AuditLog
from app.models.user import CoinAccount, User
from app.services import coin_bulk
from app.services.rules import get_rules
from tests.conftest import auth, login, make_group, make_user

BASE = "/api/v1/admin/coins/manual/bulk"


async def preview(client, headers, selection, amount=10):
    response = await client.post(
        BASE + "/preview", headers=headers, json={**selection, "amount": amount}
    )
    assert response.status_code == 200, response.text
    return response.json()


def command(selection, checked, *, key="coin-batch-request-001", reason="Общая премия команде"):
    return {
        **selection,
        "amount": checked["amount"],
        "reason": reason,
        "request_id": key,
        "selection_token": checked["selection_token"],
    }


@pytest.mark.parametrize("role", [Role.HEAD, Role.ADMIN])
async def test_all_operator_scope_counts_every_operator_and_records_each_author(
    client, session, operator, role
):
    actor = await make_user(session, login="bulk-manager", role=role)
    second = await make_user(session, login="bulk-inactive")
    second.is_active = False
    await make_user(session, login="bulk-trainer", role=Role.TRAINER)
    await session.commit()
    headers = auth(await login(client, actor.login))
    selection = {"all_operators": True}
    checked = await preview(client, headers, selection)
    assert checked["count"] == checked["eligible_count"] == 2
    assert checked["balance"] == checked["reserved"] == checked["available"] == 0
    assert checked["total_amount"] == 20 and checked["can_submit"] is True
    assert checked["recipients"] == [
        {"user_id": user.id, "full_name": user.full_name}
        for user in sorted((operator, second), key=lambda item: item.id)
    ]
    token = jwt.decode(
        checked["selection_token"], settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
    assert int(datetime.fromisoformat(checked["expires_at"]).timestamp()) == token["exp"]
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    result = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert result.status_code == 200, result.text
    assert result.json()["count"] == 2 and result.json()["total_amount"] == 20
    assert len(result.json()["transaction_ids"]) == 2
    entries = list(await session.scalars(select(CoinTransaction)))
    assert {entry.user_id for entry in entries} == {operator.id, second.id}
    assert all(entry.created_by_id == actor.id for entry in entries)
    assert all(entry.meta["actor_name"] == actor.full_name for entry in entries)
    assert await session.scalar(select(func.count(Notification.id))) == 2
    assert await session.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == "coins.manual"
    )) == 2


async def test_supervisor_group_and_all_selection_are_scoped_and_deduplicated(
    client, session, supervisor, operator, head
):
    second_group = await make_group(session, code="G2", supervisor_id=supervisor.id)
    teammate = await make_user(session, login="bulk-teammate", group_id=second_group.id)
    foreign_group = await make_group(session, code="foreign", supervisor_id=head.id)
    outsider = await make_user(session, login="bulk-outsider", group_id=foreign_group.id)
    headers = auth(await login(client, supervisor.login))
    groups = await client.get("/api/v1/admin/wallet/groups", headers=headers)
    assert groups.status_code == 200, groups.text
    assert {row["group_id"] for row in groups.json()} == {
        operator.group_id, second_group.id
    }
    assert all(row["operators_count"] == 1 for row in groups.json())
    group_selection = {"group_ids": [operator.group_id, second_group.id, second_group.id]}
    checked = await preview(client, headers, group_selection)
    assert checked["count"] == 2
    assert {row["user_id"] for row in checked["recipients"]} == {operator.id, teammate.id}
    assert all(set(row) == {"user_id", "full_name"} for row in checked["recipients"])
    assert outsider.full_name not in [row["full_name"] for row in checked["recipients"]]
    result = await client.post(
        BASE + "/apply", headers=headers, json=command(group_selection, checked)
    )
    assert result.status_code == 200, result.text
    assert result.json()["count"] == 2
    assert (await session.get(CoinAccount, outsider.id)).balance == 0
    all_checked = await preview(client, headers, {"all_operators": True})
    assert all_checked["count"] == 2
    assert (await session.get(CoinAccount, teammate.id)).balance == 10
    for selection in (
        {"group_ids": [foreign_group.id]},
        {"user_ids": [operator.id, outsider.id]},
        {"user_ids": [9999999]},
    ):
        rejected = await client.post(
            BASE + "/preview", headers=headers, json={**selection, "amount": 10}
        )
        assert rejected.status_code == 403, rejected.text
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 2


@pytest.mark.parametrize("role", [Role.TRAINER, Role.OPERATOR])
async def test_trainer_and_operator_cannot_preview_or_apply_batches(
    client, session, operator, role
):
    actor = await make_user(session, login="bulk-forbidden", role=role)
    headers = auth(await login(client, actor.login))
    for path in (BASE + "/preview", BASE + "/apply", BASE):
        response = await client.post(
            path, headers=headers,
            json={"user_ids": [operator.id], "amount": 10, "reason": "Не разрешено"},
        )
        assert response.status_code == 403, response.text
    assert (
        await client.get("/api/v1/admin/wallet/groups", headers=headers)
    ).status_code == 403
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_limit_9999_single_bulk_and_legacy_duplicates(client, session, head, operator):
    headers = auth(await login(client, head.login))
    selection = {"user_ids": [operator.id, operator.id]}
    checked = await preview(client, headers, selection, amount=9999)
    assert checked["count"] == 1 and checked["total_amount"] == 9999
    result = await client.post(BASE, headers=headers, json=command(selection, checked))
    assert result.status_code == 200, result.text
    assert len(result.json()) == 1 and result.json()[0]["amount"] == 9999
    debit = await client.post(
        "/api/v1/admin/coins/manual", headers=headers,
        json={"user_id": operator.id, "amount": -9999, "reason": "Возврат начисления"},
    )
    assert debit.status_code == 200, debit.text
    for amount in (10000, -10000, 0):
        invalid_bulk = await client.post(
            BASE + "/preview", headers=headers, json={**selection, "amount": amount}
        )
        assert invalid_bulk.status_code == 422
    invalid_single = await client.post(
        "/api/v1/admin/coins/manual", headers=headers,
        json={"user_id": operator.id, "amount": 10000, "reason": "Слишком много"},
    )
    assert invalid_single.status_code == 400
    rules = await get_rules(session)
    rules.manual_max_abs_amount = 50
    await session.commit()
    custom = await client.post(
        BASE + "/preview", headers=headers, json={**selection, "amount": 51}
    )
    assert custom.status_code == 400 and custom.json()["code"] == "amount_out_of_range"


async def test_debit_preview_and_atomic_rollback_protect_every_reserve(
    client, session, head, operator
):
    second = await make_user(session, login="bulk-reserved")
    first_account = await session.get(CoinAccount, operator.id)
    second_account = await session.get(CoinAccount, second.id)
    first_account.balance = 100
    second_account.balance = 100
    second_account.reserved = 80
    await session.commit()
    headers = auth(await login(client, head.login))
    selection = {"user_ids": [second.id, operator.id]}
    checked = await preview(client, headers, selection, amount=-30)
    assert checked["count"] == 2 and checked["eligible_count"] == 1
    assert checked["insufficient_count"] == 1 and checked["can_submit"] is False
    assert checked["balance"] == 200 and checked["reserved"] == 80
    assert checked["available"] == 120 and checked["min_available"] == 20
    failed = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert failed.status_code == 409 and failed.json()["code"] == "insufficient_coins"
    await session.refresh(first_account)
    await session.refresh(second_account)
    assert first_account.balance == second_account.balance == 100
    assert second_account.reserved == 80
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    assert await session.scalar(select(func.count(Notification.id))) == 0
    assert await session.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == "coins.manual"
    )) == 0
    checked = await preview(client, headers, selection, amount=-20)
    success = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert success.status_code == 200, success.text
    assert success.json()["count"] == 2 and success.json()["total_amount"] == -40
    await session.refresh(second_account)
    assert second_account.balance == second_account.reserved == 80


async def test_concurrent_retries_replay_original_group_members_and_reject_conflicts(
    client, session, head, operator
):
    group = await make_group(session, code="batch-group")
    operator.group_id = group.id
    teammate = await make_user(session, login="bulk-retry-member", group_id=group.id)
    await session.commit()
    headers = auth(await login(client, head.login))
    selection = {"group_ids": [group.id]}
    checked = await preview(client, headers, selection)
    payload = command(selection, checked)
    results = await asyncio.gather(*[
        client.post(BASE + "/apply", headers=headers, json=payload) for _ in range(2)
    ])
    assert [result.status_code for result in results] == [200, 200], [r.text for r in results]
    assert results[0].json() == results[1].json()
    assert results[0].json()["count"] == 2
    newcomer = await make_user(session, login="bulk-new-member", group_id=group.id)
    token_data = jwt.decode(
        checked["selection_token"], settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
    token_data["exp"] = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())
    expired = jwt.encode(token_data, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    replay = await client.post(
        BASE + "/apply", headers=headers, json={**payload, "selection_token": expired}
    )
    assert replay.status_code == 200 and replay.json() == results[0].json()
    assert (await session.get(CoinAccount, newcomer.id)).balance == 0
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 2
    assert (await session.get(CoinAccount, teammate.id)).balance == 10
    for change in ({"amount": 11}, {"reason": "Иная причина"}, {"group_ids": [999]}):
        conflict = await client.post(
            BASE + "/apply", headers=headers, json={**payload, **change}
        )
        assert conflict.status_code == 409, conflict.text
    newer = await preview(client, headers, selection)
    changed_snapshot = await client.post(
        BASE + "/apply", headers=headers,
        json={**payload, "selection_token": newer["selection_token"]},
    )
    assert changed_snapshot.status_code == 409


async def test_first_confirmation_rejects_changed_recipient_set_without_writes(
    client, session, head, operator
):
    headers = auth(await login(client, head.login))
    selection = {"all_operators": True}
    checked = await preview(client, headers, selection)
    await make_user(session, login="bulk-before-confirm")
    response = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert response.status_code == 409 and response.json()["code"] == "selection_changed"
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_group_member_move_while_waiting_for_user_lock_rejects_batch(
    client, session, head, operator, monkeypatch
):
    original = await make_group(session, code="batch-original")
    other = await make_group(session, code="batch-other")
    operator.group_id = original.id
    await session.commit()
    headers = auth(await login(client, head.login))
    selection = {"group_ids": [original.id]}
    checked = await preview(client, headers, selection)
    real_lock = coin_bulk.lock_user

    async def moving_lock(db, user_id):
        if user_id == operator.id:
            # Simulate the new row observed once a competing transfer releases its lock.
            await db.execute(update(User).where(User.id == user_id).values(group_id=other.id))
        await real_lock(db, user_id)

    monkeypatch.setattr(coin_bulk, "lock_user", moving_lock)
    response = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert response.status_code == 409 and response.json()["code"] == "selection_changed"
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_actor_role_is_rechecked_after_request_lock(
    client, session, head, operator, monkeypatch
):
    headers = auth(await login(client, head.login))
    selection = {"user_ids": [operator.id]}
    checked = await preview(client, headers, selection)
    real_lock = coin_bulk.lock_user

    async def demoted_lock(db, user_id):
        if user_id == head.id:
            await db.execute(update(User).where(User.id == user_id).values(role=Role.TRAINER))
        await real_lock(db, user_id)

    monkeypatch.setattr(coin_bulk, "lock_user", demoted_lock)
    response = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert response.status_code == 403
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_empty_group_and_invalid_selection_never_create_coin_records(
    client, session, head
):
    group = await make_group(session, code="batch-empty")
    headers = auth(await login(client, head.login))
    selection = {"group_ids": [group.id]}
    checked = await preview(client, headers, selection)
    assert checked["count"] == 0 and checked["can_submit"] is False
    assert checked["recipients"] == []
    assert checked["min_available"] is None
    response = await client.post(
        BASE + "/apply", headers=headers, json=command(selection, checked)
    )
    assert response.status_code == 400 and response.json()["code"] == "empty_selection"
    for selection in ({}, {"group_ids": [group.id], "all_operators": True}):
        invalid = await client.post(
            BASE + "/preview", headers=headers, json={**selection, "amount": 10}
        )
        assert invalid.status_code == 422
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_new_apply_requires_preview_and_retry_key_without_changing_accounts(
    client, session, head, operator
):
    headers = auth(await login(client, head.login))
    selection = {"user_ids": [operator.id]}
    checked = await preview(client, headers, selection)
    complete = command(selection, checked)
    for missing in ("request_id", "selection_token"):
        invalid = {key: value for key, value in complete.items() if key != missing}
        response = await client.post(BASE + "/apply", headers=headers, json=invalid)
        assert response.status_code == 422, response.text
        assert any(error["loc"][-1] == missing for error in response.json()["detail"])
    for field in ("request_id", "selection_token"):
        null_field = await client.post(
            BASE + "/apply", headers=headers, json={**complete, field: None}
        )
        assert null_field.status_code == 422, null_field.text
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    assert await session.scalar(select(func.count(Notification.id))) == 0
    assert (await session.get(CoinAccount, operator.id)).balance == 0
    # Existing clients keep the original /bulk contract without preview or retry fields.
    legacy = await client.post(
        BASE, headers=headers,
        json={**selection, "amount": 10, "reason": "Прежний интерфейс начисления"},
    )
    assert legacy.status_code == 200, legacy.text
    assert len(legacy.json()) == 1 and legacy.json()[0]["amount"] == 10
