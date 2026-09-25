"""
Monthly SZoV reports uploaded as they come from the call-centre system.

Team reports (``report_YYYY-MM_*.xlsx``: sheets «Отработанные часы», «Звонки»,
«Эффективность») give hours, calls and effective hours per operator per day; the QA
report (``monthly_report_dates_YYYY-MM.xlsx``) gives reviewers' scores per day.
Operators are matched by full name. Every day of the month is stored for analytics,
and Monday–Sunday weeks lying fully inside the month are stored as contest week
metrics. Weeks are never closed here, so no coins are awarded.
"""

from __future__ import annotations

import io
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from zipfile import BadZipFile, ZipFile

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import managed_operators_filter
from app.core.errors import DomainError
from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    OperatorDayMetric,
    OperatorWeekMetric,
)
from app.models.enums import WeekStatus
from app.models.user import User
from app.services import weekly as weekly_service

MAX_FILES = 12
MAX_FILE_BYTES = 5 * 1024 * 1024
HOURS, CALLS, EFFECTIVE = "Отработанные часы", "Звонки", "Эффективность"
WEEK_HOURS, DAY_HOURS = 40, 8
_DAY = re.compile(r"^(\d{2})\.(\d{2})$")
_MONTH = re.compile(r"(20\d{2})-(0[1-9]|1[0-2])")
HOURS_NORM = {
    "code": "hours_norm",
    "title": "Выполнение нормы часов",
    "unit": "%",
    "target_value": 100,
    "max_points": 25,
    "allow_overachievement": False,
    "sort_order": 1,
    "description": "Отработанные часы за неделю относительно 40 ч × ставка",
}


def normalize_name(name: object) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().lower().replace("ё", "е")


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(str(value).replace(",", ".").replace(" ", ""))
    except ValueError:
        return None


def _day_columns(header: tuple, year: int, month: int) -> dict[int, date]:
    columns = {}
    for index, title in enumerate(header):
        match = _DAY.match(str(title or "").strip())
        if match and int(match.group(2)) == month:
            try:
                columns[index] = date(year, month, int(match.group(1)))
            except ValueError:
                continue
    return columns


def month_weeks(year: int, month: int) -> list[list[date]]:
    """Monday–Sunday weeks lying fully inside the month."""
    day = date(year, month, 1)
    day += timedelta(days=(7 - day.weekday()) % 7)
    weeks = []
    while (day + timedelta(days=6)).month == month:
        weeks.append([day + timedelta(days=i) for i in range(7)])
        day += timedelta(days=7)
    return weeks


def month_days(year: int, month: int) -> list[date]:
    days = [date(year, month, 1) + timedelta(days=i) for i in range(31)]
    return [day for day in days if day.month == month]


@dataclass
class ParsedReports:
    year: int
    month: int
    files: list[dict] = field(default_factory=list)
    #: daily[name][kind][day] = value for hours, calls and effective hours.
    daily: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(dict)))
    rates: dict[str, float] = field(default_factory=dict)
    #: quality[name][day] = reviewers' scores.
    quality: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(list)))
    #: Full names as written in the reports, for people missing on the site.
    labels: dict[str, str] = field(default_factory=dict)

    @property
    def names(self) -> set[str]:
        return set(self.daily) | set(self.quality)


def _open(filename: str, content: bytes):
    if len(content) > MAX_FILE_BYTES:
        raise DomainError(f"{filename}: файл больше 5 МБ", code="file_too_large")
    if not filename.lower().endswith(".xlsx"):
        raise DomainError(f"{filename}: нужен файл XLSX", code="unsupported_file")
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024:
                raise DomainError(f"{filename}: файл слишком большой", code="file_too_large")
        from openpyxl import load_workbook

        return load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except (BadZipFile, KeyError, ValueError, OSError) as exc:
        raise DomainError(f"{filename}: не удалось прочитать XLSX", code="invalid_file") from exc


def _read_team(book, parsed: ParsedReports) -> int:
    people = set()
    for kind in (HOURS, CALLS, EFFECTIVE):
        rows = book[kind].iter_rows(values_only=True)
        header = next(rows, ())
        days = _day_columns(header, parsed.year, parsed.month)
        seen = set()
        for row in rows:
            name = normalize_name(row[0] if row else None)
            if not name or name == "итого" or name in seen:
                continue
            seen.add(name)
            people.add(name)
            parsed.labels.setdefault(name, re.sub(r"\s+", " ", str(row[0])).strip())
            rate = _number(row[1]) if len(row) > 1 else None
            if kind == HOURS and rate:
                parsed.rates[name] = rate
            for column, day in days.items():
                value = _number(row[column]) if column < len(row) else None
                if value is not None:
                    parsed.daily[name][kind][day] = value
    return len(people)


def _read_quality(book, parsed: ParsedReports) -> int:
    people = set()
    for sheet in book.worksheets:
        section, days = "", {}
        for row in sheet.iter_rows(values_only=True):
            first = str((row[0] if row else None) or "").strip()
            if first.startswith("Оценки"):
                section = first
                continue
            if first == "ФИО":
                days = _day_columns(row, parsed.year, parsed.month)
                continue
            if not first or not section.startswith("Оценки по датам"):
                continue
            for column, day in days.items():
                cell = row[column] if column < len(row) else None
                for part in str(cell or "").split(","):
                    value = _number(part)
                    if value is not None and part.strip():
                        parsed.quality[normalize_name(first)][day].append(value)
                        people.add(normalize_name(first))
                        parsed.labels.setdefault(normalize_name(first), first)
    return len(people)


def detect_month(filenames: list[str], month: str | None) -> tuple[int, int]:
    if month:
        match = _MONTH.fullmatch(month.strip())
        if not match:
            raise DomainError("Месяц укажите в виде ГГГГ-ММ", code="invalid_month")
        return int(match.group(1)), int(match.group(2))
    found = {m.groups() for name in filenames if (m := _MONTH.search(name))}
    if len(found) == 1:
        year, number = found.pop()
        return int(year), int(number)
    if len(found) > 1:
        raise DomainError("Файлы относятся к разным месяцам", code="mixed_months")
    raise DomainError(
        "Не удалось определить месяц по названию файлов — выберите его вручную",
        code="month_required",
    )


def parse(files: list[tuple[str, bytes]], month: str | None = None) -> ParsedReports:
    if not files:
        raise DomainError("Выберите файлы отчётов", code="no_files")
    if len(files) > MAX_FILES:
        raise DomainError(f"Можно загрузить до {MAX_FILES} файлов", code="too_many_files")
    year, number = detect_month([name for name, _ in files], month)
    parsed = ParsedReports(year, number)
    for filename, content in files:
        book = _open(filename, content)
        try:
            if all(kind in book.sheetnames for kind in (HOURS, CALLS, EFFECTIVE)):
                kind, people = "team", _read_team(book, parsed)
            else:
                people = _read_quality(book, parsed)
                kind = "quality" if people else "unknown"
        finally:
            book.close()
        parsed.files.append({"filename": filename, "kind": kind, "people": people})
    if not any(item["kind"] != "unknown" for item in parsed.files):
        raise DomainError(
            "Не найдено ни отчёта по командам, ни отчёта проверяющих", code="unknown_reports"
        )
    return parsed


def values_for(parsed: ParsedReports, name: str, days: list[date], norm_hours: float) -> dict:
    """Metric values of one operator over a set of days: a week or a single day."""
    daily, values = parsed.daily.get(name, {}), {}
    hours = sum(daily.get(HOURS, {}).get(d, 0) for d in days)
    if hours > 0:
        rate = parsed.rates.get(name) or 1
        effective = sum(daily.get(EFFECTIVE, {}).get(d, 0) for d in days)
        calls = sum(daily.get(CALLS, {}).get(d, 0) for d in days)
        values["hours_norm"] = round(hours / (norm_hours * rate) * 100, 1)
        values["efficiency"] = round(min(100, effective / hours * 100), 1)
        values["calls_per_hour"] = round(calls / hours, 2)
    marks = [score for d in days for score in parsed.quality.get(name, {}).get(d, [])]
    if marks:
        values["quality"] = round(sum(marks) / len(marks), 1)
    return values


async def _operators(session: AsyncSession, actor: User) -> dict[str, User]:
    scope = await managed_operators_filter(session, actor)
    users = await session.scalars(select(User).where(scope, User.is_active.is_(True)))
    return {normalize_name(user.full_name): user for user in users}


async def build_plan(session: AsyncSession, actor: User, parsed: ParsedReports) -> dict:
    operators = await _operators(session, actor)
    found = sorted(name for name in parsed.names if name in operators)
    weeks = []
    for days in month_weeks(parsed.year, parsed.month):
        rows = {operators[name].id: values_for(parsed, name, days, WEEK_HOURS) for name in found}
        rows = {user_id: values for user_id, values in rows.items() if values}
        weeks.append({"days": days, "values": rows})
    daily = {}
    for day in month_days(parsed.year, parsed.month):
        for name in found:
            for code, value in values_for(parsed, name, [day], DAY_HOURS).items():
                daily[(operators[name].id, day, code)] = value
    unmatched = sorted(
        parsed.labels.get(name, name)
        for name in parsed.names
        if name not in operators and "др." not in name
    )
    return {
        "found": found,
        "unmatched": unmatched,
        "without_data": sorted(set(operators) - set(found)),
        "names": {name: operators[name].full_name for name in found},
        "weeks": weeks,
        "daily": daily,
    }


async def ensure_metrics(session: AsyncSession) -> None:
    """Hours are judged against 40 h × rate, so the catalogue needs hours_norm."""
    metric = await session.scalar(
        select(MetricDefinition).where(MetricDefinition.code == HOURS_NORM["code"])
    )
    if metric is None:
        session.add(MetricDefinition(**HOURS_NORM, is_active=True))
    elif not metric.is_active:
        metric.is_active = True
    await session.flush()


async def save(session: AsyncSession, actor: User, plan: dict, *, recalculate: bool) -> dict:
    daily = plan["daily"]
    existing = (
        {
            (row.user_id, row.day, row.metric_code): row
            for row in await session.scalars(
                select(OperatorDayMetric).where(
                    OperatorDayMetric.day.in_({key[1] for key in daily}),
                    OperatorDayMetric.user_id.in_({key[0] for key in daily}),
                )
            )
        }
        if daily
        else {}
    )
    for (user_id, day, code), value in daily.items():
        row = existing.get((user_id, day, code))
        if row is None:
            session.add(
                OperatorDayMetric(
                    user_id=user_id, day=day, metric_code=code, value=value, source="report"
                )
            )
        else:
            row.value, row.source = value, "report"

    weeks = []
    for item in plan["weeks"]:
        week: ContestWeek = await weekly_service.get_or_create_week(session, item["days"][0])
        if week.status == WeekStatus.CLOSED:
            weeks.append({"label": week.label, "status": "closed", "operators": 0})
            continue
        current = {
            (row.user_id, row.metric_code): row
            for row in await session.scalars(
                select(OperatorWeekMetric).where(OperatorWeekMetric.week_id == week.id)
            )
        }
        for user_id, values in item["values"].items():
            for code, value in values.items():
                row = current.get((user_id, code))
                if row is None:
                    session.add(
                        OperatorWeekMetric(
                            week_id=week.id,
                            user_id=user_id,
                            metric_code=code,
                            value=value,
                            source="report",
                        )
                    )
                else:
                    row.value, row.source = value, "report"
        await session.flush()
        await weekly_service.invalidate_calculation(session, week)
        if recalculate and item["values"]:
            await weekly_service.calculate_week(session, week)
        weeks.append(
            {"label": week.label, "status": str(week.status), "operators": len(item["values"])}
        )
    return {"days": len(daily), "weeks": weeks}
