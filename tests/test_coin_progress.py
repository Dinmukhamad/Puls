import asyncio

import pytest
from sqlalchemy import func, select

from app.models.badge import BadgeDefinition, UserBadge
from app.models.coin import CoinTransaction
from app.models.enums import BadgeRule, Role, TxType
from app.models.learning import LearningAward
from app.models.progress import Notification
from app.services.badges import award_achievements
from app.services.coins import post_transaction
from app.services.progress import progress_summary, reconcile_existing_progress
from tests.conftest import auth, login, make_user
from tests.test_learning import content, publish


async def earn(session, user, amount, kind=TxType.MANUAL_CREDIT, key=None):
    return await post_transaction(
        session,
        user_id=user.id,
        amount=amount,
        tx_type=kind,
        reason="Проверка заработка",
        idempotency_key=key,
    )


async def test_levels_and_every_milestone_follow_earnings_not_wallet(session, operator):
    await earn(session, operator, 10000)
    await earn(session, operator, -10000, TxType.PURCHASE)
    data = await progress_summary(session, operator.id)
    assert data["total"] == 10000 and data["available"] == 0
    assert data["level_number"] == 7 and data["next"] is None
    milestones = [item for item in data["achievements"] if item.category == "level"]
    assert len(milestones) == 6 and all(item.unlocked for item in milestones)
    assert all(item.coins_reward == 0 for item in milestones)
    await earn(session, operator, 10000, TxType.PURCHASE_REFUND)
    assert (await progress_summary(session, operator.id))["total"] == 10000
    await earn(session, operator, -9900, TxType.CORRECTION)
    data = await progress_summary(session, operator.id)
    assert data["total"] == 100 and data["level_number"] == 2
    assert sum(item.unlocked for item in data["achievements"] if item.category == "level") == 1


async def test_reads_and_repeated_credit_never_create_more_coins(session, operator):
    await earn(session, operator, 500, key="once-credit")
    await earn(session, operator, 500, key="once-credit")
    for _ in range(3):
        data = await progress_summary(session, operator.id)
        assert data["total"] == 500 and data["remaining"] == 1000
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1


async def test_three_distinct_courses_award_one_bonus_and_raise_level(
    client, session, operator, head
):
    own = auth(await login(client, operator.login))
    await earn(session, operator, 40)
    await session.commit()
    for i in range(3):
        material = await publish(client, head, title=f"Задание {i}")
        attempt = (
            await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)
        ).json()
        base = f"/api/v1/learning/attempts/{attempt['id']}"
        await client.put(base + "/answer", headers=own, json={"step": 0, "answer": 0})
        results = await asyncio.gather(
            *[client.post(base + "/finish", headers=own) for _ in range(2)]
        )
        assert all(result.status_code == 200 for result in results)
        assert all("awarded_xp" not in result.json() for result in results)
    data = (await client.get("/api/v1/me/progress", headers=own)).json()
    assert data["total"] == 105 and data["level_number"] == 2
    learning = next(item for item in data["achievements"] if item["code"] == "learning_three")
    assert learning["unlocked"] and learning["coins_awarded"] == 50
    assert await session.scalar(select(func.count(LearningAward.id))) == 3
    assert (
        await session.scalar(
            select(func.count(CoinTransaction.id)).where(
                CoinTransaction.tx_type == TxType.ACHIEVEMENT_REWARD
            )
        )
        == 1
    )


async def test_achievement_bonus_and_fact_rollback_together(session, operator):
    # An eligible work achievement whose historic metric evidence is supplied by the evaluator.
    from unittest.mock import AsyncMock, patch

    from app.services.badges import BadgeProgress

    definition = BadgeDefinition(
        code="atomic",
        title="Надёжность",
        rule_type=BadgeRule.METRIC_TOTAL,
        rule_params={"metric": "quality", "gte": 1},
        coins_reward=50,
    )
    session.add(definition)
    await session.commit()
    original = __import__("app.services.badges", fromlist=["evaluate_badge"]).evaluate_badge

    async def eligible(db, badge, user_id):
        if badge.code == "atomic":
            return BadgeProgress(badge, True, 1, 1, "Получен")
        return await original(db, badge, user_id)

    with patch("app.services.badges.evaluate_badge", new=AsyncMock(side_effect=eligible)):
        await award_achievements(session, operator.id)
        await session.rollback()
    assert await session.scalar(select(func.count(UserBadge.id))) == 0
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 0


async def test_rollout_restores_history_without_minting_coins(session, operator):
    await earn(session, operator, 500, key="before-rollout")
    await session.commit()
    before = await session.scalar(select(func.count(CoinTransaction.id)))
    await reconcile_existing_progress(session)
    await reconcile_existing_progress(session)
    assert await session.scalar(select(func.count(CoinTransaction.id))) == before
    data = await progress_summary(session, operator.id)
    assert data["level_number"] == 3
    assert sum(item.unlocked for item in data["achievements"] if item.category == "level") == 2


async def test_retired_endpoints_and_fields_are_unavailable(client, session, operator, head):
    own = auth(await login(client, operator.login))
    admin = auth(await login(client, head.login))
    for path in ("/me/xp", "/me/xp/history", "/admin/xp", "/admin/xp/levels"):
        assert (await client.get("/api/v1" + path, headers=admin)).status_code == 404
    assert (await client.post("/api/v1/admin/xp/grant", headers=admin, json={})).status_code == 404
    assert (
        await client.post("/api/v1/admin/learning", headers=admin, json=content(xp_reward=100))
    ).status_code == 422
    session.add(Notification(user_id=operator.id, title="100 XP", body="Архив", kind="xp"))
    await session.commit()
    assert (await client.get("/api/v1/me/notifications", headers=own)).json()["total"] == 0


async def test_manual_correction_changes_progress_but_ordinary_debit_does_not(
    client, session, operator, head
):
    await earn(session, operator, 500)
    await session.commit()
    headers = auth(await login(client, head.login))
    payload = {"user_id": operator.id, "amount": -10, "reason": "Проверка исправления начисления"}
    assert (
        await client.post("/api/v1/admin/coins/manual", headers=headers, json=payload)
    ).status_code == 200
    assert (await progress_summary(session, operator.id))["total"] == 500
    payload.update(correct_earnings=True, request_id="correction-once-001")
    for _ in range(2):
        response = await client.post("/api/v1/admin/coins/manual", headers=headers, json=payload)
        assert response.status_code == 200 and response.json()["tx_type"] == "correction"
    assert (await progress_summary(session, operator.id))["total"] == 490
    wallet = await client.get(
        "/api/v1/me/wallet", headers=auth(await login(client, operator.login))
    )
    assert wallet.json()["summary"]["earned_total"] == 490


@pytest.mark.parametrize(
    "rule,params",
    [
        ("total_earned", {"gte": 100}),
        ("top_rank", {"max_rank": 3}),
        ("nomination_count", {"gte": 1}),
    ],
)
async def test_no_circular_or_duplicate_reward_rules(client, head, rule, params):
    headers = auth(await login(client, head.login))
    response = await client.post(
        "/api/v1/admin/config/badges",
        headers=headers,
        json={
            "code": "invalid-bonus",
            "title": "Ошибка",
            "rule_type": rule,
            "rule_params": params,
            "coins_reward": 100,
        },
    )
    assert response.status_code == 400


async def test_level_configuration_recalculates_existing_users_without_award(
    client, session, operator
):
    admin = await make_user(session, login="coin-level-admin", role=Role.ADMIN)
    headers = auth(await login(client, admin.login))
    await earn(session, operator, 120)
    await session.commit()
    levels = (await client.get("/api/v1/admin/progress/levels", headers=headers)).json()
    level = next(item for item in levels if item["min_coins"] == 100)
    result = await client.put(
        f"/api/v1/admin/progress/levels/{level['id']}",
        headers=headers,
        json={key: value for key, value in {**level, "min_coins": 150}.items() if key != "id"},
    )
    assert result.status_code == 200
    data = await progress_summary(session, operator.id)
    assert data["total"] == 120 and data["level_number"] == 1 and data["remaining"] == 30
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1


async def test_saved_achievement_awards_existing_result_once(client, session, operator, head):
    own = auth(await login(client, operator.login))
    admin = auth(await login(client, head.login))
    material = await publish(client, head)
    attempt = (await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)).json()
    base = f"/api/v1/learning/attempts/{attempt['id']}"
    await client.put(base + "/answer", headers=own, json={"step": 0, "answer": 0})
    assert (await client.post(base + "/finish", headers=own)).status_code == 200
    response = await client.post(
        "/api/v1/admin/config/badges",
        headers=admin,
        json={
            "code": "first-learning",
            "title": "Первое задание",
            "rule_type": "learning_count",
            "rule_params": {"gte": 1},
            "coins_reward": 95,
            "is_repeatable": True,
        },
    )
    assert response.status_code == 201, response.text
    badge_id = response.json()["id"]
    data = (await client.get("/api/v1/me/progress", headers=own)).json()
    assert data["total"] == 100 and data["level_number"] == 2
    achievement = next(item for item in data["achievements"] if item["code"] == "first-learning")
    assert achievement["unlocked"] and achievement["coins_awarded"] == 95
    for _ in range(2):
        response = await client.patch(
            f"/api/v1/admin/config/badges/{badge_id}", headers=admin, json={"coins_reward": 120}
        )
        assert response.status_code == 200
    assert (await progress_summary(session, operator.id))["total"] == 100


async def test_week_report_includes_first_bonus_and_repeat_keeps_reward_visible(session):
    from datetime import timedelta

    from app.services.weekly import close_week, get_or_create_week
    from tests.test_weekly import METRICS_STRONG, _add_metrics, _setup_week

    week, best, _, _ = await _setup_week(session)
    session.add(
        BadgeDefinition(
            code="weekly-reliability",
            title="Надёжность",
            rule_type=BadgeRule.ZERO_METRIC_STREAK,
            rule_params={"metric": "lateness", "weeks": 1},
            coins_reward=50,
            is_repeatable=True,
        )
    )
    await session.flush()
    report = await close_week(session, week)
    await session.commit()
    ledger_total = await session.scalar(
        select(func.sum(CoinTransaction.amount)).where(CoinTransaction.week_id == week.id)
    )
    assert report.coins_awarded == ledger_total
    assert (
        await session.scalar(
            select(func.sum(CoinTransaction.amount)).where(
                CoinTransaction.week_id == week.id,
                CoinTransaction.tx_type == TxType.ACHIEVEMENT_REWARD,
            )
        )
        == 100
    )
    following = await get_or_create_week(session, week.starts_on + timedelta(days=7))
    await _add_metrics(session, following.id, best.id, METRICS_STRONG)
    await close_week(session, following)
    await session.commit()
    data = await progress_summary(session, best.id)
    badge = next(item for item in data["achievements"] if item.code == "weekly-reliability")
    assert badge.unlocked and badge.coins_awarded == 50
    assert (
        await session.scalar(
            select(func.count(UserBadge.id))
            .join(BadgeDefinition)
            .where(UserBadge.user_id == best.id, BadgeDefinition.code == "weekly-reliability")
        )
        == 2
    )
