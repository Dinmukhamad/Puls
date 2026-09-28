import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.models.access import AccessRule
from app.models.city import CityAward
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import CoinAccount
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


async def test_crm_chain_requires_own_category_and_staff_closed_ticket(client, operator, session):
    headers = auth(await login(client, operator.login))
    other = await make_user(session, login="other")
    await appeal(session, other.id, phone=True, ticket=True, status="closed")
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "crm_first")).status_code == 409
    await appeal(session, operator.id)
    assert (await claim(client, headers, "crm_first")).status_code == 200
    assert (await claim(client, headers, "crm_phone")).status_code == 409
    ticket = await appeal(session, operator.id, phone=True, ticket=True, status="new")
    assert (await claim(client, headers, "crm_phone")).status_code == 200
    assert (await claim(client, headers, "crm_closed")).status_code == 409
    staff = await make_user(session, login="trainer", role=Role.TRAINER)
    staff_headers = auth(await login(client, staff.login))
    response = await client.patch(
        f"/api/v1/admin/learning/crm/appeals/{ticket.id}/status",
        headers=staff_headers,
        json={"status": "closed"},
    )
    assert response.status_code == 200, response.text
    assert (await claim(client, headers, "crm_closed")).status_code == 200
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
    assert len(city["plots"]) == 12 and not any(p["unlocked"] for p in city["plots"])
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
    assert len(view["plots"]) == 12 and not view["can_build"]


async def test_group_city_shows_stages_and_only_own_points(client, session, operator):
    from app.services.city_group import PROJECTS

    sv = await make_user(session, login="sv-group", role=Role.SUPERVISOR)
    other_sv = await make_user(session, login="sv-other", role=Role.SUPERVISOR)
    group = await make_group(session, code="GC", supervisor_id=sv.id)
    await make_group(session, code="GX", supervisor_id=other_sv.id)
    mates = [await make_user(session, login=f"mate{i}", group_id=group.id) for i in range(2)]
    operator.group_id = group.id
    await session.commit()
    for mate in mates:
        for _ in range(10):
            await appeal(session, mate.id)  # 30 points each
    headers = auth(await login(client, operator.login))
    city = (await client.get(BASE, headers=headers)).json()
    group_city = city["group"]
    assert group_city["name"] == "Группа GC" and not group_city["small"]
    # 60 points of 150: the first quarter is at its frame, the rest planned; no numbers leak.
    assert [p["stage"] for p in group_city["projects"]] == ["frame"] + ["planned"] * 5
    assert all(set(p) == {"key", "name", "stage"} for p in group_city["projects"])
    assert group_city["mine"]["points"] == 0
    assert "mate0" not in str(group_city) and "Оператор" not in str(group_city["projects"])
    # The operator's own work counts for the group and shows as their own points.
    assert (await claim(client, headers, "welcome")).status_code == 200
    for _ in range(30):
        await appeal(session, operator.id)
    group_city = (await client.get(BASE, headers=headers)).json()["group"]
    assert group_city["mine"]["points"] == 20 + 90
    assert [p["stage"] for p in group_city["projects"]][:2] == ["done", "foundation"]
    assert len(PROJECTS) == 6
    # Operators cannot read the breakdown; supervisors see only their own groups.
    assert (await client.get(ADMIN + "/groups", headers=headers)).status_code == 403
    staff = auth(await login(client, sv.login))
    overview = (await client.get(ADMIN + "/groups", headers=staff)).json()
    assert [g["name"] for g in overview["items"]] == ["Группа GC"]
    members = {m["user_id"]: m["points"] for m in overview["items"][0]["members"]}
    assert members == {operator.id: 110, mates[0].id: 30, mates[1].id: 30}
    assert overview["items"][0]["projects"][1] == {
        "key": "site-1",
        "name": PROJECTS[1]["name"],
        "stage": "foundation",
        "points": 20,
        "cost": 300,
    }
    head = await make_user(session, login="head-group", role=Role.HEAD)
    everyone = (
        await client.get(ADMIN + "/groups", headers=auth(await login(client, head.login)))
    ).json()
    assert {g["name"] for g in everyone["items"]} == {"Группа GC", "Группа GX"}


async def test_small_group_hides_the_quarter_being_built(client, session, operator):
    group = await make_group(session, code="G2")
    mate = await make_user(session, login="solo-mate", group_id=group.id)
    operator.group_id = group.id
    await session.commit()
    for _ in range(40):
        await appeal(session, mate.id)  # 120 of 150 points
    city = (await client.get(BASE, headers=auth(await login(client, operator.login)))).json()
    assert city["group"]["small"]
    assert [p["stage"] for p in city["group"]["projects"]][:2] == ["foundation", "planned"]


async def test_no_group_or_staff_preview_has_no_group_city(client, session, operator):
    assert (await client.get(BASE, headers=auth(await login(client, operator.login)))).json()[
        "group"
    ] is None
    trainer = await make_user(session, login="trainer-group", role=Role.TRAINER)
    assert (await client.get(BASE, headers=auth(await login(client, trainer.login)))).json()[
        "group"
    ] is None


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
    assert len(first["items"]) == 3 and first["coins"] == 10
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
    assert done.json()["correct"] and done.json()["coins"] == 10 and done.json()["explanation"]
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
    assert city["balance"] == 10
    assert city["quests"]["items"][0]["answered"] and city["quests"]["items"][2]["right"] is None


async def test_quests_review_passed_materials_and_count_for_the_group(client, session, operator):
    from app.models.learning import LearningAttempt, LearningAward, LearningContent

    group = await make_group(session, code="GQ")
    operator.group_id = group.id
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
    assert all(q["title"] == "Смена номера" for q in items)
    rows = await quest_rows(session, operator.id)
    assert all(r.snapshot["options"][r.snapshot["correct"]] == "В" for r in rows)
    for row in rows:
        await client.post(
            f"{BASE}/quests/{row.slot}/answer",
            headers=headers,
            json={"answer": row.snapshot["correct"]},
        )
    mine = (await client.get(BASE, headers=headers)).json()["group"]["mine"]
    assert mine["quests"] == 3 and mine["materials"] == 1 and mine["points"] == 3 * 5 + 10


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
        picks = deal(uid, date(2026, 9, 29), [], bank_questions())
        assert len(picks) == 3 and len({q["ref"] for q in picks}) == 3
        speakers = [q["speaker"] for q in picks]
        if "Водитель" in speakers:
            assert speakers[0] == "Водитель"
        if "Клиент" in speakers:
            assert speakers[1] == "Клиент" or (
                speakers[0] == "Клиент" and "Водитель" not in speakers
            )
        assert deal(uid, date(2026, 9, 29), [], bank_questions()) == picks
    # The right answer is not always in the same place.
    places = {
        q["correct"]
        for uid in range(1, 40)
        for q in deal(uid, date(2026, 9, 29), [], bank_questions())
    }
    assert len(places) == 3
