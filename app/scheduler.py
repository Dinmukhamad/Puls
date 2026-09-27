"""
Планировщик еженедельного пересчёта (п. 5 «Автоматизация»).

По расписанию закрывает завершившуюся неделю: считает баллы, места,
номинации и зачисляет коины. Задача идемпотентна, поэтому повторный запуск
после сбоя не приводит к двойному начислению.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.enums import WeekStatus
from app.services import telemetry as telemetry_service
from app.services import weekly as weekly_service

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None

WEEKLY_JOB_ID = "weekly_close"
TELEMETRY_JOB_ID = "city_telemetry_purge"


async def close_previous_week() -> weekly_service.WeekCloseReport | None:
    """
    Закрывает неделю, завершившуюся накануне запуска задачи.

    Если недели нет в базе (показатели не выгружались), она заводится
    автоматически и закрывается пустой - так рейтинг не «залипает» на прошлой.
    """
    target_day = date.today() - timedelta(days=3)
    async with SessionLocal() as session:
        week = await weekly_service.get_or_create_week(session, target_day)
        if week.status == WeekStatus.CLOSED:
            logger.info("Неделя %s уже закрыта, пропускаем", week.label)
            await session.commit()
            return None

        report = await weekly_service.close_week(session, week)
        await session.commit()
        logger.info(
            "Неделя %s закрыта: участников %s, начислено коинов %s",
            report.week_label,
            report.participants,
            report.coins_awarded,
        )
        return report


async def purge_city_telemetry() -> int:
    """Daily: drops city performance reports older than 90 days."""
    async with SessionLocal() as session:
        removed = await telemetry_service.purge_old_reports(session)
    logger.info("Удалено старых отчётов о плавности города: %s", removed)
    return removed


def start_scheduler() -> AsyncIOScheduler | None:
    """Запускает планировщик, если он включён в конфигурации."""
    global _scheduler
    if not settings.SCHEDULER_ENABLED:
        logger.info("Планировщик отключён настройкой SCHEDULER_ENABLED")
        return None
    if _scheduler is not None:
        return _scheduler

    _scheduler = AsyncIOScheduler(timezone=settings.TIMEZONE)
    _scheduler.add_job(
        close_previous_week,
        CronTrigger(
            day_of_week=settings.WEEKLY_CLOSE_CRON_DAY_OF_WEEK,
            hour=settings.WEEKLY_CLOSE_CRON_HOUR,
            minute=settings.WEEKLY_CLOSE_CRON_MINUTE,
            timezone=settings.TIMEZONE,
        ),
        id=WEEKLY_JOB_ID,
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )
    _scheduler.add_job(
        purge_city_telemetry,
        CronTrigger(hour=4, minute=15, timezone=settings.TIMEZONE),
        id=TELEMETRY_JOB_ID,
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )
    _scheduler.start()
    logger.info(
        "Планировщик запущен: закрытие недели %s в %02d:%02d (%s)",
        settings.WEEKLY_CLOSE_CRON_DAY_OF_WEEK,
        settings.WEEKLY_CLOSE_CRON_HOUR,
        settings.WEEKLY_CLOSE_CRON_MINUTE,
        settings.TIMEZONE,
    )
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
