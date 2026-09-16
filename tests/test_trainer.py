from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.access import AccessRule
from app.models.coin import CoinTransaction
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.learning import LearningAssignment, LearningAward
from app.services.access import SECTIONS
from tests.conftest import auth, login, make_user
from tests.test_learning import content


@pytest.fixture
async def trainer(session):
    return await make_user(session, login="trainer-test", role=Role.TRAINER)


async def test_driver_catalog_and_analytics_keep_started_pass_threshold(
    client, session, trainer, operator
):
    staff = auth(await login(client, trainer.login))
    own = auth(await login(client, operator.login))
    config = (await client.get("/api/v1/admin/learning/driver-scenario", headers=staff)).json()
    payload = content(kind="simulator", coins_reward=0, driver_config=config, pass_percent=80)
    material = (await client.post("/api/v1/admin/learning", headers=staff, json=payload)).json()
    shift_id = str(uuid4())
    started = await client.post(
        "/api/v1/learning/driver/shifts",
        headers=own,
        json={"id": shift_id, "mode": "assessment", "content_id": material["id"]},
    )
    assert started.status_code == 200, started.text
    shift = await session.get(DriverShift, shift_id)
    shift.finished_at, shift.active_slot = datetime.now(UTC), None
    shift.result = {"score": 80, "seconds": 120, "errors": 1, "checks": []}
    await session.commit()
    assert (
        await client.put(
            f"/api/v1/admin/learning/{material['id']}",
            headers=staff,
            json={**payload, "pass_percent": 95},
        )
    ).status_code == 200
    catalog = (await client.get("/api/v1/learning", headers=own)).json()
    row = next(x for x in catalog if x["id"] == material["id"])
    assert row["state"] == "passed" and row["completed"]
    report = (
        await client.get("/api/v1/admin/learning-analytics?kind=simulator", headers=staff)
    ).json()
    assert report["summary"]["passed"] == 1
    assert report["items"][0]["state"] == "passed" and report["items"][0]["errors"] == 1


async def test_staff_promotion_during_attempt_cannot_issue_operator_rewards(
    client, session, head, operator
):
    admin = auth(await login(client, head.login))
    own = auth(await login(client, operator.login))
    material = (
        await client.post("/api/v1/admin/learning", headers=admin, json=content(coins_reward=100))
    ).json()
    attempt = (await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)).json()
    operator.role = Role.TRAINER
    await session.commit()
    url = f"/api/v1/learning/attempts/{attempt['id']}"
    assert (
        await client.put(url + "/answer", headers=own, json={"step": 0, "answer": 0})
    ).status_code == 200
    finished = await client.post(url + "/finish", headers=own)
    assert finished.status_code == 200
    assert finished.json()["is_preview"] and finished.json()["awarded_coins"] == 0
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


@pytest.mark.parametrize(
    "role,visible",
    [
        (Role.OPERATOR, set()),
        (Role.TRAINER, {"operator"}),
        (Role.SUPERVISOR, {"operator", "supervisor"}),
        (Role.HEAD, {"operator", "trainer", "supervisor"}),
        (Role.ADMIN, {"operator", "trainer", "supervisor", "head", "admin"}),
    ],
)
async def test_visibility_matrix_in_lists_search_and_direct_urls(client, session, role, visible):
    accounts = {r: await make_user(session, login=f"matrix-{r}", role=r) for r in Role}
    headers = auth(await login(client, accounts[role].login))
    response = await client.get("/api/v1/admin/users", headers=headers)
    if role == Role.OPERATOR:
        assert response.status_code == 403
        assert (await client.get("/api/v1/lookups/users", headers=headers)).status_code == 403
        return
    assert response.status_code == 200, response.text
    assert {x["role"] for x in response.json()["items"]} == visible
    for target_role, target in accounts.items():
        hidden = str(target_role) not in visible
        detail = await client.get(f"/api/v1/admin/users/{target.id}", headers=headers)
        assert detail.status_code == (404 if hidden else 200)
        for path in (f"/admin/users?search={target.login}", f"/lookups/users?role={target_role}"):
            result = await client.get("/api/v1" + path, headers=headers)
            assert result.status_code == 200
            if hidden:
                assert result.json()["total"] == 0


async def test_trainer_creates_only_operator_and_receives_minimal_fields(client, trainer):
    headers = auth(await login(client, trainer.login))
    base = {
        "login": "trainer-created",
        "full_name": "Созданный оператор",
        "password": "secret-password123",
    }
    for role in ("trainer", "supervisor", "head", "admin"):
        response = await client.post(
            "/api/v1/admin/users", headers=headers, json={**base, "role": role}
        )
        assert response.status_code == 403
    response = await client.post(
        "/api/v1/admin/users", headers=headers, json={**base, "role": "operator"}
    )
    assert response.status_code == 201, response.text
    assert set(response.json()) == {"id", "login", "full_name", "role", "is_active", "created_at"}
    detail = await client.get(f"/api/v1/admin/users/{response.json()['id']}", headers=headers)
    assert set(detail.json()) == set(response.json())
    assert "secret-password123" not in response.text and "hashed_password" not in response.text


async def test_trainer_role_ceiling_survives_explicit_grants(client, session, trainer, operator):
    session.add_all(
        [
            AccessRule(
                target_type="user", target_id=str(trainer.id), section=s.code, effect="allow"
            )
            for s in SECTIONS
        ]
    )
    await session.commit()
    headers = auth(await login(client, trainer.login))
    access = (await client.get("/api/v1/me/access", headers=headers)).json()
    assert {key for key, enabled in access["allowed"].items() if enabled} == {
        "team",
        "training",
        "learning_admin",
    }
    for path in (
        "/admin/groups",
        "/admin/summary",
        "/admin/operators",
        "/admin/wallet",
        "/admin/progress/levels",
        "/analytics/summary",
        "/rating",
        "/shop/items",
        "/games/wheel",
        "/me/wallet",
        "/me/progress",
        "/admin/sessions",
        "/admin/access",
        f"/admin/users/{operator.id}/dashboard",
        f"/admin/users/{operator.id}/transactions",
    ):
        assert (await client.get("/api/v1" + path, headers=headers)).status_code == 403, path
    for path, payload in (
        (f"/admin/users/{operator.id}/password", {"password": "new-secret123"}),
        ("/admin/coins/manual", {"user_id": operator.id, "amount": 100, "reason": "Forbidden"}),
    ):
        assert (
            await client.post("/api/v1" + path, headers=headers, json=payload)
        ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/admin/users/{operator.id}", headers=headers, json={"role": "trainer"}
        )
    ).status_code == 403


async def test_training_preview_assignments_and_statistics(
    client, session, trainer, operator, head
):
    headers = auth(await login(client, trainer.login))
    own = auth(await login(client, operator.login))
    response = await client.post(
        "/api/v1/admin/learning", headers=headers, json=content(status="draft", coins_reward=0)
    )
    assert response.status_code == 201, response.text
    material = response.json()
    preview = await client.post(f"/api/v1/admin/learning/{material['id']}/preview", headers=headers)
    assert preview.status_code == 200 and preview.json()["is_preview"]
    attempt_id = preview.json()["id"]
    await client.put(
        f"/api/v1/learning/attempts/{attempt_id}/answer",
        headers=headers,
        json={"step": 0, "answer": 0},
    )
    done = await client.post(f"/api/v1/learning/attempts/{attempt_id}/finish", headers=headers)
    assert done.status_code == 200 and done.json()["awarded_coins"] == 0
    assert await session.scalar(select(func.count(LearningAward.id))) == 0
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0
    assert (await client.get("/api/v1/admin/learning-results", headers=headers)).json()[
        "total"
    ] == 0
    assert (await client.get("/api/v1/admin/learning-analytics", headers=headers)).json()[
        "summary"
    ]["attempts"] == 0
    assert (
        await client.post(f"/api/v1/admin/learning/{material['id']}/preview", headers=own)
    ).status_code == 403
    update = content(status="published", coins_reward=0)
    assert (
        await client.put(f"/api/v1/admin/learning/{material['id']}", headers=headers, json=update)
    ).status_code == 200
    assignment_url = f"/api/v1/admin/learning/{material['id']}/assign"
    assert (
        await client.post(
            assignment_url, headers=headers, json={"user_ids": [operator.id, head.id]}
        )
    ).status_code == 404
    assert await session.scalar(select(func.count(LearningAssignment.id))) == 0
    first = await client.post(assignment_url, headers=headers, json={"user_ids": [operator.id]})
    assert first.status_code == 200 and first.json()["assigned"] == 1
    assert (
        await client.post(assignment_url, headers=headers, json={"all_operators": True})
    ).json()["already_assigned"] == 1
    catalog = (await client.get("/api/v1/learning", headers=own)).json()
    assert catalog[0]["assigned"] and catalog[0]["is_required"]
    assert (await client.get("/api/v1/admin/learning-analytics", headers=headers)).json()[
        "summary"
    ]["not_started"] == 1
    for answer in (1, 0):
        attempt = (
            await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)
        ).json()
        url = f"/api/v1/learning/attempts/{attempt['id']}"
        await client.put(url + "/answer", headers=own, json={"step": 0, "answer": answer})
        assert (await client.post(url + "/finish", headers=own)).status_code == 200
    report = (
        await client.get("/api/v1/admin/learning-analytics?kind=test", headers=headers)
    ).json()
    assert report["summary"]["attempts"] == 2
    assert report["summary"]["repeat_attempts"] == 1
    assert report["summary"]["pass_percent"] == 50
    assert report["summary"]["average_score"] == report["summary"]["median_score"] == 50
    assert report["questions"][0]["errors"] == 1 and report["questions"][0]["answers"] == 2
    assert (
        await client.get(f"/api/v1/admin/learning-analytics?user_id={head.id}", headers=headers)
    ).status_code == 404
    exported = await client.get("/api/v1/admin/learning-analytics?export=true", headers=headers)
    assert (
        exported.status_code == 200
        and operator.full_name in exported.text
        and head.full_name not in exported.text
    )


async def test_trainer_cannot_change_learning_reward(client, trainer):
    headers = auth(await login(client, trainer.login))
    response = await client.post(
        "/api/v1/admin/learning", headers=headers, json=content(coins_reward=100)
    )
    assert response.status_code == 403


async def test_driver_scenario_library_preview_does_not_change_global_config(
    client, session, trainer
):
    headers = auth(await login(client, trainer.login))
    before = (await client.get("/api/v1/admin/learning/driver-scenario", headers=headers)).json()
    scenario = {**before, "title": "Учебная проверка тренера", "target_orders": 1}
    response = await client.post(
        "/api/v1/admin/learning",
        headers=headers,
        json=content(kind="simulator", coins_reward=0, driver_config=scenario),
    )
    assert response.status_code == 201, response.text
    material_id = response.json()["id"]
    launch = await client.post(
        "/api/v1/learning/driver/shifts",
        headers=headers,
        json={"id": str(uuid4()), "mode": "assessment", "content_id": material_id},
    )
    assert launch.status_code == 200, launch.text
    shift = await session.scalar(select(DriverShift).where(DriverShift.user_id == trainer.id))
    assert shift.is_preview and shift.content_id == material_id
    assert shift.config["target_orders"] == 1
    assert (
        await client.get("/api/v1/admin/learning/driver-scenario", headers=headers)
    ).json() == before
    assert (await client.get("/api/v1/admin/learning/driver-results", headers=headers)).json()[
        "total"
    ] == 0
    assert (
        await client.put("/api/v1/admin/learning/driver-parks", headers=headers, json={})
    ).status_code == 403
    assert (
        await client.put("/api/v1/admin/learning/driver-scenario", headers=headers, json=before)
    ).status_code == 403
