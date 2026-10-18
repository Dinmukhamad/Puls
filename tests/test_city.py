import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.models.access import AccessRule
from app.models.city import CityAward, CitySettings, CityWorld
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import CoinAccount, User
from app.services.city import default_missions
from app.services.crm_catalog import default_categories
from tests.conftest import auth, login, make_group, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"


async def claim(client, headers, key, revision=0):
    return await client.post(
        f"{BASE}/missions/{key}/claim", headers=headers, json={"revision": revision}
    )


async def order(session, user_id, *, stage="complete", preview=False):
    shift_id = None
    if preview:
        shift_id = str(uuid4())
        session.add(
            DriverShift(
                id=shift_id,
                user_id=user_id,
                mode="free",
                config={},
                data={},
                events=[],
                is_preview=True,
            )
        )
        await session.flush()
    session.add(
        DriverOrder(
            id=str(uuid4()),
            user_id=user_id,
            shift_id=shift_id,
            stage=stage,
            origin="A",
            destination="B",
            payment="card",
            fare=1000,
            commission=10,
            park={},
            events=[],
            finished_at=utcnow() if stage == "complete" else None,
        )
    )
    await session.commit()


async def appeal(session, user_id, *, phone=False, ticket=False, status="recorded"):
    categories = (
        [n["id"] for n in default_categories() if "phone_change" in n["rules"]][:1] if phone else []
    )
    row = CrmAppeal(
        request_id=str(uuid4()),
        author_id=user_id,
        author_name="Operator",
        channel="Звонок",
        phone="+77001234567",
        license_number="123",
        contacted_at=utcnow(),
        park="Park",
        city="City",
        category_ids=categories,
        category_labels=[],
        details={},
        comment="Validated at creation",
        is_ticket=ticket,
        status=status,
    )
    session.add(row)
    await session.commit()
    return row


async def test_city_reads_never_award_and_server_rejects_forged_progress(client, operator, session):
    headers = auth(await login(client, operator.login))
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 0 and result["balance"] == 0
    assert result["missions"][0]["state"] == "ready"
    assert (await claim(client, headers, "driver_five")).status_code == 409
    assert (await claim(client, headers, "missing")).status_code == 404
    forged = await client.post(
        BASE + "/missions/welcome/claim",
        headers=headers,
        json={"revision": 0, "coins": 999, "user_id": operator.id},
    )
    assert forged.status_code == 422
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert (await client.get(BASE)).status_code == 401
    assert (await client.get(ADMIN + "/participants", headers=headers)).status_code == 403


async def test_seen_district_stages_belong_to_the_account_and_only_go_up(
    client, session, operator, head
):
    # Another browser of the same operator reads what the first one already celebrated.
    first = auth(await login(client, operator.login))
    second = auth(await login(client, operator.login))
    assert (await client.get(BASE, headers=first)).json()["levels_seen"] is None
    # A record without learning districts is still a record: the city does not ask again.
    empty = await client.post(BASE + "/levels/seen", headers=first, json={"levels": {}})
    assert empty.json() == {"levels_seen": {}}
    assert (await client.get(BASE, headers=first)).json()["levels_seen"] == {}
    seen = await client.post(
        BASE + "/levels/seen", headers=first, json={"levels": {"dispatch": 3, "crm": 1}}
    )
    assert seen.json() == {"levels_seen": {"dispatch": 3, "crm": 1}}
    assert (await client.get(BASE, headers=second)).json()["levels_seen"] == {
        "dispatch": 3,
        "crm": 1,
    }
    # An older tab cannot bring a celebration back; unknown districts are not kept.
    older = await client.post(
        BASE + "/levels/seen", headers=second, json={"levels": {"dispatch": 2, "nowhere": 4}}
    )
    assert older.json() == {"levels_seen": {"dispatch": 3, "crm": 1}}
    grown = await client.post(BASE + "/levels/seen", headers=second, json={"levels": {"crm": 2}})
    assert grown.json()["levels_seen"] == {"dispatch": 3, "crm": 2}
    for wrong in ({"dispatch": 6}, {"dispatch": 0}, {"x" * 41: 2}):
        bad = await client.post(BASE + "/levels/seen", headers=first, json={"levels": wrong})
        assert bad.status_code == 422
    # Staff previews and an inspected operator's city neither read nor write it.
    staff = auth(await login(client, head.login))
    assert (await client.get(BASE, headers=staff)).json()["levels_seen"] is None
    assert (await client.get(f"{ADMIN}/operators/{operator.id}", headers=staff)).json()[
        "levels_seen"
    ] is None
    denied = await client.post(BASE + "/levels/seen", headers=staff, json={"levels": {"crm": 5}})
    assert denied.status_code == 403
    await session.refresh(operator)
    assert operator.city_levels_seen == {"dispatch": 3, "crm": 2}


@pytest.mark.parametrize("home_city", [None, "sales", "support"])
async def test_scenarios_district_follows_assigned_operator_city(
    client, session, operator, supervisor, head, home_city
):
    from app.services.city_world import defaults

    cities = defaults()
    if home_city:
        next(city for city in cities if city["id"] == home_city)["districts"][0][
            "supervisor_id"
        ] = supervisor.id
    session.add(CityWorld(id=1, revision=1, cities=cities, updated_by_id=head.id))
    await session.commit()
    headers = auth(await login(client, operator.login))
    response = await client.get(BASE, headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    shown = home_city == "support"
    assert ("scenarios" in {d["id"] for d in data["districts"]}) is shown
    assert ("scenario_business_park" in {m["key"] for m in data["missions"]}) is shown
    # Having completed some CRM or dispatch work cannot bypass the combined scenario engine.
    await appeal(session, operator.id)
    result = await claim(client, headers, "scenario_business_park")
    assert result.status_code == (409 if shown else 403), result.text
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    # Operator inspection retains the inspected account's city boundary.
    staff_headers = auth(await login(client, head.login))
    detail = (await client.get(f"{ADMIN}/operators/{operator.id}", headers=staff_headers)).json()
    assert ("scenarios" in {d["id"] for d in detail["districts"]}) is shown
    preview = (await client.get(BASE, headers=staff_headers)).json()
    assert "scenarios" in {d["id"] for d in preview["districts"]}
    assert preview["preview"] and not preview["can_claim"]
    report = (await client.get(ADMIN + "/participants", headers=staff_headers)).json()
    item = next(row for row in report["items"] if row["user_id"] == operator.id)
    assert ("scenario_business_park" in {m["key"] for m in item["missions"]}) is shown
    assert item["total"] == len(default_missions()) - (0 if shown else 1)


async def test_new_scenario_default_merges_with_saved_curriculum(session, head):
    from app.services.city import settings

    saved = {key: value for key, value in default_missions().items()
             if key != "scenario_business_park"}
    saved["driver_first"]["coins"] = 321
    saved["crm_first"]["enabled"] = False
    session.add(CitySettings(id=1, revision=7, missions=saved, updated_by_id=head.id))
    await session.commit()
    current = await settings(session)
    assert current["revision"] == 7
    assert current["missions"]["driver_first"]["coins"] == 321
    assert current["missions"]["crm_first"]["enabled"] is False
    scenario = current["missions"]["scenario_business_park"]
    assert scenario["target"] == 1 and scenario["xp"] == 0 and scenario["coins"] == 100
    assert scenario["enabled"] and scenario["prerequisite"] is None


async def test_scenario_city_evidence_uses_only_own_passed_nonpreview_attempts(
    session, operator
):
    from app.models.scenario import ScenarioAttempt
    from app.services.city import evidence, mission_rows

    other = await make_user(session, login="scenario-other")
    for user_id, scenario_key, state, preview in [
        (operator.id, "business_park", "passed", True),
        (operator.id, "business_park", "failed", False),
        (operator.id, "business_park", "in_progress", False),
        (operator.id, "another_scenario", "passed", False),
        (other.id, "business_park", "passed", False),
    ]:
        session.add(ScenarioAttempt(
            user_id=user_id, scenario_key=scenario_key, state=state,
            is_preview=preview, revision=1, snapshot={},
        ))
    await session.commit()
    facts = await evidence(session, [operator.id, other.id])
    assert facts[operator.id]["scenario_business_park"] == 0
    assert facts[other.id]["scenario_business_park"] == 1
    session.add(ScenarioAttempt(
        user_id=operator.id, scenario_key="business_park", state="passed",
        is_preview=False, revision=1, snapshot={},
    ))
    await session.commit()
    facts = await evidence(session, [operator.id, other.id])
    assert facts[operator.id]["scenario_business_park"] == 1
    rows = mission_rows({"missions": default_missions()}, facts[operator.id], {})
    mission = next(row for row in rows if row["key"] == "scenario_business_park")
    assert mission["current"] == 1 and mission["state"] == "ready"
    # Reads reflect the result but never synthesize a reward or move money.
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_scenario_reward_can_be_configured_but_target_stays_single(
    client, head
):
    headers = auth(await login(client, head.login))
    config = {"revision": 0, "missions": default_missions()}
    config["missions"]["scenario_business_park"]["target"] = 2
    invalid = await client.put(ADMIN + "/settings", headers=headers, json=config)
    assert invalid.status_code == 422, invalid.text
    config["missions"]["scenario_business_park"]["target"] = 1
    config["missions"]["scenario_business_park"]["coins"] = 456
    result = await client.put(ADMIN + "/settings", headers=headers, json=config)
    assert result.status_code == 200, result.text
    assert result.json()["missions"]["scenario_business_park"]["coins"] == 456


@pytest.mark.parametrize("mode", ["xp", "prerequisite", "legacy_dependency"])
async def test_scenario_is_standalone_and_cannot_lock_sales_curriculum(
    client, head, mode
):
    config = {"revision": 0, "missions": default_missions()}
    if mode == "xp":
        config["missions"]["scenario_business_park"]["xp"] = 1
    elif mode == "prerequisite":
        config["missions"]["scenario_business_park"]["prerequisite"] = "welcome"
    else:
        config["missions"]["crm_first"]["prerequisite"] = "scenario_business_park"
    headers = auth(await login(client, head.login))
    result = await client.put(ADMIN + "/settings", headers=headers, json=config)
    assert result.status_code == 422, result.text


async def test_real_driver_chain_ignores_foreign_cancelled_and_preview_orders(
    client, operator, session
):
    headers = auth(await login(client, operator.login))
    other = await make_user(session, login="other")
    await order(session, other.id)
    await order(session, operator.id, stage="cancelled")
    await order(session, operator.id, preview=True)
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "driver_profile")).status_code == 409
    session.add(DriverProfile(user_id=operator.id, stage="offline"))
    await session.commit()
    assert (await claim(client, headers, "driver_profile")).status_code == 200
    assert (await claim(client, headers, "driver_first")).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, headers, "driver_first")).status_code == 200
    for _ in range(3):
        await order(session, operator.id)
    assert (await claim(client, headers, "driver_five")).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, headers, "driver_five")).status_code == 200
    assert (await claim(client, headers, "driver_five")).json()["already_claimed"] is True
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 470 and result["balance"] == 180 and result["level"] == 2
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 3


async def test_crm_chain_requires_verified_training_not_raw_or_staff_closed_tickets(
    client, operator, session
):
    from tests.conftest import login_with_work_sites
    from tests.test_crm_training import IMAGE, appeal_payload, save, start

    headers = auth(await login_with_work_sites(client, operator.login))
    other = await make_user(session, login="other")
    await appeal(session, other.id, phone=True, ticket=True, status="closed")
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "crm_first")).status_code == 409
    await appeal(session, operator.id)
    assert (await claim(client, headers, "crm_first")).status_code == 409
    ticket = await appeal(session, operator.id, phone=True, ticket=True, status="new")
    staff = await make_user(session, login="trainer", role=Role.TRAINER)
    staff_headers = auth(await login(client, staff.login))
    response = await client.patch(
        f"/api/v1/admin/learning/crm/appeals/{ticket.id}/status",
        headers=staff_headers,
        json={"status": "closed"},
    )
    assert response.status_code == 200, response.text
    # Business processing of an arbitrary ticket is separate from task proof.
    assert (await claim(client, headers, "crm_first")).status_code == 409
    for key in ("crm_first", "crm_phone", "crm_closed"):
        item = await start(client, headers, key)
        saved = await save(
            client, headers, appeal_payload(item), files=IMAGE if key == "crm_phone" else None
        )
        assert saved.status_code == 201, saved.text
        assert saved.json()["status"] == ("recorded" if key == "crm_first" else "new")
        assert (await claim(client, headers, key)).status_code == 200
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 505 and result["balance"] == 210


async def test_concurrent_claims_and_session_changes_do_not_duplicate_rewards(
    client, operator, session
):
    headers = auth(await login(client, operator.login))
    await claim(client, headers, "welcome")
    await order(session, operator.id)
    responses = await asyncio.gather(*[claim(client, headers, "driver_profile") for _ in range(2)])
    assert [r.status_code for r in responses] == [200, 200]
    assert sorted(r.json()["already_claimed"] for r in responses) == [False, True]
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 1
    assert (await session.get(CoinAccount, operator.id)).balance == 20
    second_session = auth(await login(client, operator.login))
    assert (await claim(client, second_session, "driver_profile")).json()["already_claimed"] is True


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_preview_reporting_and_editing_roles(client, session, operator, role):
    staff = await make_user(session, login="staff", role=role)
    headers = auth(await login(client, staff.login))
    data = (await client.get(BASE, headers=headers)).json()
    assert data["preview"] and not data["can_claim"] and data["xp"] == 0
    assert (await claim(client, headers, "welcome")).status_code == 403
    assert (await client.get(ADMIN + "/participants", headers=headers)).json()["total"] == 1
    detail = (await client.get(f"{ADMIN}/operators/{operator.id}", headers=headers)).json()
    assert detail["inspecting"] and not detail["can_claim"]
    config = {"revision": 0, "missions": default_missions()}
    result = await client.put(ADMIN + "/settings", headers=headers, json=config)
    assert result.status_code == (403 if role == Role.SUPERVISOR else 200), result.text


async def test_settings_revision_cycles_disabled_missions_and_award_snapshot(
    client, session, operator, head
):
    h = auth(await login(client, head.login))
    op = auth(await login(client, operator.login))
    await claim(client, op, "welcome")
    config = {"revision": 0, "missions": default_missions()}
    config["missions"]["driver_profile"]["prerequisite"] = "driver_first"
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 422
    config["missions"] = default_missions()
    config["missions"]["welcome"]["xp"] = 500
    config["missions"]["driver_profile"]["enabled"] = False
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 200
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, op, "driver_first", 0)).status_code == 409
    assert (await claim(client, op, "driver_profile", 1)).status_code == 409
    assert (await claim(client, op, "driver_first", 1)).status_code == 200
    assert (await client.get(BASE, headers=op)).json()["xp"] == 145
    saved = await session.get(CityAward, (operator.id, "welcome"))
    assert saved.snapshot["xp"] == 25


async def test_city_respects_section_restrictions_and_does_not_open_crm(client, session, operator):
    headers = auth(await login(client, operator.login))
    assert (await claim(client, headers, "welcome")).status_code == 200
    blocked = await client.get("/api/v1/learning/crm/catalog", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["code"] == "work_sites_qr_required"
    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="training", effect="deny"
        )
    )
    await session.commit()
    assert (await client.get(BASE, headers=headers)).status_code == 403
    assert (await claim(client, headers, "driver_first")).status_code == 403


async def test_active_order_is_in_progress_but_cannot_earn_a_completion_reward(
    client, session, operator
):
    headers = auth(await login(client, operator.login))
    await claim(client, headers, "welcome")
    await order(session, operator.id, stage="pickup")
    assert (await claim(client, headers, "driver_profile")).status_code == 200
    data = (await client.get(BASE, headers=headers)).json()
    first = next(m for m in data["missions"] if m["key"] == "driver_first")
    assert first["state"] == "in_progress" and first["current"] == 0
    assert (await claim(client, headers, "driver_first")).status_code == 409


async def fund(session, user_id, amount):
    from app.models.enums import TxType
    from app.services.coins import post_transaction

    await post_transaction(
        session, user_id=user_id, amount=amount, tx_type=TxType.MANUAL_CREDIT, reason="Тест"
    )
    await session.commit()


async def test_operator_builds_on_open_plots_with_coins_once(client, operator, session):
    headers = auth(await login(client, operator.login))
    build = lambda plot, item: client.post(  # noqa: E731
        f"{BASE}/plots/{plot}/build", headers=headers, json={"item": item}
    )
    city = (await client.get(BASE, headers=headers)).json()
    assert len(city["plots"]) == 16 and not any(p["unlocked"] for p in city["plots"])
    assert {b["key"] for b in city["buildings"]} >= {"garden", "tower"} and city["can_build"]
    # Locked until the district's first mission is claimed.
    assert (await build("academy-0", "garden")).status_code == 409
    assert (await claim(client, headers, "welcome")).status_code == 200
    city = (await client.get(BASE, headers=headers)).json()
    assert {p["key"] for p in city["plots"] if p["unlocked"]} == {f"academy-{i}" for i in range(4)}
    # No coins yet: nothing is written.
    poor = await build("academy-0", "garden")
    assert poor.status_code == 409 and poor.json()["code"] == "insufficient_coins"
    await fund(session, operator.id, 100)
    assert (await build("academy-0", "nothing")).status_code == 404
    assert (await build("nowhere", "garden")).status_code == 404
    forged = await client.post(
        f"{BASE}/plots/academy-0/build", headers=headers, json={"item": "garden", "price": 1}
    )
    assert forged.status_code == 422
    done = await build("academy-0", "garden")
    assert done.status_code == 200 and done.json()["balance"] == 60
    assert (await build("academy-0", "fountain")).status_code == 409
    assert (await build("academy-1", "fountain")).status_code == 409  # 90 > 60
    city = (await client.get(BASE, headers=headers)).json()
    assert city["balance"] == 60
    assert next(p for p in city["plots"] if p["key"] == "academy-0")["item"] == "garden"
    spent = await session.scalar(
        select(func.sum(CoinTransaction.amount)).where(
            CoinTransaction.user_id == operator.id, CoinTransaction.tx_type == "city_build"
        )
    )
    assert spent == -40


async def test_concurrent_builds_pay_once(client, operator, session):
    headers = auth(await login(client, operator.login))
    assert (await claim(client, headers, "welcome")).status_code == 200
    await fund(session, operator.id, 500)
    results = await asyncio.gather(
        *[
            client.post(f"{BASE}/plots/academy-2/build", headers=headers, json={"item": "house"})
            for _ in range(3)
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    account = await session.scalar(
        select(CoinAccount)
        .where(CoinAccount.user_id == operator.id)
        .execution_options(populate_existing=True)
    )
    assert account.balance == 300


async def test_staff_cannot_build_and_see_operator_plots_read_only(client, session, operator):
    staff = await make_user(session, login="trainer-build", role=Role.TRAINER)
    headers = auth(await login(client, staff.login))
    own = (await client.get(BASE, headers=headers)).json()
    assert not own["can_build"]
    denied = await client.post(
        f"{BASE}/plots/academy-0/build", headers=headers, json={"item": "garden"}
    )
    assert denied.status_code == 403
    view = (await client.get(f"{ADMIN}/operators/{operator.id}", headers=headers)).json()
    assert len(view["plots"]) == 16 and not view["can_build"]


async def test_the_group_city_is_gone(client, session, operator):
    """Its quarters gave their land to the districts: an operator in a group gets no quarters, and
    the staff's breakdown is no more."""
    group = await make_group(session, code="GC")
    operator.group_id = group.id
    await session.commit()
    headers = auth(await login(client, operator.login))
    assert "group" not in (await client.get(BASE, headers=headers)).json()
    head = await make_user(session, login="head-group", role=Role.HEAD)
    staff = auth(await login(client, head.login))
    assert (await client.get(ADMIN + "/groups", headers=staff)).status_code == 404
    assert not {"points", "projects"} & set(
        (await client.get(ADMIN + "/economy", headers=staff)).json()
    )


async def quest_rows(session, user_id):
    from app.models.city import CityQuest

    return list(
        await session.scalars(
            select(CityQuest)
            .where(CityQuest.user_id == user_id)
            .order_by(CityQuest.slot)
            .execution_options(populate_existing=True)
        )
    )


async def test_daily_quests_are_dealt_once_and_hide_answers(client, session, operator):
    headers = auth(await login(client, operator.login))
    first = (await client.get(BASE, headers=headers)).json()["quests"]
    assert len(first["items"]) == 3 and first["coins"] == 3
    assert all(q["right"] is None and q["explanation"] is None for q in first["items"])
    assert [q["giver"] for q in first["items"]] == ["driver", "client", "guide"]
    again = (await client.get(BASE, headers=headers)).json()["quests"]
    assert again == first
    rows = await quest_rows(session, operator.id)
    assert len(rows) == 3 and all(r.snapshot["source"] == "bank" for r in rows)
    # A right answer pays once; the answer, the right option and why are shown after.
    right = rows[0].snapshot["correct"]
    done = await client.post(f"{BASE}/quests/0/answer", headers=headers, json={"answer": right})
    assert done.status_code == 200
    assert done.json()["correct"] and done.json()["coins"] == 3 and done.json()["explanation"]
    assert (
        await client.post(f"{BASE}/quests/0/answer", headers=headers, json={"answer": right})
    ).status_code == 409
    wrong = (rows[1].snapshot["correct"] + 1) % len(rows[1].snapshot["options"])
    miss = (
        await client.post(f"{BASE}/quests/1/answer", headers=headers, json={"answer": wrong})
    ).json()
    assert (
        miss["correct"] is False
        and miss["coins"] == 0
        and miss["right"] == rows[1].snapshot["correct"]
    )
    assert (
        await client.post(f"{BASE}/quests/7/answer", headers=headers, json={"answer": 0})
    ).status_code == 404
    assert (
        await client.post(f"{BASE}/quests/2/answer", headers=headers, json={"answer": 9})
    ).status_code == 422
    city = (await client.get(BASE, headers=headers)).json()
    assert city["balance"] == 3
    assert city["quests"]["items"][0]["answered"] and city["quests"]["items"][2]["right"] is None


async def test_quests_come_from_the_bank(client, session, operator):
    from app.models.learning import LearningAttempt, LearningAward, LearningContent

    group = await make_group(session, code="GQ")
    operator.group_id = group.id
    # A material passed before materials left the operator's menu does not feed the day's
    # situations.
    content = LearningContent(
        kind="test",
        title="Смена номера",
        status="published",
        steps=[
            {
                "speaker": "Водитель",
                "text": f"Вопрос {i}",
                "options": ["А", "Б", "В"],
                "correct": 2,
                "explanation": "Так",
            }
            for i in range(4)
        ],
    )
    session.add(content)
    await session.flush()
    attempt = LearningAttempt(
        user_id=operator.id, content_id=content.id, snapshot={}, state="passed"
    )
    session.add(attempt)
    await session.flush()
    session.add(LearningAward(user_id=operator.id, content_id=content.id, attempt_id=attempt.id))
    await session.commit()
    headers = auth(await login(client, operator.login))
    items = (await client.get(BASE, headers=headers)).json()["quests"]["items"]
    assert len(items) == 3 and not any(q["title"] == "Смена номера" for q in items)
    rows = await quest_rows(session, operator.id)
    assert all(r.snapshot["source"] == "bank" for r in rows)
    for row in rows:
        answered = await client.post(
            f"{BASE}/quests/{row.slot}/answer",
            headers=headers,
            json={"answer": row.snapshot["correct"]},
        )
        assert answered.json()["coins"] == 3


async def test_concurrent_answers_pay_once_and_staff_never_deal(client, session, operator):
    headers = auth(await login(client, operator.login))
    await client.get(BASE, headers=headers)
    row = (await quest_rows(session, operator.id))[0]
    results = await asyncio.gather(
        *[
            client.post(
                f"{BASE}/quests/0/answer", headers=headers, json={"answer": row.snapshot["correct"]}
            )
            for _ in range(3)
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    rewards = await session.scalar(
        select(func.count())
        .select_from(CoinTransaction)
        .where(CoinTransaction.user_id == operator.id)
    )
    assert rewards == 1
    trainer = await make_user(session, login="trainer-quest", role=Role.TRAINER)
    staff = auth(await login(client, trainer.login))
    assert (await client.get(BASE, headers=staff)).json()["quests"] is None
    assert (
        await client.post(f"{BASE}/quests/0/answer", headers=staff, json={"answer": 0})
    ).status_code == 403
    # Looking at an operator's city does not deal their day.
    other = await make_user(session, login="op-unseen")
    view = (await client.get(f"{ADMIN}/operators/{other.id}", headers=staff)).json()
    assert view["quests"]["items"] == [] and await quest_rows(session, other.id) == []


async def test_deal_places_speakers_by_their_spot_and_shuffles_options():
    from datetime import date

    from app.services.city_quests import bank_questions, deal

    for uid in range(1, 40):
        picks = deal(uid, date(2026, 9, 29), bank_questions())
        assert len(picks) == 3 and len({q["ref"] for q in picks}) == 3
        speakers = [q["speaker"] for q in picks]
        if "Водитель" in speakers:
            assert speakers[0] == "Водитель"
        if "Клиент" in speakers:
            assert speakers[1] == "Клиент" or (
                speakers[0] == "Клиент" and "Водитель" not in speakers
            )
        assert deal(uid, date(2026, 9, 29), bank_questions()) == picks
    # The right answer is not always in the same place.
    places = {
        q["correct"]
        for uid in range(1, 40)
        for q in deal(uid, date(2026, 9, 29), bank_questions())
    }
    assert len(places) == 3


async def test_deal_leaves_empty_slots_when_the_bank_runs_short():
    from datetime import date

    from app.services.city_quests import bank_questions, deal

    day = date(2026, 10, 1)
    caller = next(q for q in bank_questions() if q["speaker"] == "Клиент")
    other = {**caller, "ref": "own-other", "speaker": "Диспетчер"}
    # A caller keeps the CRM centre's spot; another speaker takes the first free one.
    assert [q and q["ref"] for q in deal(1, day, [caller])] == [None, caller["ref"], None]
    assert [q and q["ref"] for q in deal(1, day, [other, caller])] == [
        "own-other",
        caller["ref"],
        None,
    ]
    assert deal(1, day, []) == [None, None, None]


async def test_answered_situations_never_come_back(client, session, operator, monkeypatch):
    from datetime import date

    from app.services import city_quests

    clock = {"day": date(2026, 10, 1)}
    monkeypatch.setattr(city_quests, "today", lambda: clock["day"])
    trainer = await make_user(session, login="trainer-repeat", role=Role.TRAINER)
    coach, me = auth(await login(client, trainer.login)), auth(await login(client, operator.login))
    current = (await client.get(ADMIN + "/situations", headers=coach)).json()
    own = [
        {
            "id": f"own-{i}",
            "speaker": "Водитель" if i % 2 else "Клиент",
            "text": f"Своя ситуация номер {i}",
            "options": ["Верно", "Неверно"],
            "correct": 0,
            "explanation": "",
            "enabled": True,
        }
        for i in range(4)
    ]
    items = [{**item, "enabled": False} for item in current["items"]] + own
    saved = await client.put(
        ADMIN + "/situations", headers=coach, json={"revision": 0, "items": items}
    )
    assert saved.status_code == 200

    async def deal_today():
        quests = (await client.get(BASE, headers=me)).json()["quests"]
        rows = [r for r in await quest_rows(session, operator.id) if r.day == clock["day"]]
        assert len(quests["items"]) == len(rows)
        return {row.slot: row.snapshot for row in rows}

    async def reply(slot, snapshot, right=True):
        choice = snapshot["correct"] if right else 1 - snapshot["correct"]
        response = await client.post(
            f"{BASE}/quests/{slot}/answer", headers=me, json={"answer": choice}
        )
        assert response.status_code == 200

    # Day one: three of four; one answered right, one wrong, one left open.
    first = await deal_today()
    assert len(first) == 3
    slots = sorted(first)
    await reply(slots[0], first[slots[0]])
    await reply(slots[1], first[slots[1]], right=False)
    answered = {first[slots[0]]["ref"], first[slots[1]]["ref"]}
    # Day two: answered ones never return, a right or a wrong answer alike; two are left.
    clock["day"] = date(2026, 10, 2)
    second = await deal_today()
    assert len(second) == 2
    assert {q["ref"] for q in second.values()} == {f"own-{i}" for i in range(4)} - answered
    for slot, snapshot in second.items():
        await reply(slot, snapshot)
    # Day three: every enabled situation is answered, so there is nothing to deal.
    clock["day"] = date(2026, 10, 3)
    assert await deal_today() == {}
    stats = (await client.get(ADMIN + "/situations", headers=coach)).json()
    assert stats["answered"] == {f"own-{i}": 1 for i in range(4)}
    assert stats["exhausted"] == 1
    # A new situation reaches the operator on the same day.
    added = {**own[0], "id": "own-new", "text": "Совсем новая ситуация"}
    body = {"revision": 1, "items": [*items, added]}
    assert (await client.put(ADMIN + "/situations", headers=coach, json=body)).status_code == 200
    third = await deal_today()
    assert [q["ref"] for q in third.values()] == ["own-new"]
    stats = (await client.get(ADMIN + "/situations", headers=coach)).json()
    assert stats["exhausted"] == 0


async def economy_body(client, headers, **changes):
    current = (await client.get(ADMIN + "/economy", headers=headers)).json()
    current.pop("catalogue"), current.pop("can_edit")
    return {**current, **changes}


async def test_head_sets_the_game_numbers_and_they_apply(client, session, operator):
    head = await make_user(session, login="head-economy", role=Role.HEAD)
    trainer = await make_user(session, login="trainer-economy", role=Role.TRAINER)
    boss, coach = auth(await login(client, head.login)), auth(await login(client, trainer.login))
    me = auth(await login(client, operator.login))
    current = (await client.get(ADMIN + "/economy", headers=coach)).json()
    assert not current.pop("can_edit") and len(current.pop("catalogue")) == 8
    assert current["revision"] == 0 and current["prices"]["garden"] == 40
    assert current["quest_coins"] == 3
    assert (await client.get(ADMIN + "/economy", headers=me)).status_code == 403
    body = {**current, "prices": {**current["prices"], "garden": 25}, "quest_coins": 15}
    assert (await client.put(ADMIN + "/economy", headers=coach, json=body)).status_code == 403
    saved = await client.put(ADMIN + "/economy", headers=boss, json=body)
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    # A stale revision is a conflict; a broken set of values is rejected.
    assert (await client.put(ADMIN + "/economy", headers=boss, json=body)).status_code == 409
    fresh = await economy_body(client, boss)
    for broken in (
        {"prices": {**fresh["prices"], "garden": 0}},
        {"prices": {k: v for k, v in fresh["prices"].items() if k != "tower"}},
        # The group city's points and quarters are gone with it.
        {"points": {"appeals": 10}},
        {"quest_coins": 5000},
    ):
        assert (
            await client.put(ADMIN + "/economy", headers=boss, json={**fresh, **broken})
        ).status_code == 422
    # The operator's city follows: new price, new reward.
    city = (await client.get(BASE, headers=me)).json()
    assert next(b for b in city["buildings"] if b["key"] == "garden")["price"] == 25
    assert city["quests"]["coins"] == 15
    assert (await claim(client, me, "welcome")).status_code == 200
    await fund(session, operator.id, 30)
    done = await client.post(f"{BASE}/plots/academy-0/build", headers=me, json={"item": "garden"})
    assert done.status_code == 200 and done.json()["price"] == 25 and done.json()["balance"] == 5
    row = (await quest_rows(session, operator.id))[0]
    answer = await client.post(
        f"{BASE}/quests/0/answer", headers=me, json={"answer": row.snapshot["correct"]}
    )
    assert answer.json()["coins"] == 15


async def test_trainers_edit_the_situations_and_new_days_use_them(client, session, operator):
    trainer = await make_user(session, login="trainer-situations", role=Role.TRAINER)
    sv = await make_user(session, login="sv-situations", role=Role.SUPERVISOR)
    coach, viewer = auth(await login(client, trainer.login)), auth(await login(client, sv.login))
    me = auth(await login(client, operator.login))
    current = (await client.get(ADMIN + "/situations", headers=viewer)).json()
    assert current["revision"] == 0 and len(current["items"]) == 9 and not current["can_edit"]
    assert (await client.get(ADMIN + "/situations", headers=coach)).json()["can_edit"]
    assert (await client.get(ADMIN + "/situations", headers=me)).status_code == 403
    mine = [
        {
            "id": f"own-{i}",
            "speaker": "Водитель",
            "text": f"Своя ситуация номер {i}",
            "options": ["Верно", "Неверно"],
            "correct": 0,
            "explanation": "Пояснение тренера",
            "enabled": True,
        }
        for i in range(3)
    ]
    items = [{**item, "enabled": False} for item in current["items"]] + mine
    body = {"revision": 0, "items": items}
    assert (await client.put(ADMIN + "/situations", headers=viewer, json=body)).status_code == 403
    saved = await client.put(ADMIN + "/situations", headers=coach, json=body)
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert (await client.put(ADMIN + "/situations", headers=coach, json=body)).status_code == 409
    fresh = {"revision": 1, "items": items}
    for broken in (
        [{**mine[0], "correct": 3}],
        [{**mine[0], "options": ["Да", "Да"]}],
        [{**mine[0], "id": "Bad Id"}],
        [{**item, "enabled": False} for item in items],
        [*items, mine[0]],
    ):
        response = await client.put(
            ADMIN + "/situations", headers=coach, json={**fresh, "items": broken}
        )
        assert response.status_code == 422
    # Today's deal (the first read) uses the enabled situations only.
    rows = (await client.get(BASE, headers=me)).json()["quests"]["items"]
    assert sorted(q["text"] for q in rows) == [f"Своя ситуация номер {i}" for i in range(3)]


async def test_site_tour_is_ready_once_the_tour_is_finished_and_pays_once(
    client, session, operator, supervisor
):
    headers = auth(await login(client, operator.login))
    finish = lambda h: client.post(f"{BASE}/tour/finish", headers=h)  # noqa: E731

    async def tour():
        data = (await client.get(BASE, headers=headers)).json()
        return next(m for m in data["missions"] if m["key"] == "site_tour"), data

    row, data = await tour()
    # The Academy's second mission, right after the welcome, and started from the city itself.
    assert [m["key"] for m in data["missions"]][:2] == ["welcome", "site_tour"]
    assert row["district"] == "academy" and row["state"] == "locked"
    assert row["path"] == "/training/city?district=academy&mission=site_tour"
    assert (row["title"], row["target"], row["xp"], row["coins"]) == (
        "Как устроен Puls",
        1,
        40,
        50,
    )
    assert (await claim(client, headers, "welcome")).status_code == 200
    row, _ = await tour()
    assert row["state"] == "available" and row["current"] == 0
    assert (await claim(client, headers, "site_tour")).status_code == 409
    # The first finish counts; going round again keeps it.
    assert (await finish(headers)).json() == {"site_tour": True}
    first = (await session.get(User, operator.id, populate_existing=True)).site_tour_at
    assert first is not None
    assert (await finish(headers)).status_code == 200
    assert (await session.get(User, operator.id, populate_existing=True)).site_tour_at == first
    row, _ = await tour()
    assert row["state"] == "ready" and row["current"] == 1
    claimed = await claim(client, headers, "site_tour")
    assert claimed.status_code == 200 and claimed.json()["coins"] == 50
    assert (await claim(client, headers, "site_tour")).json()["already_claimed"] is True
    account = await session.get(CoinAccount, operator.id, populate_existing=True)
    assert account.balance == 50
    row, _ = await tour()
    assert row["state"] == "completed"
    # Staff look round the site without the operator's mission.
    staff = auth(await login(client, supervisor.login))
    assert (await finish(staff)).status_code == 403


async def test_voice_district_counts_whole_calls_and_pays_each_mission_once(
    client, session, operator
):
    from app.models.voice_training import VoiceTrainingAttempt

    headers = auth(await login(client, operator.login))

    async def call(state="completed", score=100, language="ru", retry_of=None, user_id=None):
        row = VoiceTrainingAttempt(
            user_id=user_id or operator.id, scenario_key="phone_change", revision=3,
            persona="calm", state=state, snapshot={"language": language},
            result={"score": score} if state == "completed" else None, retry_of=retry_of,
        )
        session.add(row)
        await session.commit()
        return row

    async def voice():
        data = (await client.get(BASE, headers=headers)).json()
        return {m["key"]: m for m in data["missions"] if m["district"] == "voice"}, data

    rows, data = await voice()
    district = next(d for d in data["districts"] if d["id"] == "voice")
    assert (district["name"], district["subtitle"], district["soon"]) == (
        "Разговор", "Голосовой тренажёр", False,
    )
    assert list(rows) == ["voice_first", "voice_good", "voice_kazakh"]
    assert {m["path"] for m in rows.values()} == {"/training/voice"}
    assert [rows[k]["state"] for k in rows] == ["locked", "locked", "locked"]
    assert (await claim(client, headers, "welcome")).status_code == 200
    # A call in progress starts the first mission but does not finish it.
    await call(state="in_progress")
    rows, _ = await voice()
    assert rows["voice_first"]["state"] == "in_progress"
    assert (await claim(client, headers, "voice_first")).status_code == 409
    # A weak whole call finishes the first mission; another account's calls and repeated
    # moments do not count.
    first = await call(score=50)
    await call(score=100, language="kk", retry_of=first.id)
    other = await make_user(session, login="voice-other")
    await call(score=100, language="kk", user_id=other.id)
    rows, _ = await voice()
    assert rows["voice_first"]["state"] == "ready" and rows["voice_first"]["current"] == 1
    claimed = await claim(client, headers, "voice_first")
    assert claimed.status_code == 200 and claimed.json()["coins"] == 40
    assert (await claim(client, headers, "voice_first")).json()["already_claimed"] is True
    rows, _ = await voice()
    assert rows["voice_good"]["state"] == "available"
    assert rows["voice_kazakh"]["state"] == "locked"
    # 80 % is a good call; a Kazakh call counts once the good one is rewarded.
    await call(score=80, language="kk")
    rows, _ = await voice()
    assert rows["voice_good"]["state"] == "ready"
    assert (await claim(client, headers, "voice_kazakh")).status_code == 409
    assert (await claim(client, headers, "voice_good")).json()["coins"] == 80
    rows, _ = await voice()
    assert rows["voice_kazakh"]["state"] == "ready"
    assert (await claim(client, headers, "voice_kazakh")).json()["coins"] == 100
    account = await session.get(CoinAccount, operator.id, populate_existing=True)
    assert account.balance == 220
    rows, _ = await voice()
    assert {m["state"] for m in rows.values()} == {"completed"}
