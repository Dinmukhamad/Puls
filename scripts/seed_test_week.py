"""
Тестовая неделя для проверки аналитики.

Заполняет показатели всех активных операторов за каждый рабочий день недели и за
саму неделю. Значения помечаются источником «test»: аналитика их показывает, но они
не дают баллов, мест, номинаций, значков и коинов, поэтому при закрытии неделя
считается пустой. Настоящие значения скрипт не трогает, а отчёт, загруженный позже,
заменяет тестовые.

Запуск (Render → gamification-api → Shell):
    python -m scripts.seed_test_week 2026-10-05            # заполнить неделю с этой датой
    python -m scripts.seed_test_week 2026-10-05 --remove   # удалить тестовые значения

Числа зависят только от недели и оператора: повторный запуск даёт те же значения
и ничего не дублирует.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, engine
from app.models.contest import (
    TEST_SOURCE,
    ContestWeek,
    MetricDefinition,
    OperatorDayMetric,
    OperatorWeekMetric,
)
from app.models.enums import MetricDirection, MetricKind, Role, WeekStatus
from app.models.user import User
from app.services import weekly as weekly_service
from app.services.analytics import WORKDAYS_PER_WEEK, summed, target_for

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("seed_test_week")

DAY_HOURS, WEEK_HOURS = 8.0, 40.0


def _sums(metric: MetricDefinition) -> bool:
    """Часы, штуки и нарушения за неделю складываются, проценты и «в час» усредняются."""
    return metric.kind == MetricKind.ANTI or summed(metric)


def _day_value(metric: MetricDefinition, rng: random.Random, skill: float, hours: float) -> float:
    """Значение за один рабочий день. skill от -1 до 1: слабый или сильный оператор."""
    code = metric.code
    if metric.kind == MetricKind.ANTI:
        return 1.0 if rng.random() < 0.06 - 0.03 * skill else 0.0
    if code == "hours_worked":
        return hours
    if code == "hours_norm":
        return round(hours / DAY_HOURS * 100, 1)
    if code == "overtime":
        return max(0.0, hours - DAY_HOURS)
    if code == "quality":
        return round(min(100.0, 92 + 6 * skill + rng.gauss(0, 2)), 1)
    if code == "efficiency":
        return round(min(100.0, 88 + 9 * skill + rng.gauss(0, 3)), 1)
    if code == "calls_per_hour":
        return round(max(0.0, 12 + 2 * skill + rng.gauss(0, 0.8)), 2)
    if code == "driver_gratitudes":
        return float(rng.random() < 0.35 + 0.15 * skill) + float(rng.random() < 0.1)
    # Показатель, которого скрипт не знает: держится около дневной цели в своих единицах.
    lower = metric.direction == MetricDirection.LOWER_IS_BETTER
    level = 1 + (-0.1 if lower else 0.08) * skill + rng.gauss(0, 0.04)
    value = max(0.0, target_for(metric, "day") * level)
    if "%" in (metric.unit or "") and not metric.allow_overachievement:
        value = min(value, metric.target_value)
    return round(value, 1 if _sums(metric) else 2)


def _week_value(
    metric: MetricDefinition, days: dict[date, float], hours: dict[date, float]
) -> float:
    if metric.code == "hours_norm":
        return round(sum(hours.values()) / WEEK_HOURS * 100, 1)
    if _sums(metric):
        return round(sum(days.values()), 1)
    return round(sum(days.values()) / len(days), 2)


def _reach_target(metric: MetricDefinition, values: dict[date, float]) -> dict[date, float]:
    """Дни сильного оператора, подтянутые до дневной цели.

    Рабочих дней ровно столько, на сколько аналитика делит недельную цель, поэтому
    неделя из таких дней выполняет и недельную цель.
    """
    if metric.kind == MetricKind.ANTI:
        return dict.fromkeys(values, 0.0)
    goal = target_for(metric, "day")
    if metric.direction == MetricDirection.LOWER_IS_BETTER:
        return {day: min(value, goal) for day, value in values.items()}
    return {day: max(value, goal) for day, value in values.items()}


@dataclass
class OperatorWeek:
    daily: dict[tuple[date, str], float] = field(default_factory=dict)
    weekly: dict[str, float] = field(default_factory=dict)


def operator_week(
    metrics: list[MetricDefinition], days: list[date], seed: str, *, achiever: bool = False
) -> OperatorWeek:
    """Неделя одного оператора: два выходных, свой уровень и разброс по дням.

    achiever — сильный оператор, который выполняет все цели и за каждый рабочий день,
    и за неделю.
    """
    rng = random.Random(seed)
    off = set(rng.sample(range(len(days)), len(days) - WORKDAYS_PER_WEEK))
    worked = [day for index, day in enumerate(days) if index not in off]
    skill = rng.uniform(0.5, 1) if achiever else rng.uniform(-1, 0.5)
    hours = {day: float(rng.choice([8, 8, 8, 8, 8, 7, 9, 10, 6])) for day in worked}
    if achiever:
        hours = {day: max(value, DAY_HOURS) for day, value in hours.items()}
    result = OperatorWeek()
    for metric in metrics:
        values = {day: _day_value(metric, rng, skill, hours[day]) for day in worked}
        if achiever:
            values = _reach_target(metric, values)
        result.daily.update({(day, metric.code): value for day, value in values.items()})
        result.weekly[metric.code] = _week_value(metric, values, hours)
    return result


@dataclass
class Counts:
    created: int = 0
    updated: int = 0
    kept_real: int = 0


def _missing(
    row: OperatorDayMetric | OperatorWeekMetric | None, value: float, counts: Counts
) -> bool:
    """True, если строки ещё нет. Тестовая строка обновляется, настоящая остаётся как есть."""
    if row is None:
        counts.created += 1
        return True
    if row.source == TEST_SOURCE:
        row.value = value
        counts.updated += 1
    else:
        counts.kept_real += 1
    return False


async def fill(session: AsyncSession, any_day: date) -> tuple[ContestWeek, int, Counts, Counts]:
    week = await weekly_service.get_or_create_week(session, any_day)
    days = [week.starts_on + timedelta(days=offset) for offset in range(7)]
    metrics = list(
        await session.scalars(
            select(MetricDefinition)
            .where(MetricDefinition.is_active.is_(True))
            .order_by(MetricDefinition.sort_order, MetricDefinition.id)
        )
    )
    operators = list(
        await session.scalars(
            select(User)
            .where(User.role == Role.OPERATOR, User.is_active.is_(True))
            .order_by(User.id)
        )
    )
    known_days = {
        (row.user_id, row.day, row.metric_code): row
        for row in await session.scalars(
            select(OperatorDayMetric).where(OperatorDayMetric.day.in_(days))
        )
    }
    known_week = {
        (row.user_id, row.metric_code): row
        for row in await session.scalars(
            select(OperatorWeekMetric).where(OperatorWeekMetric.week_id == week.id)
        )
    }
    day_counts, week_counts = Counts(), Counts()
    for index, user in enumerate(operators):
        # Каждый четвёртый выполняет все цели, чтобы аналитика показала все состояния.
        data = operator_week(metrics, days, f"{week.label}:{user.id}", achiever=index % 4 == 0)
        for (day, code), value in data.daily.items():
            if _missing(known_days.get((user.id, day, code)), value, day_counts):
                session.add(
                    OperatorDayMetric(
                        user_id=user.id, day=day, metric_code=code, value=value, source=TEST_SOURCE
                    )
                )
        for code, value in data.weekly.items():
            if _missing(known_week.get((user.id, code)), value, week_counts):
                session.add(
                    OperatorWeekMetric(
                        week_id=week.id,
                        user_id=user.id,
                        metric_code=code,
                        value=value,
                        source=TEST_SOURCE,
                    )
                )
    await session.flush()
    return week, len(operators), day_counts, week_counts


async def remove(session: AsyncSession, any_day: date) -> tuple[int, int]:
    monday = any_day - timedelta(days=any_day.weekday())
    days = [monday + timedelta(days=offset) for offset in range(7)]
    removed_days = await session.execute(
        delete(OperatorDayMetric).where(
            OperatorDayMetric.day.in_(days), OperatorDayMetric.source == TEST_SOURCE
        )
    )
    week = await session.scalar(select(ContestWeek).where(ContestWeek.starts_on == monday))
    removed_week = (
        await session.execute(
            delete(OperatorWeekMetric).where(
                OperatorWeekMetric.week_id == week.id, OperatorWeekMetric.source == TEST_SOURCE
            )
        )
        if week
        else None
    )
    return removed_days.rowcount or 0, (removed_week.rowcount or 0) if removed_week else 0


async def main(any_day: date, *, drop: bool) -> int:
    async with SessionLocal() as session:
        if drop:
            days, weekly = await remove(session, any_day)
            await session.commit()
            logger.info("Удалено тестовых значений: по дням %s, за неделю %s", days, weekly)
        else:
            week, operators, days, weekly = await fill(session, any_day)
            await session.commit()
            logger.info(
                "Неделя %s (%s – %s): операторов %s. По дням: новых %s, обновлено %s, "
                "настоящих оставлено %s. За неделю: новых %s, обновлено %s, настоящих оставлено %s",
                week.label,
                week.starts_on.strftime("%d.%m"),
                week.ends_on.strftime("%d.%m"),
                operators,
                days.created,
                days.updated,
                days.kept_real,
                weekly.created,
                weekly.updated,
                weekly.kept_real,
            )
            if week.status == WeekStatus.CLOSED:
                logger.info("Неделя уже закрыта: тестовые значения видны только в аналитике")
    await engine.dispose()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Тестовые показатели недели для аналитики")
    parser.add_argument(
        "day",
        type=date.fromisoformat,
        nargs="?",
        default=date.today(),
        help="любой день нужной недели, ГГГГ-ММ-ДД (по умолчанию сегодня)",
    )
    parser.add_argument("--remove", action="store_true", help="удалить тестовые значения недели")
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(main(arguments.day, drop=arguments.remove)))
