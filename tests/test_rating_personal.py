"""Personal rating aggregates preserve foreign identities and nomination results."""

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import NominationDefinition, NominationWinner, OperatorWeekResult
from app.models.enums import WeekStatus
from app.models.user import User
from app.services import rating as rating_service
from app.services import weekly as weekly_service
from tests.conftest import auth, login, make_group, make_user


async def _results(session, operator, scores, ranks, *, own_index=0, status=WeekStatus.CLOSED):
    week = await weekly_service.get_or_create_week(session, date(2026, 10, 5))
    week.status = status
    own = None
    for index, (score, rank) in enumerate(zip(scores, ranks, strict=True)):
        user = operator if index == own_index else await make_user(session, login=f"rival-{index}")
        result = OperatorWeekResult(
            week_id=week.id, user_id=user.id, final_points=score, rank=rank, coins_total=7
        )
        session.add(result)
        if index == own_index:
            own = result
    await session.commit()
    return week, own


@pytest.mark.parametrize(
    ("scores", "ranks", "own_index", "state", "gap"),
    [
        ([100, 90, 80, 70], [1, 2, 3, 4], 3, "outside_podium", 10),
        ([100, 90, 90, 70], [1, 2, 2, 4], 3, "outside_podium", 20),
        ([100, 90, 80, 80], [1, 2, 3, 3], 3, "on_podium", 0),
        ([100, 90], [1, 2], 1, "on_podium", 0),
        ([100], [1], 0, "on_podium", 0),
        ([100, 90, 80], [1, 2, 3], -1, "not_participating", None),
    ],
)
async def test_gap_uses_prize_rank_boundary_and_competition_ties(
    session: AsyncSession, operator: User, scores, ranks, own_index, state, gap
):
    week, own = await _results(session, operator, scores, ranks, own_index=own_index)
    personal = await rating_service.personal_podium(session, week=week, result=own)
    assert personal.state == state
    assert personal.gap == gap


async def test_uncalculated_week_never_reports_a_podium_gap(
    client: AsyncClient, session: AsyncSession, operator: User
):
    week, _ = await _results(
        session, operator, [100, 90, 80, 70], [1, 2, 3, 4],
        own_index=3, status=WeekStatus.OPEN,
    )
    response = await client.get(
        "/api/v1/rating", params={"week_id": week.id}, headers=auth(await login(client, "op1"))
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["header"]["status"] == "open"
    assert body["my_gap_to_podium"] is None
    assert body["my_podium_state"] == "uncalculated"


async def test_personal_api_keeps_only_own_identity_and_distinguishes_hidden_winner(
    client: AsyncClient, session: AsyncSession, operator: User
):
    foreign_group = await make_group(session, code="SECRET-TEAM")
    rival = await make_user(
        session, login="foreign-winner", full_name="Скрытое Чужое Имя", group_id=foreign_group.id
    )
    week, _ = await _results(session, operator, [100, 90, 80, 70], [1, 2, 3, 4], own_index=3)
    hidden = NominationDefinition(
        code="privacy-hidden", title="Hidden winner", metric_code="quality"
    )
    absent = NominationDefinition(code="privacy-absent", title="No winner", metric_code="quality")
    own = NominationDefinition(code="privacy-own", title="Own winner", metric_code="quality")
    session.add_all([hidden, absent, own])
    await session.flush()
    session.add_all([
        NominationWinner(
            week_id=week.id, nomination_id=hidden.id, user_id=rival.id,
            value=12345.678, coins_awarded=1234,
        ),
        NominationWinner(
            week_id=week.id, nomination_id=own.id, user_id=operator.id,
            value=95, coins_awarded=9,
        ),
    ])
    await session.commit()
    headers = auth(await login(client, "op1"))
    response = await client.get("/api/v1/rating", headers=headers, params={
        "week_id": week.id, "page": 99, "group_id": foreign_group.id, "search": rival.full_name,
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["view_mode"] == "personal"
    assert [row["user_id"] for row in body["rows"]] == [operator.id]
    assert body["my_row"]["user_id"] == operator.id
    assert body["my_row"]["rank"] == 4
    assert body["my_gap_to_podium"] == 10
    assert body["my_podium_state"] == "outside_podium"
    assert body["header"]["participants"] == 4
    assert body["header"]["period_start"] == "2026-10-05"
    assert body["header"]["period_end"] == "2026-10-11"
    assert body["page"] == body["size"] == 1
    assert body["podium"] == []
    for nominations in (
        body["nominations"],
        (await client.get("/api/v1/rating/nominations", headers=headers,
                          params={"week_id": week.id})).json(),
    ):
        by_code = {item["code"]: item for item in nominations}
        assert by_code[hidden.code]["winner_hidden"] is True
        assert by_code[absent.code]["winner_hidden"] is False
        assert by_code[own.code]["winner_hidden"] is False
        assert by_code[own.code]["winner_id"] == operator.id
        for code in (hidden.code, absent.code):
            item = by_code[code]
            assert item["winner_id"] is item["winner_name"] is item["winner_group"] is None
            assert item["value"] == item["coins_awarded"] == 0
        assert rival.full_name not in str(nominations)
        assert foreign_group.name not in str(nominations)
        assert "12345.678" not in str(nominations)


async def test_staff_keeps_general_table_and_full_winner_details(
    client: AsyncClient, session: AsyncSession, operator: User, supervisor: User
):
    week, _ = await _results(session, operator, [100, 90, 80, 70], [1, 2, 3, 4])
    nomination = NominationDefinition(code="staff-winner", title="Staff", metric_code="quality")
    session.add(nomination)
    await session.flush()
    session.add(NominationWinner(
        week_id=week.id, nomination_id=nomination.id, user_id=operator.id,
        value=95, coins_awarded=9,
    ))
    await session.commit()
    response = await client.get("/api/v1/rating", params={"week_id": week.id},
                                headers=auth(await login(client, "sv1")))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["view_mode"] == "table"
    assert body["total"] == 4
    assert len(body["rows"]) == 4
    assert len(body["podium"]) == 3
    winner = next(item for item in body["nominations"] if item["code"] == nomination.code)
    assert winner["winner_hidden"] is False
    assert winner["winner_name"] == operator.full_name
    assert winner["value"] == 95
    assert winner["coins_awarded"] == 9
