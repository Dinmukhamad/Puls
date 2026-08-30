"""
Сервис норм часов.

Отвечает за:
- CRUD норм (work_norms)
- Расчёт индивидуальной нормы за произвольный период
- Расчёт процента выполнения нормы и баллов за часы
"""
from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import WorkNorm

# Максимум баллов за выполнение нормы часов
MAX_HOURS_POINTS: float = 25.0

VALID_RATES = {0.5, 0.75, 1.0}


def _normalize_rate(rate) -> float:
    """Конвертирует Decimal из БД в float для сравнения."""
    return float(rate) if rate is not None else None


# ── CRUD ─────────────────────────────────────────────────────────────────────

def list_norms(db: Session, active_only: bool = False) -> list[WorkNorm]:
    stmt = select(WorkNorm).order_by(WorkNorm.year.desc(), WorkNorm.month.desc(), WorkNorm.rate.asc())
    if active_only:
        stmt = stmt.where(WorkNorm.is_active.is_(True))
    return list(db.scalars(stmt))


def get_norm(db: Session, norm_id: int) -> WorkNorm | None:
    return db.get(WorkNorm, norm_id)


_NORM_CACHE_KEY = "work_norms_by_month_rate"


def _invalidate_norm_cache(db: Session) -> None:
    """Сбросить кеш норм текущей сессии после изменения справочника."""
    db.info.pop(_NORM_CACHE_KEY, None)


def get_norm_for_month(db: Session, year: int, month: int, rate: float) -> WorkNorm | None:
    """Активная норма часов для (год, месяц, ставка).

    Результат кешируется в пределах одной сессии SQLAlchemy (= одного HTTP-
    запроса). Аналитика вызывает эту функцию для каждого оператора за каждый
    месяц периода, а справочник норм — десятки строк на всю систему: без кеша
    выходило по одному SELECT на оператора (60 операторов → 60 одинаковых
    запросов на каждый эндпоинт аналитики). Кеш живёт не дольше запроса,
    поэтому не может показать устаревшие данные следующему пользователю;
    записи в справочник дополнительно сбрасывают его явно.
    """
    from decimal import Decimal

    cache = db.info.get(_NORM_CACHE_KEY)
    if cache is None:
        cache = {}
        db.info[_NORM_CACHE_KEY] = cache

    key = (year, month, str(rate))
    if key in cache:
        return cache[key]

    rate_dec = Decimal(str(rate))
    norm = db.scalar(
        select(WorkNorm).where(
            WorkNorm.year == year,
            WorkNorm.month == month,
            WorkNorm.rate == rate_dec,
            WorkNorm.is_active.is_(True),
        )
    )
    cache[key] = norm
    return norm


def create_norm(
    db: Session,
    year: int,
    month: int,
    rate: float,
    monthly_norm_hours: float,
    created_by_user_id: int | None = None,
) -> WorkNorm:
    days = calendar.monthrange(year, month)[1]
    norm = WorkNorm(
        year=year,
        month=month,
        month_days=days,
        rate=rate,
        monthly_norm_hours=monthly_norm_hours,
        is_active=True,
        created_by_user_id=created_by_user_id,
    )
    db.add(norm)
    _invalidate_norm_cache(db)
    return norm


def update_norm(db: Session, norm: WorkNorm, monthly_norm_hours: float) -> WorkNorm:
    norm.monthly_norm_hours = monthly_norm_hours
    norm.month_days = calendar.monthrange(norm.year, norm.month)[1]
    _invalidate_norm_cache(db)
    return norm


def deactivate_norm(db: Session, norm: WorkNorm) -> WorkNorm:
    norm.is_active = False
    _invalidate_norm_cache(db)
    return norm


# ── Расчёт нормы за период ───────────────────────────────────────────────────

class WorkNormResult:
    """Результат расчёта нормы за период."""

    def __init__(
        self,
        rate: float | None,
        individual_norm_hours: float,
        total_worked_hours: float,
        norm_completion_percent: float,
        hours_points: float,
        overtime_hours: float,
        overtime_percent: float,
        warnings: list[str],
    ):
        self.rate = rate
        self.individual_norm_hours = round(individual_norm_hours, 2)
        self.total_worked_hours = round(total_worked_hours, 2)
        self.norm_completion_percent = round(norm_completion_percent, 2)
        self.hours_points = round(hours_points, 2)
        self.overtime_hours = round(overtime_hours, 2)
        self.overtime_percent = round(overtime_percent, 2)
        self.warnings = warnings


def calculate_norm_for_period(
    db: Session,
    rate: float | None,
    period_start: date,
    period_end: date,
    total_worked_hours: float,
) -> WorkNormResult:
    """
    Рассчитывает индивидуальную норму за период с учётом ставки.

    Если период затрагивает несколько месяцев — норма считается пропорционально
    по каждому месяцу отдельно.
    """
    warnings: list[str] = []

    if rate is None:
        warnings.append("У оператора не указана ставка. Выполнение нормы не рассчитано.")
        return WorkNormResult(
            rate=None,
            individual_norm_hours=0,
            total_worked_hours=total_worked_hours,
            norm_completion_percent=0,
            hours_points=0,
            overtime_hours=0,
            overtime_percent=0,
            warnings=warnings,
        )

    rate = float(rate) if rate is not None else None
    if rate not in VALID_RATES:
        warnings.append(f"Некорректная ставка: {rate}. Допустимые значения: 0.5, 0.75, 1.0.")
        rate = None
        return WorkNormResult(
            rate=None,
            individual_norm_hours=0,
            total_worked_hours=total_worked_hours,
            norm_completion_percent=0,
            hours_points=0,
            overtime_hours=0,
            overtime_percent=0,
            warnings=warnings,
        )

    # Считаем норму по каждому месяцу в периоде
    individual_norm_hours = 0.0
    current = period_start
    while current <= period_end:
        year, month = current.year, current.month
        days_in_month = calendar.monthrange(year, month)[1]

        # Начало и конец части периода в этом месяце
        month_start = date(year, month, 1)
        month_end = date(year, month, days_in_month)
        chunk_start = max(current, month_start)
        chunk_end = min(period_end, month_end)
        chunk_days = (chunk_end - chunk_start).days + 1

        norm = get_norm_for_month(db, year, month, rate)
        if norm is None:
            month_name = _month_ru(month)
            warnings.append(
                f"Не найдена норма часов для ставки {rate} за {month_name} {year}."
            )
            # Следующий месяц
            if month == 12:
                current = date(year + 1, 1, 1)
            else:
                current = date(year, month + 1, 1)
            continue

        # Numeric из PostgreSQL приходит как Decimal; дальше все расчёты в float.
        chunk_norm = float(norm.monthly_norm_hours) / days_in_month * chunk_days
        individual_norm_hours += chunk_norm

        # Следующий месяц
        if month == 12:
            current = date(year + 1, 1, 1)
        else:
            current = date(year, month + 1, 1)

    if individual_norm_hours <= 0:
        if not warnings:
            warnings.append("Индивидуальная норма равна нулю — нормы за период не настроены.")
        return WorkNormResult(
            rate=rate,
            individual_norm_hours=0,
            total_worked_hours=total_worked_hours,
            norm_completion_percent=0,
            hours_points=0,
            overtime_hours=0,
            overtime_percent=0,
            warnings=warnings,
        )

    # Расчёт показателей
    norm_completion_percent = total_worked_hours / individual_norm_hours * 100
    hours_points = min(norm_completion_percent, 100) / 100 * MAX_HOURS_POINTS
    overtime_percent = max(norm_completion_percent - 100, 0)
    overtime_hours = max(total_worked_hours - individual_norm_hours, 0)

    # Защита от NaN/Infinity
    if not _is_finite(norm_completion_percent):
        norm_completion_percent = 0
    if not _is_finite(hours_points):
        hours_points = 0

    return WorkNormResult(
        rate=rate,
        individual_norm_hours=individual_norm_hours,
        total_worked_hours=total_worked_hours,
        norm_completion_percent=norm_completion_percent,
        hours_points=hours_points,
        overtime_hours=overtime_hours,
        overtime_percent=overtime_percent,
        warnings=warnings,
    )


def _is_finite(v: float) -> bool:
    import math
    return math.isfinite(v)


def _month_ru(month: int) -> str:
    names = [
        "январь", "февраль", "март", "апрель", "май", "июнь",
        "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
    ]
    return names[month - 1] if 1 <= month <= 12 else str(month)
