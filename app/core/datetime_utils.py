"""
Единая работа со временем в Puls (ТЗ 10.1).

Стандарт проекта:
  * В БД время хранится как naive UTC (колонки DateTime без таймзоны) —
    это уже сложившийся формат всех существующих данных и сравнений.
  * Бизнес-день (отчёты, «операции за сегодня», аналитика) считается по
    локальной таймзоне колл-центра — Asia/Almaty (UTC+5, без DST).
  * На frontend отдаётся ISO datetime; локализация — на стороне интерфейса.

Все новые обращения к «текущему времени» и границам дня должны идти через
этот модуль, а не через datetime.utcnow()/date.today() напрямую.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

# Единая бизнес-таймзона проекта (ТЗ P1.1)
LOCAL_TZ = ZoneInfo("Asia/Almaty")


def now_utc() -> datetime:
    """
    Текущее время UTC в проектном формате хранения — naive datetime.

    Замена устаревшему datetime.utcnow() (ТЗ P1.2): значение то же самое,
    но получено через timezone-aware API. tzinfo снимается сознательно,
    потому что вся БД и все сравнения в коде работают с naive UTC —
    смешение aware/naive datetime приводит к TypeError.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def now_local() -> datetime:
    """Текущее время в бизнес-таймзоне (Asia/Almaty), timezone-aware."""
    return datetime.now(LOCAL_TZ)


def local_day_bounds_utc(target_date: date | None = None) -> tuple[datetime, datetime]:
    """
    Границы локального (Asia/Almaty) дня, переведённые в naive UTC —
    готовы для сравнения с created_at и другими UTC-полями БД.

    Пример: для 2026-07-03 вернёт (2026-07-02 19:00:00, 2026-07-03 18:59:59.999999).
    Без этого «операции за сегодня» считались по UTC-дню, и всё, что сделано
    до 05:00 по Алматы, попадало во «вчера».
    """
    local_date = target_date or now_local().date()
    start_local = datetime.combine(local_date, time.min, tzinfo=LOCAL_TZ)
    end_local = datetime.combine(local_date, time.max, tzinfo=LOCAL_TZ)
    return (
        start_local.astimezone(UTC).replace(tzinfo=None),
        end_local.astimezone(UTC).replace(tzinfo=None),
    )


def to_local_iso(dt: datetime | None) -> str | None:
    """
    Naive-UTC datetime из БД → ISO-строка в локальной таймзоне (с офсетом).
    Aware datetime тоже принимается и конвертируется корректно.
    """
    if dt is None:
        return None
    aware = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    return aware.astimezone(LOCAL_TZ).isoformat()
