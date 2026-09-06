from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models.contest import OperatorWeekMetric, OperatorWeekResult
from app.models.enums import Role, WeekStatus
from app.models.progress import XpEntry
from app.models.user import CoinAccount
from app.services import weekly
from app.services.progress import grant_xp
from tests.conftest import auth, login, make_group, make_user


async def test_personal_rating_history_preserves_gaps_zero_and_privacy(client, session, operator):
    outsider = await make_user(session, login="rating-history-other")
    previous = await weekly.get_or_create_week(session, date(2026, 8, 17))
    invalidated = await weekly.get_or_create_week(session, date(2026, 8, 24))
    current = await weekly.get_or_create_week(session, date(2026, 8, 31))
    previous.status = WeekStatus.CLOSED
    current.status = WeekStatus.CALCULATED
    session.add_all(
        [
            OperatorWeekResult(week_id=previous.id, user_id=operator.id, rank=3, final_points=85),
            OperatorWeekResult(
                week_id=invalidated.id, user_id=operator.id, rank=1, final_points=99
            ),
            OperatorWeekResult(week_id=current.id, user_id=operator.id, rank=4, final_points=0),
            OperatorWeekResult(week_id=current.id, user_id=outsider.id, rank=1, final_points=100),
        ]
    )
    await session.commit()
    own = auth(await login(client, operator.login))
    result = await client.get(
        f"/api/v1/rating/me/progress?week_id={current.id}&count=4", headers=own
    )
    assert result.status_code == 200, result.text
    timeline = result.json()["points"]
    assert [p["label"] for p in timeline] == ["2026-W33", "2026-W34", "2026-W35", "2026-W36"]
    assert [p["rank"] for p in timeline] == [None, 3, None, 4]
    assert [p["points"] for p in timeline] == [None, 85, None, 0]
    assert [p["status"] for p in timeline] == [None, "closed", "open", "calculated"]
    assert (
        await client.get("/api/v1/rating/me/progress?count=100000", headers=own)
    ).status_code == 422


async def test_rating_history_empty_installation_and_unknown_week(client, operator):
    own = auth(await login(client, operator.login))
    result = await client.get("/api/v1/rating/me/progress", headers=own)
    assert result.status_code == 200, result.text
    assert len(result.json()["points"]) == 8
    assert all(p["points"] is None for p in result.json()["points"])
    assert (
        await client.get("/api/v1/rating/me/progress?week_id=99999", headers=own)
    ).status_code == 404


async def test_xp_grant_is_independent_idempotent_and_notifies(client, session, head, operator):
    headers = auth(await login(client, head.login))
    own = auth(await login(client, operator.login))
    account = await session.get(CoinAccount, operator.id)
    balance = account.balance
    payload = {
        "user_id": operator.id,
        "amount": 500,
        "reason": "Завершено обучение",
        "request_id": "xp-progress-test-001",
    }
    for _ in range(2):
        response = await client.post("/api/v1/admin/xp/grant", headers=headers, json=payload)
        assert response.status_code == 200, response.text
    progress = (await client.get("/api/v1/me/xp", headers=own)).json()
    assert progress["total"] == 500
    assert progress["current"]["title"] == "Специалист"
    assert progress["remaining"] == 1000
    assert progress["progress"] == 0
    entries = (await client.get("/api/v1/me/xp/history", headers=own)).json()
    assert entries["total"] == 1
    assert entries["items"][0]["full_name"] == operator.full_name
    assert entries["items"][0]["total_after"] == 500
    await session.refresh(account)
    assert account.balance == balance
    notifications = (await client.get("/api/v1/me/notifications?unread=true", headers=own)).json()
    assert notifications["total"] == 1
    assert notifications["items"][0]["link"] == "/progress"
    changed = await client.post(
        "/api/v1/admin/xp/grant", headers=headers, json={**payload, "amount": 501}
    )
    assert changed.status_code == 409


async def test_xp_ledger_scope_and_grant_permissions(client, session, supervisor, operator):
    outsider = await make_user(session, login="other")
    for user in (operator, outsider):
        await grant_xp(
            session,
            user_id=user.id,
            amount=10,
            reason="Проверка опыта",
            source="test",
            key=f"xp:{user.id}",
        )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    result = await client.get("/api/v1/admin/xp", headers=headers)
    assert result.status_code == 200, result.text
    assert [row["user_id"] for row in result.json()["items"]] == [operator.id]
    assert (
        await client.post(
            "/api/v1/admin/xp/grant",
            headers=headers,
            json={
                "user_id": operator.id,
                "amount": 1,
                "reason": "Нельзя начислять",
                "request_id": "xp-forbidden-test-001",
            },
        )
    ).status_code == 403
    own = auth(await login(client, operator.login))
    assert (await client.get("/api/v1/admin/xp", headers=own)).status_code == 403


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE xp_entries SET amount = 999",
        "DELETE FROM xp_entries",
    ],
)
async def test_xp_history_cannot_be_rewritten(session, operator, statement):
    await grant_xp(
        session,
        user_id=operator.id,
        amount=10,
        reason="Проверка журнала",
        source="test",
        key="immutable-xp",
    )
    await session.commit()
    with pytest.raises(DBAPIError):
        await session.execute(text(statement))
    await session.rollback()
    assert (await session.scalar(select(XpEntry))).amount == 10


async def test_notifications_cannot_be_read_for_another_user(client, session, operator, head):
    await grant_xp(
        session,
        user_id=operator.id,
        amount=10,
        reason="Проверка уведомлений",
        source="test",
        key="notifications-xp",
    )
    await session.commit()
    own = auth(await login(client, operator.login))
    other = auth(await login(client, head.login))
    item = (await client.get("/api/v1/me/notifications", headers=own)).json()["items"][0]
    path = f"/api/v1/me/notifications/{item['id']}/read"
    assert (await client.post(path, headers=other)).status_code == 404
    assert (await client.post(path, headers=own)).status_code == 200
    assert (await client.get("/api/v1/me/notifications?unread=true", headers=own)).json()[
        "total"
    ] == 0


async def test_xp_levels_reject_blank_titles_and_preserve_start(client, session):
    admin = await make_user(session, login="xp-admin", role=Role.ADMIN)
    headers = auth(await login(client, admin.login))
    levels = (await client.get("/api/v1/admin/xp/levels", headers=headers)).json()
    start = next(item for item in levels if item["min_xp"] == 0)
    response = await client.put(
        f"/api/v1/admin/xp/levels/{start['id']}",
        headers=headers,
        json={**start, "is_active": False},
    )
    assert response.status_code == 400
    response = await client.post(
        "/api/v1/admin/xp/levels", headers=headers, json={"title": "   ", "min_xp": 100}
    )
    assert response.status_code == 422


async def test_analytics_keeps_gaps_zero_and_scope(client, session, operator, supervisor):
    outsider = await make_user(session, login="outside")
    other_group = await make_group(session, code="outside")
    previous = await weekly.get_or_create_week(session, date(2026, 8, 24))
    current = await weekly.get_or_create_week(session, date(2026, 8, 31))
    session.add_all(
        [
            OperatorWeekMetric(
                week_id=previous.id, user_id=operator.id, metric_code="quality", value=90
            ),
            OperatorWeekMetric(
                week_id=current.id, user_id=operator.id, metric_code="quality", value=0
            ),
            OperatorWeekMetric(
                week_id=current.id, user_id=outsider.id, metric_code="quality", value=100
            ),
        ]
    )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    path = f"/api/v1/analytics/summary?week_id={current.id}"
    response = await client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["operator_count"] == 1
    metric = next(item for item in report["metrics"] if item["code"] == "quality")
    assert (metric["value"], metric["previous"], metric["delta"], metric["improved"]) == (
        0,
        90,
        -90,
        False,
    )
    assert [item["value"] for item in report["trend"]] == [None] * 6 + [90, 0]
    assert report["operators"][0]["points"] is None
    assert (
        await client.get(path + f"&operator_ids={outsider.id}", headers=headers)
    ).status_code == 403
    assert (
        await client.get(path + f"&group_id={other_group.id}", headers=headers)
    ).status_code == 403
    own = auth(await login(client, operator.login))
    assert (await client.get(path, headers=own)).status_code == 403
    own_report = (await client.get("/api/v1/analytics/me", headers=own)).json()
    assert [row["user_id"] for row in own_report["operators"]] == [operator.id]
