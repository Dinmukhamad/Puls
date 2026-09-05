"""Ступени прогресса по накопленным коинам (п. 6.2 ТЗ)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TxType
from app.models.level import LevelDefinition
from app.models.user import User
from app.services import coins as coins_service
from app.services import levels as levels_service
from tests.conftest import auth, login

LADDER = [
    LevelDefinition(code="rookie", title="Новичок", min_earned=0),
    LevelDefinition(code="pro", title="Профи", min_earned=150),
    LevelDefinition(code="expert", title="Эксперт", min_earned=400),
    LevelDefinition(code="legend", title="Легенда", min_earned=1000),
]


@pytest.mark.parametrize(
    ("earned", "title", "next_title", "remaining"),
    [
        (0, "Новичок", "Профи", 150),
        (1, "Новичок", "Профи", 149),
        (149, "Новичок", "Профи", 1),
        (150, "Профи", "Эксперт", 250),
        (399, "Профи", "Эксперт", 1),
        (400, "Эксперт", "Легенда", 600),
        (1000, "Легенда", None, 0),
        (5000, "Легенда", None, 0),
    ],
)
def test_level_resolved_by_accumulated_coins(
    earned: int, title: str, next_title: str | None, remaining: int
) -> None:
    progress = levels_service.resolve(LADDER, earned)
    assert progress.current is not None
    assert progress.current.title == title
    assert (progress.next.title if progress.next else None) == next_title
    assert progress.remaining == remaining


def test_progress_fraction_spans_the_gap_between_levels() -> None:
    """Полоса заполняется между порогами соседних ступеней, а не от нуля."""
    at_start = levels_service.resolve(LADDER, 150)
    midway = levels_service.resolve(LADDER, 275)
    almost = levels_service.resolve(LADDER, 399)

    assert at_start.fraction == pytest.approx(0.0)
    assert midway.fraction == pytest.approx(0.5)
    assert almost.fraction > 0.99


def test_last_level_reports_completion() -> None:
    progress = levels_service.resolve(LADDER, 1200)
    assert progress.next is None
    assert progress.fraction == 1.0
    assert progress.index == 4
    assert progress.total_levels == 4


def test_empty_ladder_is_handled() -> None:
    progress = levels_service.resolve([], 500)
    assert progress.current is None
    assert progress.total_levels == 0


async def test_spending_coins_does_not_lower_the_level(
    session: AsyncSession, operator: User
) -> None:
    """
    Уровень считается по сумме начислений за всё время.

    Покупка в магазине уменьшает баланс, но не накопленное: оператор не должен
    выбирать между наградой и статусом.
    """
    await coins_service.post_transaction(
        session,
        user_id=operator.id,
        amount=200,
        tx_type=TxType.MANUAL_CREDIT,
        reason="Начисление для проверки уровня",
    )
    await session.commit()

    before = await levels_service.for_user(
        session, (await coins_service.get_account(session, operator.id)).total_earned
    )
    assert before.current is not None and before.current.code == "pro"

    await coins_service.post_transaction(
        session,
        user_id=operator.id,
        amount=-180,
        tx_type=TxType.MANUAL_DEBIT,
        reason="Списание для проверки уровня",
    )
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    after = await levels_service.for_user(session, account.total_earned)

    assert account.balance == 20
    assert after.current is not None and after.current.code == "pro"


async def test_dashboard_exposes_level_block(
    client: AsyncClient, operator: User, supervisor: User
) -> None:
    sv_token = await login(client, "sv1")
    await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(sv_token),
        json={"user_id": operator.id, "amount": 100, "reason": "Начисление для уровня"},
    )

    op_token = await login(client, "op1")
    body = (await client.get("/api/v1/me/dashboard", headers=auth(op_token))).json()

    level = body["level"]
    assert level["title"] == "Новичок"
    assert level["next_title"] == "Профи"
    assert level["remaining"] == 50
    assert level["total_levels"] == 4
    assert 0 < level["progress"] < 1


async def test_head_can_change_level_threshold(
    client: AsyncClient, operator: User, supervisor: User, head: User
) -> None:
    """Порог меняется на лету: уровень нигде не хранится, а вычисляется."""
    sv_token = await login(client, "sv1")
    await client.post(
        "/api/v1/admin/coins/manual",
        headers=auth(sv_token),
        json={"user_id": operator.id, "amount": 100, "reason": "Начисление для уровня"},
    )

    head_token = await login(client, "head1")
    levels = (await client.get("/api/v1/admin/config/levels", headers=auth(head_token))).json()
    pro = next(level for level in levels if level["code"] == "pro")

    response = await client.patch(
        f"/api/v1/admin/config/levels/{pro['id']}",
        headers=auth(head_token),
        json={"min_earned": 50},
    )
    assert response.status_code == 200

    op_token = await login(client, "op1")
    body = (await client.get("/api/v1/me/dashboard", headers=auth(op_token))).json()
    assert body["level"]["title"] == "Профи"


async def test_operator_cannot_change_levels(client: AsyncClient, operator: User) -> None:
    token = await login(client, "op1")
    response = await client.get("/api/v1/admin/config/levels", headers=auth(token))
    assert response.status_code == 403
