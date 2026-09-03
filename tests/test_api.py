"""Проверка HTTP-слоя: аутентификация, разграничение прав, кабинет и рейтинг."""
from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import OperatorWeekMetric
from app.models.enums import Role
from app.models.user import User
from app.services import weekly as weekly_service
from tests.conftest import auth, login, make_group, make_user

GOOD_METRICS = {
    "hours_worked": 40,
    "overtime": 8,
    "quality": 96,
    "efficiency": 92,
    "calls_per_hour": 13,
    "driver_gratitudes": 4,
    "lateness": 0,
    "forbidden_sites": 0,
}


async def _closed_week(session: AsyncSession, users: list[User]):
    week = await weekly_service.get_or_create_week(session, date(2026, 6, 1))
    for index, user in enumerate(users):
        for code, value in GOOD_METRICS.items():
            session.add(
                OperatorWeekMetric(
                    week_id=week.id,
                    user_id=user.id,
                    metric_code=code,
                    value=float(value) - index,
                )
            )
    await session.commit()
    await weekly_service.close_week(session, week)
    await session.commit()
    return week


# --------------------------------------------------------------------------- #
# Аутентификация
# --------------------------------------------------------------------------- #


async def test_login_returns_tokens(client: AsyncClient, operator: User) -> None:
    response = await client.post(
        "/api/v1/auth/login", data={"username": "op1", "password": "password123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]


async def test_login_with_wrong_password_is_rejected(
    client: AsyncClient, operator: User
) -> None:
    response = await client.post(
        "/api/v1/auth/login", data={"username": "op1", "password": "wrong"}
    )
    assert response.status_code == 401


async def test_protected_endpoint_requires_token(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/me/dashboard")).status_code == 401


async def test_disabled_account_cannot_log_in(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    operator.is_active = False
    session.add(operator)
    await session.commit()

    response = await client.post(
        "/api/v1/auth/login", data={"username": "op1", "password": "password123"}
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------- #
# Разграничение прав (п. 5)
# --------------------------------------------------------------------------- #


async def test_operator_cannot_open_admin_panel(
    client: AsyncClient, operator: User
) -> None:
    token = await login(client, "op1")
    response = await client.get("/api/v1/admin/summary", headers=auth(token))
    assert response.status_code == 403
    assert response.json()["code"] == "role_required"


async def test_supervisor_cannot_change_rules(
    client: AsyncClient, supervisor: User
) -> None:
    token = await login(client, "sv1")
    response = await client.put(
        "/api/v1/admin/config/rules",
        headers=auth(token),
        json={"points_per_coin": 1},
    )
    assert response.status_code == 403


async def test_head_can_change_rules(client: AsyncClient, head: User) -> None:
    token = await login(client, "head1")
    response = await client.put(
        "/api/v1/admin/config/rules", headers=auth(token), json={"points_per_coin": 4}
    )
    assert response.status_code == 200
    assert response.json()["points_per_coin"] == 4


async def test_supervisor_cannot_credit_operator_from_other_group(
    client: AsyncClient, session: AsyncSession, supervisor: User
) -> None:
    other_group = await make_group(session, code="G2")
    outsider = await make_user(
        session, login="op99", full_name="Чужой Оператор", group_id=other_group.id
    )

    token = await login(client, "sv1")
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(token),
        json={"user_id": outsider.id, "amount": 10, "reason": "Проверка границ доступа"},
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------- #
# Ручные начисления (п. 3.3)
# --------------------------------------------------------------------------- #


async def test_manual_credit_appears_in_operator_history(
    client: AsyncClient, operator: User, supervisor: User
) -> None:
    sv_token = await login(client, "sv1")
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(sv_token),
        json={
            "user_id": operator.id,
            "amount": 10,
            "reason": "Попадание на доску почёта",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["amount"] == 10

    op_token = await login(client, "op1")
    history = await client.get("/api/v1/me/transactions", headers=auth(op_token))
    items = history.json()["items"]
    assert items[0]["reason"] == "Попадание на доску почёта"
    assert items[0]["author_name"] == supervisor.full_name
    assert items[0]["balance_after"] == 10


async def test_manual_operation_without_reason_is_rejected(
    client: AsyncClient, operator: User, supervisor: User
) -> None:
    token = await login(client, "sv1")
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(token),
        json={"user_id": operator.id, "amount": 5, "reason": ""},
    )
    assert response.status_code == 422


async def test_manual_debit_cannot_drive_balance_negative(
    client: AsyncClient, operator: User, supervisor: User
) -> None:
    token = await login(client, "sv1")
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(token),
        json={"user_id": operator.id, "amount": -50, "reason": "Списание без покрытия"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "insufficient_coins"


async def test_manual_amount_is_capped(
    client: AsyncClient, operator: User, supervisor: User
) -> None:
    token = await login(client, "sv1")
    response = await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(token),
        json={"user_id": operator.id, "amount": 10_000, "reason": "Опечатка в сумме"},
    )
    assert response.status_code == 400


# --------------------------------------------------------------------------- #
# Кабинет и рейтинг
# --------------------------------------------------------------------------- #


async def test_dashboard_shows_balance_rank_and_metrics(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    rival = await make_user(session, login="op2", full_name="Оператор Второй")
    await _closed_week(session, [operator, rival])

    token = await login(client, "op1")
    response = await client.get("/api/v1/me/dashboard", headers=auth(token))
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["balance"]["rank"] == 1
    assert body["balance"]["participants"] == 2
    assert body["balance"]["balance"] > 0
    assert body["week"]["is_final"] is True
    assert {m["code"] for m in body["week"]["metrics"]} >= {"quality", "lateness"}
    assert body["badges_total"] > 0


async def test_rating_hides_other_balances_from_operator(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    rival = await make_user(session, login="op2", full_name="Оператор Второй")
    await _closed_week(session, [operator, rival])

    token = await login(client, "op1")
    body = (await client.get("/api/v1/rating", headers=auth(token))).json()

    rows = {row["user_id"]: row for row in body["rows"]}
    assert rows[operator.id]["is_me"] is True
    assert rows[operator.id]["balance"] is not None
    assert rows[rival.id]["balance"] is None
    assert body["podium"][0]["medal"] == "gold"
    assert body["header"]["participants"] == 2


async def test_rating_shows_balances_to_staff(
    client: AsyncClient, session: AsyncSession, operator: User, supervisor: User
) -> None:
    rival = await make_user(session, login="op2", full_name="Оператор Второй")
    await _closed_week(session, [operator, rival])

    token = await login(client, "sv1")
    body = (await client.get("/api/v1/rating", headers=auth(token))).json()
    assert all(row["balance"] is not None for row in body["rows"])


async def test_history_filter_by_kind(
    client: AsyncClient, session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _closed_week(session, [operator])
    token = await login(client, "op1")

    accruals = await client.get(
        "/api/v1/me/transactions", headers=auth(token), params={"kind": "accrual"}
    )
    purchases = await client.get(
        "/api/v1/me/transactions", headers=auth(token), params={"kind": "purchase"}
    )
    assert accruals.json()["total"] > 0
    assert purchases.json()["total"] == 0


async def test_badges_report_progress_for_locked_items(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    await _closed_week(session, [operator])
    token = await login(client, "op1")
    badges = (await client.get("/api/v1/me/badges", headers=auth(token))).json()

    by_code = {badge["code"]: badge for badge in badges}
    assert by_code["top3_week"]["unlocked"] is True
    locked = by_code["team_legend"]
    assert locked["unlocked"] is False
    assert locked["hint"]
    assert 0 <= locked["progress_percent"] <= 100


# --------------------------------------------------------------------------- #
# Магазин через HTTP
# --------------------------------------------------------------------------- #


async def test_catalog_reports_missing_coins(
    client: AsyncClient, operator: User
) -> None:
    token = await login(client, "op1")
    body = (await client.get("/api/v1/shop/items", headers=auth(token))).json()

    item = next(i for i in body["items"] if i["code"] == "coffee_card")
    assert item["can_buy"] is False
    assert item["missing_coins"] == item["price"]
    assert "Нужно ещё" in item["blocked_reason"]


async def test_full_purchase_flow_over_http(
    client: AsyncClient, session: AsyncSession, operator: User, supervisor: User
) -> None:
    sv_token = await login(client, "sv1")
    await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(sv_token),
        json={"user_id": operator.id, "amount": 60, "reason": "Баланс для покупки"},
    )

    op_token = await login(client, "op1")
    catalog = (await client.get("/api/v1/shop/items", headers=auth(op_token))).json()
    raffle = next(i for i in catalog["items"] if i["code"] == "raffle_ticket")
    assert raffle["can_buy"] is True

    created = await client.post(
        "/api/v1/shop/requests", headers=auth(op_token), json={"item_id": raffle["id"]}
    )
    assert created.status_code == 201
    request_id = created.json()["id"]

    queue = (
        await client.get(
            "/api/v1/admin/shop/requests", headers=auth(sv_token), params={"status": "new"}
        )
    ).json()
    assert queue["total"] == 1

    approved = await client.post(
        f"/api/v1/admin/shop/requests/{request_id}/approve",
        headers=auth(sv_token),
        json={"comment": "Выдано"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    balance = (await client.get("/api/v1/me/balance", headers=auth(op_token))).json()
    assert balance["balance"] == 60 - raffle["price"]
    assert balance["reserved"] == 0


# --------------------------------------------------------------------------- #
# Административные операции
# --------------------------------------------------------------------------- #


async def test_week_workflow_over_http(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    token = await login(client, "head1")

    created = await client.post(
        "/api/v1/admin/weeks", headers=auth(token), json={"any_day": "2026-06-03"}
    )
    assert created.status_code == 201
    week_id = created.json()["id"]

    upload = await client.post(
        f"/api/v1/admin/weeks/{week_id}/metrics",
        headers=auth(token),
        json={
            "values": [
                {"user_id": operator.id, "metric_code": code, "value": value}
                for code, value in GOOD_METRICS.items()
            ]
        },
    )
    assert upload.status_code == 200

    preview = await client.post(
        f"/api/v1/admin/weeks/{week_id}/recalculate", headers=auth(token)
    )
    assert preview.status_code == 200
    assert preview.json()["participants"] == 1
    assert preview.json()["coins_total"] > 0

    closed = await client.post(f"/api/v1/admin/weeks/{week_id}/close", headers=auth(token))
    assert closed.status_code == 200
    assert closed.json()["coins_awarded"] > 0

    repeat = await client.post(f"/api/v1/admin/weeks/{week_id}/close", headers=auth(token))
    assert repeat.json()["already_closed"] is True


async def test_metrics_upload_rejects_unknown_operator(
    client: AsyncClient, head: User
) -> None:
    token = await login(client, "head1")
    week_id = (
        await client.post(
            "/api/v1/admin/weeks", headers=auth(token), json={"any_day": "2026-06-03"}
        )
    ).json()["id"]

    response = await client.post(
        f"/api/v1/admin/weeks/{week_id}/metrics",
        headers=auth(token),
        json={"values": [{"user_id": 9999, "metric_code": "quality", "value": 90}]},
    )
    assert response.status_code == 400


async def test_operators_export_returns_csv(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    await _closed_week(session, [operator])
    token = await login(client, "head1")
    response = await client.get("/api/v1/admin/operators/export", headers=auth(token))

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    text = response.content.decode("utf-8-sig")
    assert "ФИО;Логин" in text.replace('"', "")
    assert operator.full_name in text


async def test_summary_counts_operators_and_requests(
    client: AsyncClient, session: AsyncSession, operator: User, head: User
) -> None:
    await _closed_week(session, [operator])
    token = await login(client, "head1")
    body = (await client.get("/api/v1/admin/summary", headers=auth(token))).json()

    assert body["operators_total"] == 1
    assert body["coins_awarded_this_week"] > 0
    assert body["new_shop_requests"] == 0


@pytest.mark.parametrize("role", [Role.SUPERVISOR, Role.HEAD])
async def test_staff_roles_reach_operators_table(
    client: AsyncClient, session: AsyncSession, role: Role
) -> None:
    await make_user(session, login="staff", role=role)
    token = await login(client, "staff")
    response = await client.get("/api/v1/admin/operators", headers=auth(token))
    assert response.status_code == 200
