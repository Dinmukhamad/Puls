"""Cron-задача автоматического еженедельного расчёта коинов (ТЗ 3.2).

Запуск: понедельник 09:00 Asia/Almaty, период — прошлая календарная неделя
(пн-вс). BackgroundScheduler живёт в памяти процесса — это безопасно, потому
что деплой всегда --workers 1 / numReplicas 1 (см. start.sh, railway.toml):
нет риска, что несколько воркеров запустят задачу параллельно и создадут
гонки. Даже если топология когда-нибудь изменится — уникальность
(operator_id, period_start, period_end) в weekly_accrual_details не даст
задвоить начисление (см. accrual_service.apply_period_accrual).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.datetime_utils import LOCAL_TZ, now_local
from app.database.db import SessionLocal

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def previous_week_bounds(today: date | None = None) -> tuple[date, date]:
    """Прошлая календарная неделя пн-вс относительно локальной (Asia/Almaty) даты."""
    today = today or now_local().date()
    this_monday = today - timedelta(days=today.weekday())
    period_start = this_monday - timedelta(days=7)
    period_end = this_monday - timedelta(days=1)
    return period_start, period_end


def run_weekly_accrual_job() -> None:
    """Тело cron-задачи. Изолирована от FastAPI-запроса — своя сессия БД,
    свой лог, любая ошибка ловится и не должна валить процесс планировщика.
    """
    from app.modules.weekly_results.accrual_service import apply_period_accrual

    period_start, period_end = previous_week_bounds()
    db = SessionLocal()
    try:
        run = apply_period_accrual(db, period_start, period_end, current_user=None, mode="auto")
        logger.info(
            "[weekly-accrual] период %s—%s: операторов=%s, коинов=%s, статус=%s",
            period_start, period_end, run.operators_count, run.total_coins, run.status,
        )
    except Exception:
        logger.exception("[weekly-accrual] автозапуск за %s—%s завершился ошибкой", period_start, period_end)
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler | None:
    """Идемпотентен: повторный вызов не создаёт второй планировщик."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = BackgroundScheduler(timezone=LOCAL_TZ)
    _scheduler.add_job(
        run_weekly_accrual_job,
        CronTrigger(day_of_week="mon", hour=9, minute=0, timezone=LOCAL_TZ),
        id="weekly_accrual",
        replace_existing=True,
        misfire_grace_time=3600,  # если контейнер был недоступен в 09:00 — догнать в течение часа
    )
    _scheduler.start()
    logger.info("[startup] Планировщик еженедельного расчёта запущен (пн 09:00 Asia/Almaty)")
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
