"""
Monthly SZoV reports uploaded as they come from the call-centre system (docs/SZOV_REPORTS.md).

Team reports (``report_YYYY-MM*.xlsx``) come for the line (sheets «Отработанные часы», «Звонки»,
«Эффективность») and for chats («Отработанные часы», «Чаты», «Среднее время ответа»). Both may carry
«Тренинги», «Тех. сбои» and «Офлайн активность» (hours that count towards the norm), «Штрафы»
(lateness) and the operator's «Норма часов (ч)» for the month. «др.» marks a day the operator spent
in another team. The QA report (``monthly_report_dates_YYYY-MM.xlsx``) gives reviewers' scores per
day and each operator's average for the month.

Operators are matched by full name. Every day of the month is stored for analytics, and
Monday–Sunday weeks lying fully inside the month are stored as contest week metrics. Weeks are never
closed here, so no coins are awarded.
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
from app.models.enums import Channel, MetricDirection, WeekStatus
from app.models.user import User
from app.services import weekly as weekly_service

MAX_FILES = 12
MAX_FILE_BYTES = 5 * 1024 * 1024
HOURS, CALLS, EFFECTIVE = "Отработанные часы", "Звонки", "Эффективность"
CHATS, RESPONSE = "Чаты", "Среднее время ответа"
#: Hours that count towards the norm besides the hours on the line or in chats.
EXTRA = ("Тренинги", "Тех. сбои", "Офлайн активность")
FINES = "Штрафы"
#: The operator was in another team that day: no data and no norm here.
AWAY = "др."
WEEK_HOURS, DAY_HOURS = 40, 8
LINE, CHAT = str(Channel.LINE), str(Channel.CHAT)
#: Per channel: hours against the norm, hours above it, and the reviewers' score.
CODES = {
    LINE: {"norm": "hours_norm", "overtime": "overtime", "quality": "quality"},
    CHAT: {"norm": "chat_hours_norm", "overtime": "chat_overtime", "quality": "chat_quality"},
}
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
    "description": "Часы на линии, тренинги, тех. сбои и офлайн-активность против нормы часов "
    "оператора из отчёта СЗоВ",
}
#: What the chat report gives besides the quality. No points until set in the settings.
CHAT_METRICS = (
    {
        "code": "chat_hours_norm",
        "title": "Норма часов в чатах",
        "unit": "%",
        "target_value": 100,
        "max_points": 0,
        "allow_overachievement": False,
        "sort_order": 16,
        "channel": CHAT,
        "description": "Часы в чатах, тренинги, тех. сбои и офлайн-активность против нормы часов "
        "из отчёта СЗоВ. Без баллов, пока их не зададут в настройках.",
    },
    {
        "code": "chat_overtime",
        "title": "Переработки в чатах",
        "unit": "ч",
        "target_value": 8,
        "max_points": 0,
        "sort_order": 17,
        "channel": CHAT,
        "description": "Часы сверх нормы за неделю. Без баллов, пока их не зададут в настройках.",
    },
    {
        "code": "chat_response_time",
        "title": "Среднее время ответа в чатах",
        "unit": "сек",
        "direction": MetricDirection.LOWER_IS_BETTER,
        "target_value": 120,
        "max_points": 0,
        "allow_overachievement": False,
        "sort_order": 18,
        "channel": CHAT,
        "description": "Среднее по дням из отчёта СЗоВ, меньше — лучше. Без баллов, пока их не "
        "зададут в настройках.",
    },
)


def normalize_name(name: object) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().lower().replace("ё", "е")


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    text = re.sub(r"[\s  ]", "", str(value)).replace(",", ".")
    try:
        return float(text) if text else None
    except ValueError:
        return None


def _away(value: object) -> bool:
    return isinstance(value, str) and value.strip().lower() == AWAY


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


def _columns(header: tuple) -> dict[str, int]:
    return {str(title).strip().casefold(): i for i, title in enumerate(header) if title is not None}


def _cell(row: tuple, column: int | None) -> object:
    return row[column] if column is not None and column < len(row) else None


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
class Team:
    """One operator in the reports of one channel (the line or chats)."""

    #: days[kind][day]: «hours» worked (the report counts trainings, tech failures and offline
    #: activity in them), «extra» (those three), «calls», «effective», «response» (seconds),
    #: «fines» (tenge).
    days: dict = field(default_factory=lambda: defaultdict(dict))
    #: Days in this team: «Отработанные часы» is not «др.».
    present: set = field(default_factory=set)
    rate: float | None = None
    #: The month's «Норма часов (ч)», summed over the channel's reports; None without the column.
    norm: float | None = None
    fines: bool = False
    #: From the fines summary: lateness count and the count of other reasons.
    late: int | None = None
    other_fines: int = 0

    def hours(self, day: date) -> float:
        return self.days["hours"].get(day, 0.0)

    def base(self, day: date) -> float:
        """Hours on the line or in chats: «База часов», without the trainings and the rest."""
        return max(0.0, self.hours(day) - self.days["extra"].get(day, 0.0))

    @property
    def span(self) -> set[date]:
        """Days in the team from the first to the last day with hours: zeros before someone
        started or after they left carry no norm."""
        worked = sorted(day for day in self.present if self.hours(day) > 0)
        return {day for day in self.present if worked and worked[0] <= day <= worked[-1]}

    def week_norm(self, days: list[date]) -> float:
        """The report's norm shared evenly by the days of the span (the report splits it by
        calendar days too); without it — 40 h × rate a week."""
        span = self.span
        if self.norm and span:
            return self.norm * len(span & set(days)) / len(span)
        return WEEK_HOURS * (self.rate or 1)

    def lateness(self, day: date) -> int:
        return 1 if self.days["fines"].get(day, 0) > 0 else 0

    @property
    def lateness_known(self) -> bool:
        """Each day with a fine is a lateness only when the month has no other reasons."""
        return self.fines and self.late is not None and not (self.late and self.other_fines)


@dataclass
class ParsedReports:
    year: int
    month: int
    files: list[dict] = field(default_factory=list)
    #: teams[(channel, name)] — what the line or chat reports say about the operator.
    teams: dict = field(default_factory=dict)
    #: quality[name][day] = reviewers' scores.
    quality: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(list)))
    #: The QA report's average for the month and how many scores it has (dated or not).
    quality_month: dict[str, tuple[float, int]] = field(default_factory=dict)
    #: Full names as written in the reports, for people missing on the site.
    labels: dict[str, str] = field(default_factory=dict)

    @property
    def names(self) -> set[str]:
        return {name for _, name in self.teams} | set(self.quality) | set(self.quality_month)

    def team(self, channel: str, name: str) -> Team:
        return self.teams.setdefault((channel, name), Team())


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


def _person(row: tuple, parsed: ParsedReports) -> str:
    """The operator of a row; «Итого» and empty rows are nobody."""
    name = normalize_name(row[0] if row else None)
    if not name or name == "итого":
        return ""
    parsed.labels.setdefault(name, re.sub(r"\s+", " ", str(row[0])).strip())
    return name


def _read_days(book, title: str, parsed: ParsedReports, channel: str, kind: str) -> None:
    """A sheet of one value per operator per day; hours add up, an average is kept as it is."""
    if title not in book.sheetnames:
        return
    rows = book[title].iter_rows(values_only=True)
    days = _day_columns(next(rows, ()), parsed.year, parsed.month)
    seen = set()
    for row in rows:
        name = _person(row, parsed)
        if not name or name in seen:
            continue
        seen.add(name)
        values = parsed.team(channel, name).days[kind]
        for column, day in days.items():
            value = _number(_cell(row, column))
            if value is not None:
                values[day] = value if kind == "response" else values.get(day, 0.0) + value


def _read_hours(book, parsed: ParsedReports, channel: str) -> set[str]:
    rows = book[HOURS].iter_rows(values_only=True)
    header = next(rows, ())
    days, columns = _day_columns(header, parsed.year, parsed.month), _columns(header)
    rate = columns.get("ставка")
    norm = next((i for title, i in columns.items() if title.startswith("норма часов")), None)
    people = set()
    for row in rows:
        name = _person(row, parsed)
        if not name or name in people:
            continue
        people.add(name)
        team = parsed.team(channel, name)
        if value := _number(_cell(row, rate)):
            team.rate = value
        if norm is not None and (value := _number(_cell(row, norm))) is not None:
            team.norm = (team.norm or 0.0) + value
        for column, day in days.items():
            cell = _cell(row, column)
            if _away(cell):
                continue
            team.present.add(day)
            if (value := _number(cell)) is not None:
                team.days["hours"][day] = team.days["hours"].get(day, 0.0) + value
    return people


def _read_fines(book, parsed: ParsedReports, channel: str) -> None:
    """«Штрафы»: tenge per day, then the summary by reason (lateness = minutes × 50)."""
    if FINES not in book.sheetnames:
        return
    rows = list(book[FINES].iter_rows(values_only=True))
    if not rows:
        return
    days = _day_columns(rows[0], parsed.year, parsed.month)
    end = len(rows)
    for index, row in enumerate(rows[1:], start=1):
        first = str(_cell(row, 0) or "").strip()
        if first.casefold() == "итого" or first.startswith("Легенда"):
            end = index
            break
        name = _person(row, parsed)
        if not name:
            continue
        team = parsed.team(channel, name)
        team.fines = True
        for column, day in days.items():
            value = _number(_cell(row, column))
            if value:
                team.days["fines"][day] = team.days["fines"].get(day, 0.0) + value
    header = next(
        (i for i in range(end, len(rows)) if str(_cell(rows[i], 0) or "").strip() == "ФИО"),
        None,
    )
    if header is None:
        return
    columns = _columns(rows[header])
    late = columns.get("опоздание, кол-во")
    others = [
        i for title, i in columns.items()
        if title.endswith(", кол-во") and not title.startswith("опоздание")
    ]
    for row in rows[header + 1:]:
        name = _person(row, parsed)
        if not name:
            if str(_cell(row, 0) or "").strip():
                break
            continue
        team = parsed.team(channel, name)
        team.late = int(_number(_cell(row, late)) or 0) if late is not None else None
        team.other_fines = int(sum(_number(_cell(row, i)) or 0 for i in others))


def _read_team(book, parsed: ParsedReports, channel: str) -> int:
    people = _read_hours(book, parsed, channel)
    sheets = {CALLS: "calls", EFFECTIVE: "effective"} if channel == LINE else {RESPONSE: "response"}
    for title, kind in sheets.items():
        _read_days(book, title, parsed, channel, kind)
    for title in EXTRA:
        _read_days(book, title, parsed, channel, "extra")
    _read_fines(book, parsed, channel)
    return len(people)


def _read_quality(book, parsed: ParsedReports) -> int:
    people = set()
    for sheet in book.worksheets:
        section, days, columns = "", {}, {}
        for row in sheet.iter_rows(values_only=True):
            first = str((row[0] if row else None) or "").strip()
            if first.startswith("Оценки"):
                section = first
                continue
            if first == "ФИО":
                days, columns = _day_columns(row, parsed.year, parsed.month), _columns(row)
                continue
            if not first or not section.startswith("Оценки по датам"):
                continue
            name = normalize_name(first)
            for column, day in days.items():
                for part in str(_cell(row, column) or "").split(","):
                    value = _number(part)
                    if value is not None and part.strip():
                        parsed.quality[name][day].append(value)
                        people.add(name)
            average = _number(_cell(row, columns.get("средний балл")))
            count = _number(_cell(row, columns.get("кол-во")))
            if average is not None and count:
                parsed.quality_month[name] = (average, int(count))
                people.add(name)
            if name in people:
                parsed.labels.setdefault(name, first)
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
            sheets = set(book.sheetnames)
            if HOURS in sheets and {CALLS, EFFECTIVE} <= sheets:
                kind, people = LINE, _read_team(book, parsed, LINE)
            elif HOURS in sheets and (CHATS in sheets or RESPONSE in sheets):
                kind, people = CHAT, _read_team(book, parsed, CHAT)
            else:
                people = _read_quality(book, parsed)
                kind = "quality" if people else "unknown"
        finally:
            book.close()
        parsed.files.append({"filename": filename, "kind": kind, "people": people})
    if not any(item["kind"] != "unknown" for item in parsed.files):
        raise DomainError(
            "Не найдено ни отчёта команды (линия или чаты), ни отчёта проверяющих",
            code="unknown_reports",
        )
    return parsed


class Reading:
    """One operator's month in the reports: the line and chat teams and the reviewers' scores."""

    def __init__(self, parsed: ParsedReports, name: str, channel: str | None):
        self.channel = str(channel or LINE)
        self.teams = {c: parsed.teams[(c, name)] for c in (LINE, CHAT) if (c, name) in parsed.teams}
        self.scores = parsed.quality.get(name, {})
        self.month_quality = parsed.quality_month.get(name)

    def channel_of(self, day: date) -> str:
        """Where the operator worked that day; the site's channel when the reports don't tell."""
        inside = [c for c, team in self.teams.items() if day in team.present]
        return inside[0] if len(inside) == 1 else self.channel

    def values(self, days: list[date], *, week: bool) -> dict[str, float]:
        values: dict[str, float] = {}
        for channel, team in self.teams.items():
            values.update(self._team(channel, team, days, week=week))
        for channel in (LINE, CHAT):
            marks = [
                score for d in days if self.channel_of(d) == channel
                for score in self.scores.get(d, [])
            ]
            team = self.teams.get(channel)
            if marks:
                values[CODES[channel]["quality"]] = round(sum(marks) / len(marks), 1)
            elif week and self.month_quality and team and sum(map(team.hours, days)) > 0:
                # The QA report has scores without a date: a week without dated ones gets the
                # month's average, as long as the operator worked that week.
                values[CODES[channel]["quality"]] = round(self.month_quality[0], 1)
        late = self._lateness(days, week=week)
        if late is not None:
            values["lateness"] = late
        return values

    def _team(self, channel: str, team: Team, days: list[date], *, week: bool) -> dict:
        values = {}
        codes = CODES[channel]
        hours = sum(map(team.hours, days))
        if hours > 0:
            norm = team.week_norm(days) if week else DAY_HOURS * (team.rate or 1)
            if norm > 0:
                values[codes["norm"]] = round(hours / norm * 100, 1)
                if week:
                    values[codes["overtime"]] = round(max(0.0, hours - norm), 2)
        if channel == LINE:
            # The line's efficiency and calls per hour are over the hours on the line only.
            base = sum(map(team.base, days))
            if base > 0:
                effective = sum(team.days["effective"].get(d, 0.0) for d in days)
                calls = sum(team.days["calls"].get(d, 0.0) for d in days)
                values["efficiency"] = round(min(100.0, effective / base * 100), 1)
                values["calls_per_hour"] = round(calls / base, 2)
        else:
            # As the report: the plain average of the days' averages.
            times = [team.days["response"][d] for d in days if d in team.days["response"]]
            if times:
                values["chat_response_time"] = round(sum(times) / len(times), 1)
        return values

    def _lateness(self, days: list[date], *, week: bool) -> int | None:
        counted = [
            team for team in self.teams.values()
            if team.lateness_known
            and (
                team.present & set(days) if week
                else any(team.hours(d) > 0 or team.lateness(d) for d in days)
            )
        ]
        if not counted:
            return None
        return sum(team.lateness(d) for team in counted for d in days if d in team.present)


async def _operators(session: AsyncSession, actor: User) -> dict[str, User]:
    scope = await managed_operators_filter(session, actor)
    users = await session.scalars(select(User).where(scope, User.is_active.is_(True)))
    return {normalize_name(user.full_name): user for user in users}


def _notes(readings: dict[str, Reading], names: dict[str, str]) -> list[dict]:
    """What the person uploading should know: data the reports could not place."""
    groups: dict[str, list[str]] = defaultdict(list)
    for name, reading in readings.items():
        label = names[name]
        teams = set(reading.teams)
        if teams and reading.channel not in teams:
            groups["channel"].append(label)
        quality = reading.month_quality
        dated = sum(len(scores) for scores in reading.scores.values())
        if quality and quality[1] > dated:
            groups["undated" if teams else "undated_lost"].append(label)
        for team in reading.teams.values():
            if team.fines and team.late and team.other_fines:
                groups["lateness_unknown"].append(label)
            elif team.lateness_known and team.late and team.late > sum(
                map(team.lateness, team.present)
            ):
                groups["lateness_merged"].append(label)
    titles = {
        "channel": "В отчётах другое направление, чем на сайте: баллы считаются по направлению "
        "из карточки сотрудника",
        "undated": "Есть оценки без даты: в недели без оценок по датам записан средний балл за "
        "месяц",
        "undated_lost": "Есть оценки без даты, но нет отчёта команды: эти оценки не попали в "
        "недели",
        "lateness_unknown": "В штрафах есть и другие причины: опоздания по дням не определить, "
        "они не записаны",
        "lateness_merged": "Несколько опозданий в один день: засчитано по одному за день",
    }
    return [
        {"code": code, "title": titles[code], "names": sorted(set(groups[code]))}
        for code in titles
        if groups.get(code)
    ]


async def build_plan(session: AsyncSession, actor: User, parsed: ParsedReports) -> dict:
    operators = await _operators(session, actor)
    found = sorted(name for name in parsed.names if name in operators)
    readings = {name: Reading(parsed, name, operators[name].channel) for name in found}
    weeks = []
    for days in month_weeks(parsed.year, parsed.month):
        rows = {operators[name].id: readings[name].values(days, week=True) for name in found}
        weeks.append({"days": days, "values": {k: v for k, v in rows.items() if v}})
    daily = {}
    for day in month_days(parsed.year, parsed.month):
        for name in found:
            for code, value in readings[name].values([day], week=False).items():
                daily[(operators[name].id, day, code)] = value
    unmatched = sorted(
        parsed.labels.get(name, name)
        for name in parsed.names
        if name not in operators and AWAY not in name
    )
    names = {name: operators[name].full_name for name in found}
    return {
        "found": found,
        "unmatched": unmatched,
        "without_data": sorted(set(operators) - set(found)),
        "names": names,
        "weeks": weeks,
        "daily": daily,
        "notes": _notes(readings, names),
    }


async def ensure_metrics(session: AsyncSession, parsed: ParsedReports | None = None) -> None:
    """Hours are judged against the report's norm, so the catalogue needs hours_norm; a chat
    report also brings the chats' hours, overtime and response time (no points until set)."""
    metric = await session.scalar(
        select(MetricDefinition).where(MetricDefinition.code == HOURS_NORM["code"])
    )
    if metric is None:
        session.add(MetricDefinition(**HOURS_NORM, is_active=True))
    elif not metric.is_active:
        metric.is_active = True
    if parsed is not None and any(item["kind"] == CHAT for item in parsed.files):
        existing = set(
            await session.scalars(
                select(MetricDefinition.code).where(
                    MetricDefinition.code.in_([item["code"] for item in CHAT_METRICS])
                )
            )
        )
        for item in CHAT_METRICS:
            if item["code"] not in existing:
                session.add(MetricDefinition(**item, is_active=True))
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
