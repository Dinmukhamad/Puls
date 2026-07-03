"""
P1.1/P1.2: единый модуль времени — naive-UTC now, границы локального дня
Asia/Almaty (UTC+5, без DST) и локальная ISO-сериализация.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.core.datetime_utils import (
    LOCAL_TZ,
    local_day_bounds_utc,
    now_local,
    now_utc,
    to_local_iso,
)


def test_now_utc_is_naive_and_correct():
    value = now_utc()
    assert value.tzinfo is None, "проектный стандарт БД — naive UTC"
    reference = datetime.now(timezone.utc).replace(tzinfo=None)
    assert abs(reference - value) < timedelta(seconds=5)


def test_local_day_bounds_for_fixed_date():
    start, end = local_day_bounds_utc(date(2026, 7, 3))
    # Алматы = UTC+5: локальные сутки 03.07 идут с 02.07 19:00 UTC
    assert start == datetime(2026, 7, 2, 19, 0, 0)
    assert end == datetime(2026, 7, 3, 18, 59, 59, 999999)
    assert start.tzinfo is None and end.tzinfo is None


def test_default_bounds_wrap_current_moment():
    start, end = local_day_bounds_utc()
    assert start <= now_utc() <= end
    assert (end - start) == timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)


def test_now_local_uses_business_timezone():
    value = now_local()
    assert value.tzinfo is not None
    assert value.utcoffset() == timedelta(hours=5)  # Asia/Almaty, DST нет
    assert str(LOCAL_TZ) == "Asia/Almaty"


def test_to_local_iso_converts_naive_utc():
    assert to_local_iso(datetime(2026, 7, 3, 12, 0, 0)) == "2026-07-03T17:00:00+05:00"
    assert to_local_iso(None) is None
    # aware-вход тоже корректен
    aware = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)
    assert to_local_iso(aware) == "2026-07-03T17:00:00+05:00"
