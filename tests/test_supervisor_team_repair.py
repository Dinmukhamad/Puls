"""One-time ownership repair preserves memberships and aborts incomplete plans atomically."""

import json
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.models.city import CityWorld
from app.models.city_estate import CityCell, CityEvent, CityObject
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.learning import LearningAttempt, LearningAward, LearningContent
from app.models.settings import AuditLog, GamificationSettings
from app.models.user import CoinAccount, Group, User
from app.services import city_estate, city_world, supervisor_team_repair
from app.services.coins import post_transaction
from tests.conftest import make_group, make_user

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def repair_fixture(session):
    previous = await make_user(session, login="former-team-owner", role=Role.SUPERVISOR)
    first = await make_user(session, login="first-team-owner", role=Role.SUPERVISOR)
    second = await make_user(session, login="second-team-owner", role=Role.SUPERVISOR)
    source = await make_group(session, code="SOURCE-TEAM", supervisor_id=previous.id)
    vacant = await make_group(session, code="VACANT-TEAM")
    untouched = await make_group(session, code="UNTOUCHED-TEAM", supervisor_id=previous.id)
    active = await make_user(session, login="active-member", group_id=source.id)
    inactive = await make_user(session, login="inactive-member", group_id=source.id)
    inactive.is_active = False
    free_member = await make_user(session, login="vacant-team-member", group_id=vacant.id)
    other_member = await make_user(session, login="unrelated-member", group_id=untouched.id)
    trainee = await make_user(session, login="unassigned-trainee")
    inactive_trainee = await make_user(session, login="inactive-unassigned-trainee")
    inactive_trainee.is_active = False
    await session.commit()
    return {
        "previous": previous.id,
        "first": first.id,
        "second": second.id,
        "source": source.id,
        "vacant": vacant.id,
        "untouched": untouched.id,
        "active": active.id,
        "inactive": inactive.id,
        "free_member": free_member.id,
        "other_member": other_member.id,
        "trainee": trainee.id,
        "inactive_trainee": inactive_trainee.id,
        "plan": {
            "repair_id": "test-legacy-team-ownership",
            "ownership_changes": [
                {
                    "group_id": source.id,
                    "expected_group_code": source.code,
                    "expected_supervisor_id": previous.id,
                    "supervisor_id": first.id,
                },
                {
                    "group_id": vacant.id,
                    "expected_group_code": vacant.code,
                    "expected_supervisor_id": None,
                    "supervisor_id": second.id,
                },
            ],
        },
    }


async def owners(session):
    return dict((await session.execute(select(Group.id, Group.supervisor_id))).all())


async def memberships(session):
    return dict((await session.execute(select(User.id, User.group_id))).all())


async def audit_count(session):
    return int(await session.scalar(select(func.count()).select_from(AuditLog)) or 0)


async def apply(session, plan):
    return await supervisor_team_repair.apply_plan(session, json.dumps(plan))


async def test_repair_changes_only_group_owners_and_preserves_member_history(
    session, repair_fixture
):
    f = repair_fixture
    for user_id in (f["active"], f["inactive"], f["trainee"]):
        await post_transaction(
            session,
            user_id=user_id,
            amount=137,
            tx_type=TxType.LEARNING_REWARD,
            reason="Completed training before ownership repair",
            idempotency_key=f"repair-training-{user_id}",
        )
    content = LearningContent(kind="course", title="Previous training", status="published")
    session.add(content)
    await session.flush()
    attempt = LearningAttempt(
        user_id=f["active"],
        content_id=content.id,
        snapshot={"revision": 1},
        state="passed",
        score=100,
        correct=1,
        awarded_coins=137,
    )
    session.add(attempt)
    await session.flush()
    award = LearningAward(user_id=f["active"], content_id=content.id, attempt_id=attempt.id)
    session.add(award)
    await session.commit()
    before_members = await memberships(session)
    before_accounts = (
        await session.execute(
            select(
                CoinAccount.user_id,
                CoinAccount.balance,
                CoinAccount.reserved,
                CoinAccount.total_earned,
                CoinAccount.total_spent,
            ).order_by(CoinAccount.user_id)
        )
    ).all()
    before_transactions = (
        await session.execute(
            select(
                CoinTransaction.id,
                CoinTransaction.user_id,
                CoinTransaction.amount,
            ).order_by(CoinTransaction.id)
        )
    ).all()
    attempt_id, award_id = attempt.id, award.id

    result = await apply(session, f["plan"])

    assert result.status == "applied" and result.updated_groups == 2
    assert result.reconciled_operators == 3  # Includes inactive members of affected groups.
    assert await owners(session) == {
        f["source"]: f["first"],
        f["vacant"]: f["second"],
        f["untouched"]: f["previous"],
    }
    assert await memberships(session) == before_members
    assert before_members[f["trainee"]] is before_members[f["inactive_trainee"]] is None
    assert (
        await session.execute(
            select(
                CoinAccount.user_id,
                CoinAccount.balance,
                CoinAccount.reserved,
                CoinAccount.total_earned,
                CoinAccount.total_spent,
            ).order_by(CoinAccount.user_id)
        )
    ).all() == before_accounts
    assert (
        await session.execute(
            select(
                CoinTransaction.id,
                CoinTransaction.user_id,
                CoinTransaction.amount,
            ).order_by(CoinTransaction.id)
        )
    ).all() == before_transactions
    await session.refresh(attempt)
    assert (attempt.id, attempt.state, attempt.score, attempt.awarded_coins) == (
        attempt_id,
        "passed",
        100,
        137,
    )
    assert (await session.get(LearningAward, award_id)).attempt_id == attempt_id
    marker = await session.scalar(
        select(AuditLog).where(AuditLog.action == "supervisor_team.repair")
    )
    assert marker.entity_id == f["plan"]["repair_id"]
    assert marker.payload["repair_id"] == f["plan"]["repair_id"]
    changes = list(await session.scalars(select(AuditLog).where(AuditLog.action == "group.update")))
    assert {row.entity_id for row in changes} == {str(f["source"]), str(f["vacant"])}


async def test_replay_never_overwrites_a_later_legitimate_manual_assignment(
    session, repair_fixture
):
    f = repair_fixture
    first_result = await apply(session, f["plan"])
    assert first_result.status == "applied"
    source = await session.get(Group, f["source"])
    source.supervisor_id = f["second"]
    await session.commit()
    before_audits = await audit_count(session)

    replay = await apply(session, f["plan"])

    assert replay.status == "already_applied" and replay.updated_groups == 0
    assert (await owners(session))[f["source"]] == f["second"]
    assert await audit_count(session) == before_audits


@pytest.mark.parametrize(
    "failure",
    [
        "missing_group",
        "wrong_code",
        "stale_owner",
        "missing_owner",
        "not_supervisor",
        "inactive_owner",
        "inactive_group",
        "duplicate_group",
    ],
)
async def test_invalid_second_change_prevents_the_first_change_and_marker(
    session, repair_fixture, failure
):
    f = repair_fixture
    plan = deepcopy(f["plan"])
    change = plan["ownership_changes"][1]
    if failure == "missing_group":
        change["group_id"] = 999999
    elif failure == "wrong_code":
        change["expected_group_code"] = "NO-LONGER-THIS-CODE"
    elif failure == "stale_owner":
        change["expected_supervisor_id"] = f["previous"]
    elif failure == "missing_owner":
        change["supervisor_id"] = 999999
    elif failure == "not_supervisor":
        change["supervisor_id"] = f["trainee"]
    elif failure == "inactive_owner":
        target = await session.get(User, f["second"])
        target.is_active = False
    elif failure == "inactive_group":
        group = await session.get(Group, f["vacant"])
        group.is_active = False
    else:
        plan["ownership_changes"][1] = deepcopy(plan["ownership_changes"][0])
    await session.commit()
    before_owners, before_members = await owners(session), await memberships(session)
    before_audits = await audit_count(session)

    with pytest.raises(supervisor_team_repair.RepairPlanError):
        await apply(session, plan)

    assert await owners(session) == before_owners
    assert await memberships(session) == before_members
    assert await audit_count(session) == before_audits


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown_plan_field",
        "operator_membership",
        "empty_changes",
        "missing_expected_owner",
        "boolean_group",
        "string_owner",
        "negative_owner",
        "invalid_repair_id",
        "long_repair_id",
    ],
)
async def test_plan_cannot_request_membership_edits_or_coerce_ambiguous_identifiers(
    session, repair_fixture, mutation
):
    plan = deepcopy(repair_fixture["plan"])
    if mutation == "unknown_plan_field":
        plan["force"] = True
    elif mutation == "operator_membership":
        plan["ownership_changes"][0]["operator_ids"] = [repair_fixture["trainee"]]
    elif mutation == "empty_changes":
        plan["ownership_changes"] = []
    elif mutation == "missing_expected_owner":
        del plan["ownership_changes"][0]["expected_supervisor_id"]
    elif mutation == "boolean_group":
        plan["ownership_changes"][0]["group_id"] = True
    elif mutation == "string_owner":
        plan["ownership_changes"][0]["supervisor_id"] = str(repair_fixture["first"])
    elif mutation == "negative_owner":
        plan["ownership_changes"][0]["supervisor_id"] = -1
    elif mutation == "invalid_repair_id":
        plan["repair_id"] = "invalid repair id"
    else:
        plan["repair_id"] = "r" * 65
    before_owners, before_audits = await owners(session), await audit_count(session)

    with pytest.raises(supervisor_team_repair.RepairPlanError):
        await apply(session, plan)

    assert await owners(session) == before_owners
    assert await audit_count(session) == before_audits


async def test_missing_serialization_settings_aborts_without_writes(session, repair_fixture):
    settings = await session.get(GamificationSettings, 1)
    await session.delete(settings)
    await session.commit()
    before_owners = await owners(session)
    with pytest.raises(supervisor_team_repair.RepairPlanError):
        await apply(session, repair_fixture["plan"])
    assert await owners(session) == before_owners
    assert await audit_count(session) == 0


async def test_reconciliation_failure_rolls_back_ownership_and_audit(
    session, repair_fixture, monkeypatch
):
    async def fail_reconcile(*args, **kwargs):
        raise RuntimeError("Simulated estate failure")

    monkeypatch.setattr(city_estate, "reconcile_many", fail_reconcile)
    before_owners, before_audits = await owners(session), await audit_count(session)
    with pytest.raises(RuntimeError, match="Simulated estate failure"):
        await apply(session, repair_fixture["plan"])
    assert await owners(session) == before_owners
    assert await audit_count(session) == before_audits


async def test_owner_repair_reconciles_personal_estate_and_preserves_shared_and_trainee_assets(
    session, repair_fixture
):
    f = repair_fixture
    admin = await make_user(session, login="repair-world-editor", role=Role.ADMIN)
    cities = city_world.defaults()
    support = next(city for city in cities if city["id"] == "support")
    support["districts"][0]["supervisor_id"] = f["previous"]
    support["districts"][1]["supervisor_id"] = f["first"]
    old_district = support["districts"][0]["id"]
    world = CityWorld(id=1, revision=1, cities=cities, updated_by_id=admin.id)
    session.add(world)
    personal = CityObject(
        district_id=old_district,
        owner_id=f["active"],
        family="house",
        level=3,
        state="placed",
        module=3,
        u=0,
        v=0,
        rotation=0,
        source="purchase",
        paid=620,
    )
    shared = CityObject(
        district_id=old_district,
        owner_id=None,
        family="square",
        level=2,
        state="placed",
        module=0,
        u=11,
        v=11,
        rotation=0,
        source="legacy",
        paid=0,
    )
    trainee = CityObject(
        district_id=old_district,
        owner_id=f["trainee"],
        family="house",
        level=1,
        state="placed",
        module=3,
        u=1,
        v=0,
        rotation=0,
        source="purchase",
        paid=180,
    )
    session.add_all([personal, shared, trainee])
    await session.flush()
    for obj in (personal, shared, trainee):
        session.add(
            CityCell(
                district_id=old_district,
                module=obj.module,
                u=obj.u,
                v=obj.v,
                object_id=obj.id,
            )
        )
    await session.commit()
    personal_id, shared_id, trainee_id = personal.id, shared.id, trainee.id
    before_members = await memberships(session)
    world_snapshot = deepcopy(world.cities)

    await apply(session, f["plan"])

    await session.refresh(personal)
    await session.refresh(shared)
    await session.refresh(trainee)
    await session.refresh(world)
    assert (personal.id, personal.owner_id, personal.family, personal.level, personal.paid) == (
        personal_id,
        f["active"],
        "house",
        3,
        620,
    )
    assert (personal.state, personal.module, personal.u, personal.v) == ("stored", None, None, None)
    assert shared.id == shared_id and shared.state == "placed"
    assert trainee.id == trainee_id and trainee.state == "placed"
    assert set(await session.scalars(select(CityCell.object_id))) == {shared_id, trainee_id}
    assert world.cities == world_snapshot and world.revision == 1
    assert await memberships(session) == before_members
    transfers = list(await session.scalars(select(CityEvent).where(CityEvent.kind == "transfer")))
    assert len(transfers) == 1 and transfers[0].object_id == personal_id


async def test_invalid_startup_plan_keeps_api_available_and_never_logs_private_plan(
    monkeypatch, caplog
):
    from app import main
    from app.core.config import settings
    from app.services import progress

    async def noop(*args, **kwargs):
        pass

    private_value = "PRIVATE-STAFF-SENTINEL"
    monkeypatch.setattr(settings, "AUTO_CREATE_SCHEMA", False)
    monkeypatch.setattr(settings, "SEED_REFERENCE_DATA", False)
    monkeypatch.setattr(
        settings,
        "PULS_SUPERVISOR_TEAM_REPAIR_PLAN",
        json.dumps(
            {
                "repair_id": private_value,
                "ownership_changes": [{"staff": private_value}],
            }
        ),
    )
    monkeypatch.setattr(progress, "reconcile_existing_progress", noop)
    monkeypatch.setattr(main.telegram, "configure_webhook", noop)
    monkeypatch.setattr(main, "start_scheduler", lambda: None)
    monkeypatch.setattr(main, "stop_scheduler", lambda: None)

    with caplog.at_level("ERROR", logger=main.__name__):
        async with main.lifespan(main.app):
            assert (await main.health())["status"] == "ok"

    assert "Team ownership maintenance aborted (RepairPlanError)" in caplog.text
    assert private_value not in caplog.text
