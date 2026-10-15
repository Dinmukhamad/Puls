"""The coin economy (docs/COIN_ECONOMY.md): fines, the monthly contest, limits, sinks, report."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select

from app.models.coin import CoinTransaction
from app.models.contest import ContestMonth, MonthNominationWinner
from app.models.enums import Role, TxType, WeekStatus
from app.models.progress import Notification
from app.services import coins as coins_service
from app.services import economy, months
from app.services import weekly as weekly_service
from app.services.rules import get_rules
from tests.conftest import auth, login, make_group, make_user
from tests.test_weekly import METRICS_STRONG, METRICS_WEAK, _add_metrics

JUNE = [date(2026, 6, 1) + timedelta(days=7 * n) for n in range(4)]


async def fund(session, user_id, amount):
    await coins_service.post_transaction(
        session, user_id=user_id, amount=amount, tx_type=TxType.MANUAL_CREDIT, reason="Тест"
    )
    await session.commit()


async def balance(session, user_id):
    account = await coins_service.get_account(session, user_id)
    await session.refresh(account)
    return account


def test_weeks_belong_to_the_month_of_their_thursday():
    assert months.calendar_weeks(2026, 6) == JUNE
    # Monday 29 June has its Thursday on 2 July: that week is July's.
    assert economy.week_month(date(2026, 6, 29)) == (2026, 7)
    assert economy.is_last_week_of_month(date(2026, 6, 22))
    assert not economy.is_last_week_of_month(date(2026, 6, 15))


async def test_new_defaults_make_about_a_thousand_a_month(session):
    rules = await get_rules(session)
    assert (rules.points_per_coin, rules.contest_period) == (0.5, "month")
    assert (rules.rank1_bonus, rules.rank2_bonus, rules.rank3_bonus) == (300, 200, 150)
    assert (rules.no_lateness_bonus, rules.no_forbidden_sites_bonus) == (25, 15)
    assert (rules.lateness_fine, rules.forbidden_site_fine) == (50, 30)
    assert (rules.driver_gratitude_bonus, rules.gratitude_monthly_limit) == (30, 5)
    assert (rules.manual_max_abs_amount, rules.manual_monthly_limit) == (200, 1500)
    assert (rules.coin_rate_tenge, rules.shop_monthly_budget_tenge) == (5.0, 50000)


async def test_a_fine_is_debited_after_the_week_and_the_rest_waits(session):
    rules = await get_rules(session)
    late = await make_user(session, login="late", full_name="Опаздывающий")
    # Ten lateness in one week: 500 coins, far more than the week brings.
    week = await weekly_service.get_or_create_week(session, JUNE[0])
    await _add_metrics(session, week.id, late.id, {**METRICS_WEAK, "lateness": 10,
                                                    "forbidden_sites": 0})
    await session.commit()
    await weekly_service.close_week(session, week)
    await session.commit()
    account = await balance(session, late.id)
    # The week's own coins go to the fine; an achievement evaluated after the week stays.
    earned = await session.scalar(select(func.sum(CoinTransaction.amount)).where(
        CoinTransaction.user_id == late.id, CoinTransaction.amount > 0,
        CoinTransaction.tx_type != TxType.ACHIEVEMENT_REWARD))
    achievements = await session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.user_id == late.id,
            CoinTransaction.tx_type == TxType.ACHIEVEMENT_REWARD,
        )
    )
    fine = await session.scalar(select(CoinTransaction).where(
        CoinTransaction.user_id == late.id, CoinTransaction.tx_type == TxType.FINE))
    assert account.balance == achievements and fine.amount == -earned
    assert "опоздания 10 × 50" in fine.reason and "Остаток" in fine.reason
    assert account.fine_debt == 10 * rules.lateness_fine - earned
    # The operator learns of it from a notification: the wallet shows them no ledger.
    note = await session.scalar(select(Notification).where(Notification.user_id == late.id,
                                                           Notification.title == "Штраф"))
    assert note.body.startswith(f"−{earned} коинов · Штраф за неделю")

    # Next week the rest goes from the new coins; what they do not cover waits again.
    debt = account.fine_debt
    nxt = await weekly_service.get_or_create_week(session, JUNE[1])
    await _add_metrics(session, nxt.id, late.id, METRICS_STRONG)
    await session.commit()
    await weekly_service.close_week(session, nxt)
    await session.commit()
    account = await balance(session, late.id)
    second = await session.scalar(select(CoinTransaction).where(
        CoinTransaction.user_id == late.id, CoinTransaction.tx_type == TxType.FINE,
        CoinTransaction.week_id == nxt.id))
    earned2 = await session.scalar(select(func.sum(CoinTransaction.amount)).where(
        CoinTransaction.user_id == late.id, CoinTransaction.week_id == nxt.id,
        CoinTransaction.amount > 0, CoinTransaction.tx_type != TxType.ACHIEVEMENT_REWARD))
    taken = min(debt, earned2)
    assert second.amount == -taken and account.fine_debt == debt - taken
    assert second.reason.startswith("Остаток прошлого штрафа")


async def test_the_month_plays_places_and_nominations_once(session):
    best = await make_user(session, login="m-best", full_name="Лучший Месяца")
    middle = await make_user(session, login="m-mid", full_name="Средний Месяца")
    worst = await make_user(session, login="m-worst", full_name="Слабый Месяца")
    for n, monday in enumerate(JUNE):
        week = await weekly_service.get_or_create_week(session, monday)
        await _add_metrics(session, week.id, best.id, METRICS_STRONG)
        await _add_metrics(session, week.id, middle.id,
                           {**METRICS_STRONG, "quality": 80, "efficiency": 75})
        await _add_metrics(session, week.id, worst.id, {**METRICS_WEAK, "lateness": 0,
                                                         "forbidden_sites": 0})
        await session.commit()
        await weekly_service.close_week(session, week)
        await session.commit()
        if n < 3:
            # The weeks pay no places: the month is computed, not paid.
            assert not await session.scalar(select(func.count(CoinTransaction.id)).where(
                CoinTransaction.tx_type.in_([TxType.RANK_BONUS, TxType.NOMINATION_BONUS])))
            item = await session.scalar(select(ContestMonth))
            assert item.status == WeekStatus.CALCULATED

    item = await session.scalar(select(ContestMonth))
    assert (item.year, item.month, item.status) == (2026, 6, WeekStatus.CLOSED)
    ranks = dict((await session.execute(select(
        CoinTransaction.user_id, CoinTransaction.amount
    ).where(CoinTransaction.tx_type == TxType.RANK_BONUS))).all())
    assert ranks == {best.id: 300, middle.id: 200, worst.id: 150}
    winners = list(await session.scalars(select(MonthNominationWinner)))
    assert winners and all(w.coins_awarded == 100 for w in winners)
    paid = await session.scalar(select(func.sum(CoinTransaction.amount)).where(
        CoinTransaction.tx_type == TxType.NOMINATION_BONUS))
    assert paid == 100 * len(winners)
    # Closing again pays nothing.
    again = await months.close(session, item)
    assert again["already_closed"]
    view = await months.view(session, item)
    assert [r["rank"] for r in view["standings"]] == [1, 2, 3]
    assert view["weeks_planned"] == 4 and len(view["weeks"]) == 4


async def test_month_cannot_close_with_an_open_week(client, session, head):
    week = await weekly_service.get_or_create_week(session, JUNE[0])
    await session.commit()
    boss = auth(await login(client, head.login))
    r = await client.post("/api/v1/admin/contest/month/close?year=2026&month=6", headers=boss)
    assert r.status_code == 409 and r.json()["code"] == "month_weeks_open"
    assert week.status != WeekStatus.CLOSED


async def test_gratitudes_and_supervisor_credits_have_monthly_limits(client, session):
    supervisor = await make_user(session, login="sv-limit", role=Role.SUPERVISOR)
    group = await make_group(session, code="LIM", supervisor_id=supervisor.id)
    operator = await make_user(session, login="op-limit", group_id=group.id)
    h = auth(await login(client, supervisor.login))
    for n in range(5):
        r = await client.post("/api/v1/admin/coins/gratitude", headers=h,
                              json={"user_id": operator.id, "driver_ref": f"D{n}"})
        assert r.status_code == 200, r.text
    sixth = await client.post("/api/v1/admin/coins/gratitude", headers=h,
                              json={"user_id": operator.id, "driver_ref": "D6"})
    assert sixth.status_code == 400 and sixth.json()["code"] == "gratitude_monthly_limit"

    too_big = await client.post("/api/v1/admin/coins/manual", headers=h, json={
        "user_id": operator.id, "amount": 201, "reason": "Слишком много"})
    assert too_big.status_code == 400
    for _ in range(7):
        r = await client.post("/api/v1/admin/coins/manual", headers=h, json={
            "user_id": operator.id, "amount": 200, "reason": "Помог команде"})
        assert r.status_code == 200, r.text
    over = await client.post("/api/v1/admin/coins/manual", headers=h, json={
        "user_id": operator.id, "amount": 200, "reason": "Помог команде"})
    assert over.status_code == 400 and over.json()["code"] == "manual_monthly_limit"
    assert "осталось 100" in over.json()["detail"]
    # A debit is never limited.
    debit = await client.post("/api/v1/admin/coins/manual", headers=h, json={
        "user_id": operator.id, "amount": -50, "reason": "Ошибка начисления"})
    assert debit.status_code == 200, debit.text


async def test_paid_spins_and_raffle_tickets_burn_coins(client, session, operator, head):
    from datetime import UTC, datetime

    boss = auth(await login(client, head.login))
    r = await client.put("/api/v1/admin/games/wheel", headers=boss, json={
        "enabled": True, "daily_spins": 1, "paid_spins": 2, "spin_cost": 10,
        "segments": [{"title": "Пусто", "weight": 1, "coins": 0},
                     {"title": "Пусто 2", "weight": 1, "coins": 0}],
    })
    assert r.status_code == 200, r.text
    await fund(session, operator.id, 25)
    me = auth(await login(client, operator.login))
    path = "/api/v1/games/wheel/spin"
    assert (await client.post(path, headers=me, json={"request_id": "free-spin-0000001"})
            ).status_code == 200
    ask = await client.post(path, headers=me, json={"request_id": "paid-spin-0000001"})
    assert ask.status_code == 409 and ask.json()["code"] == "paid_spin_required"
    for n in range(2):
        r = await client.post(path, headers=me,
                              json={"request_id": f"paid-spin-000000{n + 2}", "paid": True})
        assert r.status_code == 200, r.text
    assert (await client.post(path, headers=me, json={
        "request_id": "paid-spin-0000009", "paid": True})).status_code == 409
    wheel = (await client.get("/api/v1/games/wheel", headers=me)).json()
    assert (wheel["free_left"], wheel["paid_left"]) == (0, 0)
    assert (await balance(session, operator.id)).balance == 5

    closes = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    raffle = await client.post("/api/v1/admin/games/raffles", headers=boss, json={
        "title": "Розыгрыш", "prize": "Наушники", "closes_at": closes, "status": "published",
        "entry_cost": 50,
    })
    assert raffle.status_code == 201, raffle.text
    poor = await client.post(f"/api/v1/games/raffles/{raffle.json()['id']}/enter", headers=me)
    assert poor.status_code == 409
    await fund(session, operator.id, 50)
    ok = await client.post(f"/api/v1/games/raffles/{raffle.json()['id']}/enter", headers=me)
    assert ok.status_code == 200, ok.text
    stakes = await session.scalar(select(func.sum(CoinTransaction.amount)).where(
        CoinTransaction.tx_type == TxType.GAME_STAKE))
    assert stakes == -70


async def test_the_month_report_counts_what_is_issued_and_burned(client, session, operator, head):
    await fund(session, operator.id, 1000)
    await coins_service.post_transaction(
        session, user_id=operator.id, amount=-400, tx_type=TxType.CITY_BUILD, reason="Дом")
    await session.commit()
    boss = auth(await login(client, head.login))
    r = await client.get("/api/v1/admin/economy/report", headers=boss)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["issued"]["manual"] == 1000 and data["burned"]["city"] == 400
    assert data["net"] == 600 and data["median_balance"] == 600
    assert data["average_income"] == 1000 and data["months_held"] == 0.6
    assert data["signal"] == "balanced"
    assert (data["coin_rate_tenge"], data["shop_budget_tenge"]) == (5.0, 50000)
    me = auth(await login(client, operator.login))
    assert (await client.get("/api/v1/admin/economy/report", headers=me)).status_code == 403
