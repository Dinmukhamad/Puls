"""
Закрытие завершившейся недели из командной строки.

Нужен там, где встроенный планировщик не подходит: на free-плане Render
веб-сервис засыпает без трафика, поэтому расчёт запускается отдельным
Cron Job или внешним планировщиком.

Запуск:
    python -m scripts.close_week              # закрыть прошедшую неделю
    python -m scripts.close_week 2026-06-01   # закрыть неделю, содержащую дату

Операция идемпотентна: повторный запуск не начисляет коины второй раз.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import date, timedelta

from app.db.session import SessionLocal, engine
from app.models.enums import WeekStatus
from app.services import weekly as weekly_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("close_week")


async def main(target: date) -> int:
    async with SessionLocal() as session:
        week = await weekly_service.get_or_create_week(session, target)
        if week.status == WeekStatus.CLOSED:
            logger.info("Неделя %s уже закрыта, ничего не делаем", week.label)
            await session.commit()
            return 0

        report = await weekly_service.close_week(session, week)
        await session.commit()
        logger.info(
            "Неделя %s закрыта: участников %s, начислено %s коинов, "
            "номинаций %s, бейджей %s",
            report.week_label,
            report.participants,
            report.coins_awarded,
            report.nominations_awarded,
            report.badges_awarded,
        )
    await engine.dispose()
    return 0


if __name__ == "__main__":
    # Без аргумента берётся неделя, закончившаяся накануне: запуск в понедельник
    # закрывает прошедшую неделю.
    day = (
        date.fromisoformat(sys.argv[1])
        if len(sys.argv) > 1
        else date.today() - timedelta(days=3)
    )
    raise SystemExit(asyncio.run(main(day)))
