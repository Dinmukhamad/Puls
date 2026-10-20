"""
Демо-данные для показа сайта: сентябрь и октябрь у всех активных операторов.

Заполняет показатели по дням и за неделю, считает баллы, места и номинации недель и
месяцев. Коинов по демо-данным нет: в результатах коины обнулены, операций в журнале
нет, уведомлений нет, а неделю или месяц с демо-данными закрыть нельзя
(services/weekly.refuse_demo), пока они не удалены. Обучение и город не заполняются:
награду за миссию оператор забирает сам, и эти коины потом не удалить.

Настоящие значения не трогаются. Если у оператора за неделю есть настоящие дневные
показатели (отчёт СЗоВ), недельное значение берётся из них, а демо добавляет только
недостающие показатели. Тестовую неделю (scripts/seed_test_week.py) сначала удалите.

Запуск (Render → gamification-api → Shell):
    python -m scripts.seed_demo_season             # заполнить 31.08 – вчера
    python -m scripts.seed_demo_season --remove    # удалить всё демо и вернуть недели как были

Числа зависят только от недели и оператора: повторный запуск даёт те же значения
и ничего не дублирует.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, engine
from app.models.contest import (
    DEMO_SOURCE,
    TEST_SOURCE,
    ContestMonth,
    ContestWeek,
    MetricDefinition,
    MonthNominationWinner,
    NominationWinner,
    OperatorDayMetric,
    OperatorMonthResult,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import Channel, MetricKind, Role, WeekStatus
from app.models.user import User
from app.services import months as months_service
from app.services import weekly as weekly_service
from app.services.analytics import summed
from scripts.seed_test_week import operator_week

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("seed_demo_season")

FIRST_MONDAY = date(2026, 8, 31)  # неделя 31.08 – 06.09 относится к сентябрю (по четвергу)
MONTHS = ((2026, 9), (2026, 10))
MARK = "demo"  # ключ в breakdown результатов: как неделя выглядела до демо


def _mondays(today: date) -> list[date]:
    out, monday = [], FIRST_MONDAY
    while monday < today:
        out.append(monday)
        monday += timedelta(days=7)
    return out


def _aggregate(metric: MetricDefinition, values: list[float]) -> float:
    """Неделя из настоящих дней: штуки и нарушения складываются, остальное усредняется."""
    if metric.kind == MetricKind.ANTI or summed(metric):
        return round(sum(values), 1)
    return round(sum(values) / len(values), 2)


def _for_channel(metrics: list[MetricDefinition], channel: str | None) -> list[MetricDefinition]:
    mine = channel or Channel.LINE
    return [m for m in metrics if (m.channel or "all") in ("all", mine)]


async def _zero_coins(
    session: AsyncSession, week_id: int | None = None, month_id: int | None = None
) -> None:
    """По демо-данным коинов нет: превью начислений в результатах обнуляется."""
    if week_id is not None:
        for result in await session.scalars(
            select(OperatorWeekResult).where(OperatorWeekResult.week_id == week_id)
        ):
            result.coins_from_points = result.coins_rank_bonus = result.coins_discipline_bonus = 0
            result.coins_nomination_bonus = result.coins_total = result.coins_fine = 0
        for winner in await session.scalars(
            select(NominationWinner).where(NominationWinner.week_id == week_id)
        ):
            winner.coins_awarded = 0
    if month_id is not None:
        for result in await session.scalars(
            select(OperatorMonthResult).where(OperatorMonthResult.month_id == month_id)
        ):
            result.coins_rank_bonus = result.coins_nomination_bonus = 0
        for winner in await session.scalars(
            select(MonthNominationWinner).where(MonthNominationWinner.month_id == month_id)
        ):
            winner.coins_awarded = 0


async def _recalculate(session: AsyncSession, week: ContestWeek, status: str) -> None:
    """Пересчёт недели и возврат её статуса: закрытая остаётся закрытой и коинов не платит."""
    week.status = WeekStatus.CALCULATED
    await session.flush()
    await weekly_service.calculate_week(session, week)
    week.status = status
    await session.flush()


async def _months(session: AsyncSession) -> None:
    for year, month in MONTHS:
        item = await months_service.get_or_create(session, year, month)
        if item.status == WeekStatus.CLOSED:
            logger.info("Месяц %s закрыт: его итоги не пересчитываются", item.label)
            continue
        await months_service.calculate(session, item)
        await _zero_coins(session, month_id=item.id)


async def fill(session: AsyncSession, today: date) -> None:
    mondays = _mondays(today)
    days_all = [m + timedelta(days=i) for m in mondays for i in range(7)]
    if await session.scalar(
        select(func.count(OperatorDayMetric.id)).where(
            OperatorDayMetric.day.in_(days_all), OperatorDayMetric.source == TEST_SOURCE
        )
    ):
        raise SystemExit(
            "В этих неделях есть тестовые значения. Сначала удалите их, например: "
            "python -m scripts.seed_test_week 2026-10-05 --remove"
        )
    metrics = list(
        await session.scalars(
            select(MetricDefinition)
            .where(MetricDefinition.is_active.is_(True))
            .order_by(MetricDefinition.sort_order, MetricDefinition.id)
        )
    )
    by_code = {m.code: m for m in metrics}
    operators = list(
        await session.scalars(
            select(User)
            .where(User.role == Role.OPERATOR, User.is_active.is_(True))
            .order_by(User.id)
        )
    )
    created_days = created_weeks = 0
    for monday in mondays:
        existed = await session.scalar(select(ContestWeek).where(ContestWeek.starts_on == monday))
        week = existed or await weekly_service.get_or_create_week(session, monday)
        # Повторный запуск помнит, какой неделя была до самого первого: её и вернёт удаление.
        mark = next(
            (
                r.breakdown[MARK]
                for r in await session.scalars(
                    select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
                )
                if MARK in (r.breakdown or {})
            ),
            None,
        )
        if mark is None:
            mark = {
                "status": str(existed.status if existed else WeekStatus.OPEN),
                "created": existed is None,
            }
        original = mark["status"]
        days = [monday + timedelta(days=i) for i in range(7)]
        real: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for row in await session.scalars(
            select(OperatorDayMetric).where(
                OperatorDayMetric.day.in_(days), OperatorDayMetric.source != DEMO_SOURCE
            )
        ):
            real[row.user_id][row.metric_code].append(row.value)
        have_days = {
            (r.user_id, r.day, r.metric_code)
            for r in await session.scalars(
                select(OperatorDayMetric).where(OperatorDayMetric.day.in_(days))
            )
        }
        have_week = {
            (r.user_id, r.metric_code)
            for r in await session.scalars(
                select(OperatorWeekMetric).where(OperatorWeekMetric.week_id == week.id)
            )
        }
        past = [day for day in days if day < today]
        for index, user in enumerate(operators):
            mine = _for_channel(metrics, user.channel)
            # Все цели выполняет примерно каждый десятый, и каждую неделю это другие операторы.
            data = operator_week(
                mine,
                days,
                f"demo:{week.label}:{user.id}",
                achiever=(index + week.iso_week) % 10 == 0,
            )
            weekly = dict(data.weekly)
            if user.id in real:
                # Настоящие дни остаются как есть, недельное значение — из них.
                weekly.update(
                    {
                        code: _aggregate(by_code[code], vals)
                        for code, vals in real[user.id].items()
                        if code in by_code
                    }
                )
            else:
                daily = {k: v for k, v in data.daily.items() if k[0] in past}
                if not daily:
                    continue
                for (day, code), value in daily.items():
                    if (user.id, day, code) not in have_days:
                        session.add(
                            OperatorDayMetric(
                                user_id=user.id,
                                day=day,
                                metric_code=code,
                                value=value,
                                source=DEMO_SOURCE,
                            )
                        )
                        created_days += 1
                worked = {day for day, _ in daily}
                if len(worked) < len({day for day, _ in data.daily}):
                    # Неделя идёт: недельные значения — из уже прошедших дней.
                    for metric in mine:
                        vals = [
                            daily[(d, metric.code)]
                            for d in sorted(worked)
                            if (d, metric.code) in daily
                        ]
                        if vals:
                            weekly[metric.code] = _aggregate(metric, vals)
            for code, value in weekly.items():
                if (user.id, code) not in have_week:
                    session.add(
                        OperatorWeekMetric(
                            week_id=week.id,
                            user_id=user.id,
                            metric_code=code,
                            value=value,
                            source=DEMO_SOURCE,
                        )
                    )
                    created_weeks += 1
        await session.flush()
        # Закрытая неделя остаётся закрытой, остальные показывают предварительный расчёт.
        await _recalculate(
            session,
            week,
            WeekStatus.CLOSED if original == WeekStatus.CLOSED else WeekStatus.CALCULATED,
        )
        await _zero_coins(session, week_id=week.id)
        for result in await session.scalars(
            select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
        ):
            result.breakdown = {**(result.breakdown or {}), MARK: mark}
        logger.info("Неделя %s: посчитана, статус «%s»", week.label, week.status)
    await session.flush()
    await _months(session)
    logger.info(
        "Операторов: %s. Новых значений по дням: %s, за неделю: %s",
        len(operators),
        created_days,
        created_weeks,
    )


async def remove(session: AsyncSession) -> None:
    weeks = list(
        await session.scalars(
            select(ContestWeek)
            .where(ContestWeek.starts_on >= FIRST_MONDAY)
            .order_by(ContestWeek.starts_on)
        )
    )
    before: dict[int, dict] = {}
    for result in await session.scalars(
        select(OperatorWeekResult).where(
            OperatorWeekResult.week_id.in_([w.id for w in weeks] or [0])
        )
    ):
        if MARK in (result.breakdown or {}):
            before[result.week_id] = result.breakdown[MARK]
    days = await session.execute(
        delete(OperatorDayMetric).where(OperatorDayMetric.source == DEMO_SOURCE)
    )
    values = await session.execute(
        delete(OperatorWeekMetric).where(OperatorWeekMetric.source == DEMO_SOURCE)
    )
    await session.flush()
    for week in weeks:
        mark = before.get(week.id)
        if mark is None:
            continue
        left = await session.scalar(
            select(func.count(OperatorWeekMetric.id)).where(OperatorWeekMetric.week_id == week.id)
        )
        if mark.get("created") and not left:
            await session.execute(
                delete(NominationWinner).where(NominationWinner.week_id == week.id)
            )
            await session.execute(
                delete(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
            )
            await session.delete(week)
            logger.info("Неделя %s заведена демо-данными и удалена", week.label)
            continue
        await _recalculate(session, week, mark.get("status", WeekStatus.CALCULATED))
        logger.info("Неделя %s: демо удалено, статус «%s»", week.label, week.status)
    await session.flush()
    for year, month in MONTHS:
        item = await session.scalar(
            select(ContestMonth).where(ContestMonth.year == year, ContestMonth.month == month)
        )
        if item is not None and item.status != WeekStatus.CLOSED:
            await months_service.calculate(session, item)
    logger.info(
        "Удалено демо-значений: по дням %s, за неделю %s", days.rowcount or 0, values.rowcount or 0
    )


async def main(*, drop: bool) -> int:
    async with SessionLocal() as session:
        if drop:
            await remove(session)
        else:
            await fill(session, date.today())
        await session.commit()
    await engine.dispose()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Демо-данные сентября и октября для показа сайта")
    parser.add_argument(
        "--remove", action="store_true", help="удалить демо-данные и вернуть недели как были"
    )
    raise SystemExit(asyncio.run(main(drop=parser.parse_args().remove)))
