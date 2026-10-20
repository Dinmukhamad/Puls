"""Supervisors record the foreign sites they notice; the week counts them (docs/CHANNELS.md)."""

from datetime import timedelta

from sqlalchemy import select

from app.models.coin import CoinTransaction
from app.models.contest import OperatorWeekMetric, OperatorWeekResult
from app.models.enums import TxType, WeekStatus
from app.models.progress import Notification
from app.services import weekly as weekly_service
from app.services.economy import local_today
from tests.conftest import auth, login, make_group, make_user
from tests.test_rating_race import STRONG, _metrics

URL = "/api/v1/admin/violations"


async def _sites(session, week_id: int, user_id: int) -> float | None:
    return await session.scalar(
        select(OperatorWeekMetric.value).where(
            OperatorWeekMetric.week_id == week_id,
            OperatorWeekMetric.user_id == user_id,
            OperatorWeekMetric.metric_code == "forbidden_sites",
        )
    )


async def test_a_supervisor_records_and_cancels_sites_of_their_team(
    client, session, operator, supervisor
):
    headers = auth(await login(client, "sv1"))
    response = await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 3, "comment": "YouTube и два новостных сайта",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    week = await weekly_service.get_or_create_week(session, local_today())
    assert (body["count"], body["week_id"], body["cancelled"]) == (3, week.id, False)
    assert await _sites(session, week.id, operator.id) == 3
    note = await session.scalar(select(Notification).where(Notification.user_id == operator.id))
    assert note.title == "Отмечены посторонние сайты" and "штраф 90 коинов" in note.body
    # A second record adds up; cancelling one leaves the other.
    second = (await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 1, "comment": "Соцсеть в рабочее время",
    })).json()
    assert await _sites(session, week.id, operator.id) == 4
    listed = (await client.get(URL, headers=headers, params={"user_id": operator.id})).json()
    assert [v["count"] for v in listed] == [1, 3]
    cancelled = await client.delete(f"{URL}/{second['id']}", headers=headers)
    assert cancelled.status_code == 200 and cancelled.json()["cancelled"] is True
    week_id, operator_id = week.id, operator.id
    session.expire_all()
    assert await _sites(session, week_id, operator_id) == 3


async def test_only_the_team_and_reasonable_records(client, session, operator, supervisor):
    other_group = await make_group(session, code="G2")
    stranger = await make_user(session, login="far", group_id=other_group.id)
    headers = auth(await login(client, "sv1"))
    denied = await client.post(URL, headers=headers, json={
        "user_id": stranger.id, "count": 1, "comment": "Не моя команда",
    })
    assert denied.status_code == 403
    tomorrow = (local_today() + timedelta(days=1)).isoformat()
    future = await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 1, "noticed_on": tomorrow, "comment": "Завтра",
    })
    assert future.status_code == 400
    empty = await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 0, "comment": "Ноль",
    })
    assert empty.status_code == 422
    # An operator cannot record anything.
    own = await client.post(URL, headers=auth(await login(client, "op1")), json={
        "user_id": operator.id, "count": 1, "comment": "Сам себя",
    })
    assert own.status_code == 403


async def test_a_clean_week_pays_its_bonus_and_each_site_its_fine(
    client, session, operator, supervisor
):
    clean = await make_user(session, login="clean", full_name="Чистый Оператор",
                            group_id=operator.group_id)
    last_week = local_today() - timedelta(days=7)
    week = await weekly_service.get_or_create_week(session, last_week)
    for user in (operator, clean):
        await _metrics(session, week.id, user.id,
                       {k: v for k, v in STRONG.items() if k != "forbidden_sites"})
    await session.commit()
    headers = auth(await login(client, "sv1"))
    response = await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 2, "noticed_on": last_week.isoformat(),
        "comment": "Два посторонних сайта",
    })
    assert response.status_code == 201 and response.json()["week_id"] == week.id
    await weekly_service.close_week(session, week)
    await session.commit()
    results = {
        r.user_id: r for r in await session.scalars(
            select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id))
    }
    # Nothing recorded is 0 sites: the bonus. Two sites: no bonus, 2 × 30 coins of fine.
    assert results[clean.id].forbidden_sites_count == 0
    assert await _sites(session, week.id, clean.id) == 0
    assert results[operator.id].forbidden_sites_count == 2
    bonuses = dict((await session.execute(
        select(CoinTransaction.user_id, CoinTransaction.amount).where(
            CoinTransaction.week_id == week.id,
            CoinTransaction.tx_type == TxType.NO_SITES_BONUS,
        )
    )).all())
    assert bonuses == {clean.id: 15}
    fine = await session.scalar(select(CoinTransaction.amount).where(
        CoinTransaction.user_id == operator.id, CoinTransaction.tx_type == TxType.FINE))
    assert fine == -60
    # A day of a published week counts towards the current one; it cannot be cancelled there.
    late = await client.post(URL, headers=headers, json={
        "user_id": operator.id, "count": 1, "noticed_on": last_week.isoformat(),
        "comment": "Заметил позже",
    })
    current = await weekly_service.get_or_create_week(session, local_today())
    assert late.json()["week_id"] == current.id and current.status != WeekStatus.CLOSED


async def test_a_record_alone_puts_nobody_in_the_week(client, session, operator, supervisor):
    """The current week with only a supervisor's record is no race: the operator is not ranked."""
    from app.services import race

    worker = await make_user(session, login="worker", full_name="Рабочий Оператор",
                             group_id=operator.group_id)
    week = await weekly_service.get_or_create_week(session, local_today() - timedelta(days=7))
    week_id, worker_id, operator_id = week.id, worker.id, operator.id
    await session.commit()
    response = await client.post(URL, headers=auth(await login(client, "sv1")), json={
        "user_id": operator_id, "count": 2, "comment": "Два сайта за смену",
        "noticed_on": (local_today() - timedelta(days=7)).isoformat(),
    })
    assert response.status_code == 201
    session.expire_all()
    week = await weekly_service.get_week(session, week_id)
    # Only the record: no runners, and not the week the race opens on.
    assert (await race.standings(session, week))[0] == []
    await _metrics(session, week_id, worker_id, {k: v for k, v in STRONG.items()
                                                 if k != "forbidden_sites"})
    await session.commit()
    results = await weekly_service.calculate_week(session, week)
    assert [r.user_id for r in results] == [worker_id]
    # The record stays the operator's metric for the week.
    assert await _sites(session, week_id, operator_id) == 2
