"""Supervisor-first team management keeps permissions and existing operator history intact."""

import pytest
from sqlalchemy import func, select

from app.models.city_estate import CityCell, CityEvent, CityObject
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.learning import LearningAttempt, LearningAward, LearningContent
from app.models.settings import AuditLog
from app.models.user import CoinAccount, Group
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_group, make_user
from tests.test_access import change as change_access
from tests.test_city_assignments import (
    CITY,
    configure,
    district,
    editable,
    fund,
    purchase,
    seed,
)

pytestmark = pytest.mark.asyncio
TEAMS = "/api/v1/admin/supervisor-teams"
USERS = "/api/v1/admin/users"


async def headers(client, user):
    return auth(await login(client, user.login))


@pytest.fixture
async def team_admin(session):
    return await make_user(session, login="team-admin", role=Role.ADMIN)


async def owned_groups(session, supervisor_id):
    return list(
        await session.scalars(
            select(Group)
            .where(Group.supervisor_id == supervisor_id, Group.is_active.is_(True))
            .order_by(Group.id)
            .execution_options(populate_existing=True)
        )
    )


async def count(session, model):
    return int(await session.scalar(select(func.count()).select_from(model)) or 0)


def create_payload(login_name, **changes):
    return {
        "login": login_name,
        "full_name": f"Сотрудник {login_name}",
        "password": "password123",
        "role": "operator",
        **changes,
    }


async def assign(client, actor_headers, supervisor_id, operator_ids, **changes):
    return await client.post(
        f"{TEAMS}/{supervisor_id}/operators",
        headers=actor_headers,
        json={"operator_ids": operator_ids, **changes},
    )


async def remove(client, actor_headers, supervisor_id, operator_ids):
    return await client.post(
        f"{TEAMS}/{supervisor_id}/operators/remove",
        headers=actor_headers,
        json={"operator_ids": operator_ids},
    )


async def test_creating_supervisor_creates_usable_team_without_second_form(
    client,
    session,
    team_admin,
):
    admin = await headers(client, team_admin)
    response = await client.post(
        USERS,
        headers=admin,
        json=create_payload("fresh-supervisor", role="supervisor"),
    )
    assert response.status_code == 201, response.text
    supervisor_id = response.json()["id"]
    groups = await owned_groups(session, supervisor_id)
    assert len(groups) == 1 and groups[0].name and groups[0].code
    group_id = groups[0].id

    # The creator assigns an operator using the person, without creating another group.
    operator = await client.post(
        USERS,
        headers=admin,
        json=create_payload("fresh-assigned-operator", supervisor_id=supervisor_id),
    )
    assert operator.status_code == 201, operator.text
    assert operator.json()["group"]["id"] == group_id
    assert [g.id for g in await owned_groups(session, supervisor_id)] == [group_id]
    teams = await client.get(TEAMS, headers=admin)
    assert teams.status_code == 200, teams.text
    row = next(item for item in teams.json() if item["supervisor"]["id"] == supervisor_id)
    assert row["group_id"] == group_id and row["operator_count"] == 1
    assert [item["id"] for item in row["groups"]] == [group_id]


async def test_promotion_creates_team_once_and_preserves_existing_legacy_group(
    client,
    session,
    team_admin,
):
    candidate = await make_user(session, login="promoted-team-owner")
    admin = await headers(client, team_admin)
    promoted = await client.patch(
        f"{USERS}/{candidate.id}",
        headers=admin,
        json={"role": "supervisor"},
    )
    assert promoted.status_code == 200, promoted.text
    created = await owned_groups(session, candidate.id)
    assert len(created) == 1
    renamed = await client.patch(
        f"{USERS}/{candidate.id}",
        headers=admin,
        json={"role": "supervisor", "full_name": "Переименованный супервайзер"},
    )
    assert renamed.status_code == 200, renamed.text
    assert [g.id for g in await owned_groups(session, candidate.id)] == [created[0].id]

    legacy = await make_user(session, login="legacy-team-owner", role=Role.SUPERVISOR)
    legacy_group = await make_group(session, code="LEGACY-UNCHANGED", supervisor_id=legacy.id)
    teammate = await make_user(session, login="legacy-member", group_id=legacy_group.id)
    original = (legacy_group.id, legacy_group.name, legacy_group.code, teammate.group_id)
    updated = await client.patch(
        f"{USERS}/{legacy.id}",
        headers=admin,
        json={"role": "supervisor"},
    )
    assert updated.status_code == 200, updated.text
    assert [g.id for g in await owned_groups(session, legacy.id)] == [legacy_group.id]
    await session.refresh(legacy_group)
    await session.refresh(teammate)
    assert (legacy_group.id, legacy_group.name, legacy_group.code, teammate.group_id) == original


async def test_team_directory_is_supervisor_scoped_and_active_by_default(
    client,
    session,
    team_admin,
    supervisor,
    operator,
    head,
):
    other = await make_user(session, login="other-directory-supervisor", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="OTHER-DIRECTORY", supervisor_id=other.id)
    await make_user(session, login="other-directory-operator", group_id=other_group.id)
    inactive_operator = await make_user(
        session,
        login="inactive-directory-operator",
        group_id=operator.group_id,
    )
    inactive_operator.is_active = False
    inactive_supervisor = await make_user(
        session,
        login="inactive-directory-supervisor",
        role=Role.SUPERVISOR,
    )
    inactive_supervisor.is_active = False
    await session.commit()
    sv = await client.get(TEAMS, headers=await headers(client, supervisor))
    assert sv.status_code == 200, sv.text
    assert [row["supervisor"]["id"] for row in sv.json()] == [supervisor.id]
    assert sv.json()[0]["operator_count"] == 1
    for actor in (head, team_admin):
        actor_headers = await headers(client, actor)
        active = await client.get(TEAMS, headers=actor_headers)
        assert active.status_code == 200, active.text
        assert {row["supervisor"]["id"] for row in active.json()} == {supervisor.id, other.id}
        all_rows = await client.get(TEAMS, headers=actor_headers, params={"include_inactive": True})
        assert all_rows.status_code == 200, all_rows.text
        assert {row["supervisor"]["id"] for row in all_rows.json()} == {
            supervisor.id,
            other.id,
            inactive_supervisor.id,
        }


@pytest.mark.parametrize("role", [Role.OPERATOR, Role.TRAINER])
async def test_operator_and_trainer_cannot_read_supervisor_team_directory(
    client,
    session,
    role,
):
    actor = await make_user(session, login="directory-denied", role=role)
    response = await client.get(TEAMS, headers=await headers(client, actor))
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("role", [Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR])
async def test_team_assignment_remains_head_only_with_explicit_section_grant(
    client,
    session,
    team_admin,
    supervisor,
    operator,
    role,
):
    actor = (
        supervisor
        if role == Role.SUPERVISOR
        else await make_user(
            session,
            login="assignment-denied",
            role=role,
        )
    )
    admin = await headers(client, team_admin)
    granted = await change_access(
        client,
        admin,
        kind="user",
        ids=[str(actor.id)],
        changes=[{"section": "team", "effect": "allow"}],
    )
    assert granted.status_code == 200, granted.text
    outsider = await make_user(session, login="not-self-selectable")
    actor_headers = await headers(client, actor)
    response = await assign(client, actor_headers, supervisor.id, [outsider.id])
    assert response.status_code == 403, response.text
    response = await remove(client, actor_headers, supervisor.id, [operator.id])
    assert response.status_code == 403, response.text
    await session.refresh(outsider)
    await session.refresh(operator)
    assert outsider.group_id is None and operator.group_id is not None


@pytest.mark.parametrize("field", ["supervisor_id", "group_id"])
async def test_trainer_can_create_operator_but_cannot_assign_team(
    client,
    session,
    supervisor,
    operator,
    field,
):
    trainer = await make_user(session, login="team-trainer", role=Role.TRAINER)
    value = supervisor.id if field == "supervisor_id" else operator.group_id
    denied = await client.post(
        USERS,
        headers=await headers(client, trainer),
        json=create_payload("trainer-assigned", **{field: value}),
    )
    assert denied.status_code == 403, denied.text
    allowed = await client.post(
        USERS,
        headers=await headers(client, trainer),
        json=create_payload("trainer-unassigned"),
    )
    assert allowed.status_code == 201, allowed.text


async def test_user_edit_can_assign_and_clear_supervisor_directly(
    client,
    session,
    team_admin,
    supervisor,
):
    target = await make_user(session, login="edit-supervisor-selection")
    group = (await owned_groups(session, supervisor.id))[0]
    admin = await headers(client, team_admin)
    assigned = await client.patch(
        f"{USERS}/{target.id}",
        headers=admin,
        json={"supervisor_id": supervisor.id},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["group"]["id"] == group.id
    cleared = await client.patch(
        f"{USERS}/{target.id}",
        headers=admin,
        json={"supervisor_id": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["group"] is None


async def test_assigning_operators_preserves_account_learning_and_revokes_old_manager(
    client,
    session,
    team_admin,
    supervisor,
    operator,
    head,
):
    old_group = operator.group_id
    destination = await make_user(session, login="destination-owner", role=Role.SUPERVISOR)
    destination_group = await make_group(session, code="DESTINATION", supervisor_id=destination.id)
    peer = await make_user(session, login="bulk-peer")
    await post_transaction(
        session,
        user_id=operator.id,
        amount=137,
        tx_type=TxType.LEARNING_REWARD,
        reason="Завершённое обучение до перевода",
        idempotency_key="team-test-learning",
    )
    content = LearningContent(kind="course", title="Пройденный курс", status="published")
    session.add(content)
    await session.flush()
    attempt = LearningAttempt(
        user_id=operator.id,
        content_id=content.id,
        snapshot={"revision": 1},
        state="passed",
        score=100,
        correct=1,
        awarded_coins=137,
    )
    session.add(attempt)
    await session.flush()
    award = LearningAward(user_id=operator.id, content_id=content.id, attempt_id=attempt.id)
    session.add(award)
    await session.commit()
    account = await session.get(CoinAccount, operator.id)
    before_account = (account.balance, account.reserved, account.total_earned, account.total_spent)
    award_id, attempt_id = award.id, attempt.id
    tx_count = await count(session, CoinTransaction)
    old_headers = await headers(client, supervisor)

    # Credentials can be changed by the old manager before the transfer.
    allowed = await client.post(
        f"{USERS}/{operator.id}/password",
        headers=old_headers,
        json={"password": "password-before-transfer"},
    )
    assert allowed.status_code == 200, allowed.text
    audit_before = await count(session, AuditLog)
    response = await assign(
        client, await headers(client, head), destination.id, [operator.id, peer.id]
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "supervisor_id": destination.id,
        "group_id": destination_group.id,
        "assigned_count": 2,
        "operator_ids": [operator.id, peer.id],
    }
    await session.refresh(operator)
    await session.refresh(peer)
    await session.refresh(account)
    assert operator.group_id == peer.group_id == destination_group.id
    assert (
        account.balance,
        account.reserved,
        account.total_earned,
        account.total_spent,
    ) == before_account
    assert await count(session, CoinTransaction) == tx_count
    assert (await session.get(LearningAward, award_id)).attempt_id == attempt_id
    await session.refresh(attempt)
    assert (attempt.state, attempt.score, attempt.awarded_coins) == ("passed", 100, 137)
    assert await count(session, AuditLog) > audit_before
    audit = await session.scalar(
        select(AuditLog)
        .where(AuditLog.actor_id == head.id, AuditLog.action == "supervisor_team.assign")
        .order_by(AuditLog.id.desc()),
    )
    assert audit is not None and audit.payload
    assert audit.entity_id == str(destination.id)
    assert audit.payload["operator_ids"] == [operator.id, peer.id]
    assert audit.payload["group_id"] == destination_group.id
    assert (await session.get(Group, old_group)).supervisor_id == supervisor.id

    denied_credit = await client.post(
        "/api/v1/admin/coins/manual",
        headers=old_headers,
        json={"user_id": operator.id, "amount": 11, "reason": "Прежняя команда"},
    )
    assert denied_credit.status_code == 403, denied_credit.text
    denied_password = await client.post(
        f"{USERS}/{operator.id}/password",
        headers=old_headers,
        json={"password": "password-after-transfer"},
    )
    assert denied_password.status_code == 403, denied_password.text
    new_credit = await client.post(
        "/api/v1/admin/coins/manual",
        headers=await headers(client, destination),
        json={"user_id": operator.id, "amount": 11, "reason": "Новая команда"},
    )
    assert new_credit.status_code == 200, new_credit.text


@pytest.mark.parametrize(
    "bad_kind",
    ["missing", "inactive", "nonoperator", "duplicate", "empty", "zero", "too_many"],
)
async def test_invalid_assignment_rejects_whole_selection(
    client,
    session,
    team_admin,
    supervisor,
    operator,
    bad_kind,
):
    untouched = await make_user(session, login="atomic-valid-operator")
    if bad_kind == "missing":
        ids = [untouched.id, 999999]
    elif bad_kind == "inactive":
        bad = await make_user(session, login="atomic-inactive")
        bad.is_active = False
        await session.commit()
        ids = [untouched.id, bad.id]
    elif bad_kind == "nonoperator":
        ids = [untouched.id, team_admin.id]
    elif bad_kind == "duplicate":
        ids = [untouched.id, untouched.id]
    elif bad_kind == "empty":
        ids = []
    elif bad_kind == "too_many":
        ids = list(range(1, 502))
    else:
        ids = [untouched.id, 0]
    admin = await headers(client, team_admin)
    before_audits = await count(session, AuditLog)
    response = await assign(client, admin, supervisor.id, ids)
    assert response.status_code in (400, 404, 409, 422), response.text
    await session.refresh(untouched)
    assert untouched.group_id is None
    assert await count(session, AuditLog) == before_audits
    await session.refresh(operator)
    assert operator.group_id is not None


async def test_legacy_multiple_groups_need_explicit_destination_and_keep_all_ids(
    client,
    session,
    team_admin,
    supervisor,
    operator,
):
    second = await make_group(session, code="SECOND-LEGACY", supervisor_id=supervisor.id)
    target = await make_user(session, login="ambiguous-target")
    admin = await headers(client, team_admin)
    response = await assign(client, admin, supervisor.id, [target.id])
    assert response.status_code in (400, 409), response.text
    await session.refresh(target)
    assert target.group_id is None
    direct = await client.patch(
        f"{USERS}/{target.id}",
        headers=admin,
        json={"supervisor_id": supervisor.id},
    )
    assert direct.status_code in (400, 409), direct.text
    explicit = await assign(client, admin, supervisor.id, [target.id], group_id=second.id)
    assert explicit.status_code == 200, explicit.text
    assert explicit.json()["group_id"] == second.id
    await session.refresh(target)
    assert target.group_id == second.id
    assert {g.id for g in await owned_groups(session, supervisor.id)} == {
        operator.group_id,
        second.id,
    }
    directory = await client.get(TEAMS, headers=admin)
    item = next(row for row in directory.json() if row["supervisor"]["id"] == supervisor.id)
    assert item["group_id"] in {operator.group_id, second.id}
    assert {g["id"] for g in item["groups"]} == {operator.group_id, second.id}
    assert item["operator_count"] == 2


async def test_destination_group_must_belong_to_selected_active_supervisor(
    client,
    session,
    team_admin,
    supervisor,
    operator,
):
    other = await make_user(session, login="mismatch-owner", role=Role.SUPERVISOR)
    foreign = await make_group(session, code="FOREIGN-MISMATCH", supervisor_id=other.id)
    archived = await make_group(session, code="ARCHIVED-MISMATCH", supervisor_id=supervisor.id)
    archived.is_active = False
    await session.commit()
    target = await make_user(session, login="mismatch-target")
    admin = await headers(client, team_admin)
    for group_id in (foreign.id, archived.id, 999999):
        response = await assign(client, admin, supervisor.id, [target.id], group_id=group_id)
        assert response.status_code in (400, 404, 409, 422), response.text
        update = await client.patch(
            f"{USERS}/{target.id}",
            headers=admin,
            json={"supervisor_id": supervisor.id, "group_id": group_id},
        )
        assert update.status_code in (400, 404, 409, 422), update.text
    await session.refresh(target)
    assert target.group_id is None
    other.is_active = False
    await session.commit()
    response = await assign(client, admin, other.id, [target.id], group_id=foreign.id)
    assert response.status_code in (400, 404, 409), response.text
    non_supervisor = await assign(client, admin, team_admin.id, [target.id])
    assert non_supervisor.status_code in (400, 404, 409), non_supervisor.text


async def test_removal_accepts_inactive_members_and_rejects_foreign_batch_atomically(
    client,
    session,
    team_admin,
    supervisor,
    operator,
):
    inactive = await make_user(session, login="remove-inactive-member", group_id=operator.group_id)
    inactive.is_active = False
    await session.commit()
    foreign = await make_user(session, login="remove-foreign-operator")
    admin = await headers(client, team_admin)
    rejected = await remove(client, admin, supervisor.id, [operator.id, foreign.id])
    assert rejected.status_code in (400, 403, 404, 409), rejected.text
    await session.refresh(operator)
    assert operator.group_id is not None
    response = await remove(client, admin, supervisor.id, [operator.id, inactive.id])
    assert response.status_code == 200, response.text
    assert {
        key: response.json()[key] for key in ("supervisor_id", "removed_count", "operator_ids")
    } == {
        "supervisor_id": supervisor.id,
        "removed_count": 2,
        "operator_ids": [operator.id, inactive.id],
    }
    for target in (operator, inactive):
        await session.refresh(target)
        assert target.group_id is None
    assert len(await owned_groups(session, supervisor.id)) == 1


async def test_user_search_can_filter_supervisor_and_unassigned_without_exposing_other_roles(
    client,
    session,
    team_admin,
    supervisor,
    operator,
):
    unassigned = await make_user(session, login="search-no-team")
    free_group = await make_group(session, code="SEARCH-NO-OWNER")
    ownerless = await make_user(session, login="search-ownerless", group_id=free_group.id)
    inactive_owner = await make_user(session, login="search-inactive-owner", role=Role.SUPERVISOR)
    stale_group = await make_group(
        session, code="SEARCH-INACTIVE-OWNER", supervisor_id=inactive_owner.id
    )
    stale = await make_user(session, login="search-stale-assignment", group_id=stale_group.id)
    inactive_owner.is_active = False
    await session.commit()
    admin = await headers(client, team_admin)
    owned = await client.get(
        USERS,
        headers=admin,
        params={
            "role": "operator",
            "supervisor_id": supervisor.id,
        },
    )
    assert owned.status_code == 200, owned.text
    assert [row["id"] for row in owned.json()["items"]] == [operator.id]
    free = await client.get(USERS, headers=admin, params={"role": "operator", "unassigned": True})
    assert free.status_code == 200, free.text
    free_ids = {row["id"] for row in free.json()["items"]}
    assert {unassigned.id, ownerless.id} <= free_ids
    assert operator.id not in free_ids and stale.id not in free_ids
    searched = await client.get(
        USERS,
        headers=admin,
        params={
            "role": "operator",
            "unassigned": True,
            "search": "ownerless",
        },
    )
    assert searched.status_code == 200, searched.text
    assert [row["id"] for row in searched.json()["items"]] == [ownerless.id]


async def test_operator_transfer_between_cities_stores_buildings_and_keeps_paid_level(
    client,
    session,
    team_admin,
    supervisor,
    operator,
):
    destination = await make_user(session, login="city-transfer-owner", role=Role.SUPERVISOR)
    destination_group = await make_group(
        session, code="CITY-TRANSFER", supervisor_id=destination.id
    )
    admin = await headers(client, team_admin)
    saved = await seed(client, admin, supervisor=supervisor)
    body = editable(saved)
    district(body, "sales")["supervisor_id"] = destination.id
    district(body, "sales")["construction"] = True
    await configure(client, admin, body)
    await fund(session, operator)
    operator_headers = await headers(client, operator)
    bought = await purchase(client, operator_headers)
    assert bought.status_code == 200, bought.text
    house = bought.json()["object"]
    tx_count = await count(session, CoinTransaction)
    events_before = await count(session, CityEvent)
    account = await session.get(CoinAccount, operator.id)
    balance = account.balance
    assert await count(session, CityCell) > 0

    moved = await assign(client, admin, destination.id, [operator.id])
    assert moved.status_code == 200, moved.text
    await session.refresh(operator)
    assert operator.group_id == destination_group.id
    stored = await session.get(CityObject, house["id"], populate_existing=True)
    assert (stored.state, stored.level, stored.paid, stored.owner_id) == (
        "stored",
        house["level"],
        house["paid"],
        operator.id,
    )
    assert await count(session, CityCell) == 0
    assert await count(session, CityEvent) > events_before
    assert await count(session, CoinTransaction) == tx_count
    await session.refresh(account)
    assert account.balance == balance
    estate = await client.get(CITY + "/estate", headers=operator_headers)
    assert estate.status_code == 200, estate.text
    assert estate.json()["district"]["id"] == "sales-team-1"
    assert estate.json()["objects"][0]["state"] == "stored"
