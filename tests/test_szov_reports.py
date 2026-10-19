import io

from openpyxl import Workbook
from sqlalchemy import select

from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    OperatorDayMetric,
    OperatorWeekMetric,
)
from app.models.user import User
from tests.conftest import auth, login

AUGUST = [f"{day:02d}.08" for day in range(1, 32)]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def team_report(name: str, rate: float = 1) -> bytes:
    """The older team report: no norm column, so a week is judged against 40 h × rate."""
    book = Workbook()
    book.remove(book.active)
    for title, value in (("Отработанные часы", 8), ("Звонки", 40), ("Эффективность", 6)):
        sheet = book.create_sheet(title)
        sheet.append(["Оператор", "Ставка", *AUGUST])
        # Weekends are empty: 5 working days × 8 h = 40 h a week.
        days = [value if (day + 4) % 7 < 5 else None for day in range(1, 32)]
        sheet.append([name, rate, *days])
        sheet.append(["Другой Человек др.", 1, *days])
        sheet.append(["Итого", None, *days])
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def quality_report(name: str) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = "Проверяющий"
    sheet.append(["Оценки по датам · СЗоВ"])
    sheet.append(["ФИО", *AUGUST])
    sheet.append([name, None, None, "90, 100", "80"])
    sheet.append(["Неизвестный Оператор", None, None, "70"])
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def upload(files: dict[str, bytes]):
    return [("files", (name, content, XLSX)) for name, content in files.items()]


async def test_reports_preview_then_save_days_and_weeks(client, session, operator, head):
    headers = auth(await login(client, head.login))
    files = {
        "report_2026-08_3.xlsx": team_report(operator.full_name, rate=0.5),
        "monthly_report_dates_2026-08.xlsx": quality_report(operator.full_name),
    }
    preview = await client.post(
        "/api/v1/admin/day-metrics/reports/preview", files=upload(files), headers=headers
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["month"] == "2026-08"
    assert [f["kind"] for f in body["files"]] == ["line", "quality"]
    assert body["matched_names"] == [operator.full_name]
    assert body["unmatched"] == ["Неизвестный Оператор"]
    assert [w["starts_on"] for w in body["weeks"]] == [
        "2026-08-03",
        "2026-08-10",
        "2026-08-17",
        "2026-08-24",
    ]
    assert (await session.scalar(select(OperatorDayMetric.id))) is None

    saved = await client.post(
        "/api/v1/admin/day-metrics/reports", files=upload(files), headers=headers
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["detail"].startswith("Сохранено")
    days = {
        (row.day.isoformat(), row.metric_code): row.value
        for row in await session.scalars(
            select(OperatorDayMetric).where(OperatorDayMetric.user_id == operator.id)
        )
    }
    # Half rate: 8 h against a 4 h day norm.
    assert days[("2026-08-03", "hours_norm")] == 200
    assert days[("2026-08-03", "quality")] == 95
    assert days[("2026-08-03", "calls_per_hour")] == 5
    assert days[("2026-08-03", "efficiency")] == 75
    week = await session.scalar(select(ContestWeek).where(ContestWeek.iso_week == 32))
    weekly = {
        row.metric_code: row.value
        for row in await session.scalars(
            select(OperatorWeekMetric).where(OperatorWeekMetric.week_id == week.id)
        )
    }
    assert weekly["hours_norm"] == 200 and weekly["quality"] == 90
    await session.refresh(week)
    assert week.status == "calculated"

    again = await client.post(
        "/api/v1/admin/day-metrics/reports", files=upload(files), headers=headers
    )
    assert again.status_code == 200
    count = len(list(await session.scalars(select(OperatorDayMetric))))
    assert count == len(days)


async def test_reports_need_a_month_and_a_known_file(client, operator, supervisor):
    headers = auth(await login(client, supervisor.login))
    nameless = {"team.xlsx": team_report(operator.full_name)}
    missing = await client.post(
        "/api/v1/admin/day-metrics/reports/preview", files=upload(nameless), headers=headers
    )
    assert missing.status_code >= 400
    assert "месяц" in missing.json()["detail"]
    chosen = await client.post(
        "/api/v1/admin/day-metrics/reports/preview",
        files=upload(nameless),
        data={"month": "2026-08"},
        headers=headers,
    )
    assert chosen.status_code == 200 and chosen.json()["matched"] == 1

    blank = io.BytesIO()
    Workbook().save(blank)
    unknown = await client.post(
        "/api/v1/admin/day-metrics/reports/preview",
        files=upload({"other_2026-08.xlsx": blank.getvalue()}),
        headers=headers,
    )
    assert unknown.status_code >= 400

    # A supervisor saves values; the head recalculates the week later.
    saved = await client.post(
        "/api/v1/admin/day-metrics/reports",
        files=upload({"report_2026-08_1.xlsx": team_report(operator.full_name)}),
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert {w["status"] for w in saved.json()["weeks"]} == {"open"}


async def test_operator_cannot_upload_reports(client, operator):
    headers = auth(await login(client, operator.login))
    files = {"report_2026-08_3.xlsx": team_report(operator.full_name)}
    response = await client.post(
        "/api/v1/admin/day-metrics/reports/preview", files=upload(files), headers=headers
    )
    assert response.status_code == 403


SEPTEMBER = [f"{day:02d}.09" for day in range(1, 31)]


def weekday(day: int) -> bool:
    # 1 September 2026 is a Tuesday.
    return (day + 0) % 7 not in (5, 6)


def book_of(sheets: dict[str, list[list]]) -> bytes:
    book = Workbook()
    book.remove(book.active)
    for title, rows in sheets.items():
        sheet = book.create_sheet(title)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def team_sheet(name: str, rate: float, norm: float, per_day, *, total: str = "Итого"):
    head = ["Оператор", "Ставка", "Норма часов (ч)", *SEPTEMBER, total]
    return [head, [name, rate, norm, *[per_day(day) for day in range(1, 31)]]]


def extra_sheet(name: str, per_day):
    return [["Оператор", *SEPTEMBER, "Всего (ч)"], [name, *[per_day(day) for day in range(1, 31)]]]


def fines_sheet(name: str, rate: float, fines: dict[int, str], late: int, no_show: int = 0):
    return [
        ["ФИО", "Ставка", *SEPTEMBER, "Итого"],
        [name, rate, *[fines.get(day) for day in range(1, 31)]],
        ["Итого"],
        [],
        ["Легенда причин"],
        ["Причина", "Расчет"],
        ["Опоздание", "минуты x 50"],
        [],
        ["Сводка по операторам"],
        ["ФИО", "Ставка", "Опоздание, кол-во", "Опоздание, минуты", "Опоздание, сумма",
         "Корп такси, кол-во", "Корп такси, сумма", "Не выход, кол-во", "Не выход, сумма",
         "Всего штрафов", "Итого"],
        [name, rate, late, late * 10, late * 500, 0, 0, no_show, no_show * 10000],
        ["Итого"],
    ]


async def test_line_chat_and_reviewers_reports_as_exported(client, session, operator, head):
    """September 2026 as the call-centre system exports it: a line team, a chat team with «др.»
    days, reviewers' scores with and without a date, trainings and fines."""
    chat = User(login="chat1", full_name="Чатов Оператор", role="operator", channel="chat",
                hashed_password="x")
    session.add(chat)
    await session.commit()
    line_name, chat_name = operator.full_name, chat.full_name

    def line_hours(day):  # 8 h every weekday, 2 of them a training on Monday 7 September
        return 8 if weekday(day) else 0

    line = book_of({
        "Отработанные часы": team_sheet(line_name, 1, 168, line_hours, total="Итого часов"),
        "Перерыв": team_sheet(line_name, 1, 168, lambda day: 0.5),
        "Звонки": team_sheet(line_name, 1, 168, lambda day: 10 if weekday(day) else 0),
        "Эффективность": team_sheet(line_name, 1, 168, lambda day: 6 if weekday(day) else 0),
        "Тренинги": extra_sheet(line_name, lambda day: 2 if day == 7 else None),
        "Тех. сбои": extra_sheet(line_name, lambda day: None),
        "Штрафы": fines_sheet(line_name, 1, {8: "500", 9: "250"}, late=2),
    })

    def chat_hours(day):  # in another team until 6 September, then 4 h every weekday
        return "др." if day < 7 else 4 if weekday(day) else 0

    chats = book_of({
        "Отработанные часы": team_sheet(chat_name, 0.5, 84, chat_hours, total="Итого часов"),
        "Чаты": team_sheet(chat_name, 0.5, 84, lambda day: "др." if day < 7 else 50),
        "Средняя оценка": team_sheet(chat_name, 0.5, 84, lambda day: 4.9),
        "Среднее время ответа": team_sheet(
            chat_name, 0.5, 84,
            lambda day: "др." if day < 7 else (100 if day % 7 in (0, 1, 2) else 130)
            if weekday(day) else None,
        ),
        "Офлайн активность": extra_sheet(chat_name, lambda day: "др." if day < 7 else None),
        "Штрафы": fines_sheet(chat_name, 0.5, {8: "10 000", 9: "650"}, late=1, no_show=1),
    })
    quality = book_of({
        "Проверяющий": [
            ["Оценки по датам · СЗоВ — Служба заботы о водителях"],
            ["ФИО", *SEPTEMBER, "Средний балл", "Кол-во", "План"],
            [line_name, *[{8: "90, 100", 15: "80"}.get(day) for day in range(1, 31)], 88, 4, 4],
            [chat_name, *[None] * 30, 92, 3, 3],
            ["Неизвестный Оператор", *[None] * 30, 70, 1, 1],
            [],
            ["Оценки проверяющего 169 · СЗоВ"],
            ["ФИО", *SEPTEMBER, "Средний балл", "Кол-во", "План"],
            [line_name, *[None] * 30, 0, 0, 4],
        ],
    })
    files = {
        "report_2026-09_1.xlsx": line,
        "report_2026-09.xlsx": chats,
        "monthly_report_dates_2026-09.xlsx": quality,
    }
    headers = auth(await login(client, head.login))
    preview = await client.post(
        "/api/v1/admin/day-metrics/reports/preview", files=upload(files), headers=headers
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert [f["kind"] for f in body["files"]] == ["line", "chat", "quality"]
    assert body["matched"] == 2 and body["unmatched"] == ["Неизвестный Оператор"]
    notes = {note["code"]: note["names"] for note in body["notes"]}
    assert notes["undated"] == sorted([line_name, chat_name])
    assert notes["lateness_unknown"] == [chat_name]

    saved = await client.post(
        "/api/v1/admin/day-metrics/reports", files=upload(files), headers=headers
    )
    assert saved.status_code == 200, saved.text
    weeks = {
        week.iso_week: week.id
        for week in await session.scalars(select(ContestWeek).where(ContestWeek.iso_year == 2026))
    }
    assert sorted(weeks) == [37, 38, 39]
    weekly = {
        (row.week_id, row.user_id, row.metric_code): row.value
        for row in await session.scalars(select(OperatorWeekMetric))
    }

    def week(number, user, code):
        return weekly.get((weeks[number], user.id, code))

    # The line: 40 h (2 of them a training) against 168 h × 7 / 30 days = 39.2 h.
    assert week(37, operator, "hours_norm") == 102.0 and week(37, operator, "overtime") == 0.8
    # Calls and efficiency are over the 38 h on the line, without the training.
    assert week(37, operator, "calls_per_hour") == 1.32
    assert week(37, operator, "efficiency") == 78.9
    assert week(37, operator, "quality") == 95 and week(38, operator, "quality") == 80
    # No dated score in the last week: the month's average, the operator worked.
    assert week(39, operator, "quality") == 88
    assert week(37, operator, "lateness") == 2 and week(38, operator, "lateness") == 0
    # Chats: «др.» until 6 September, so 84 h is shared by the 24 days from the 7th.
    assert week(37, chat, "chat_hours_norm") == 81.6 and week(37, chat, "chat_overtime") == 0
    assert week(37, chat, "chat_response_time") == 112
    assert week(37, chat, "chat_quality") == 92 and week(37, chat, "quality") is None
    # A no-show among the fines: lateness by day is unknown and not written.
    assert week(37, chat, "lateness") is None
    assert week(37, chat, "hours_norm") is None and week(37, chat, "calls_per_hour") is None

    days = {
        (row.user_id, row.day.isoformat(), row.metric_code): row.value
        for row in await session.scalars(select(OperatorDayMetric))
    }
    assert days[(operator.id, "2026-09-08", "quality")] == 95
    assert days[(operator.id, "2026-09-08", "lateness")] == 1
    assert days[(operator.id, "2026-09-10", "lateness")] == 0
    assert days[(operator.id, "2026-09-07", "hours_norm")] == 100
    assert days[(chat.id, "2026-09-07", "chat_hours_norm")] == 100
    assert (chat.id, "2026-09-03", "chat_hours_norm") not in days
    codes = set(
        await session.scalars(
            select(MetricDefinition.code).where(MetricDefinition.channel == "chat")
        )
    )
    assert {"chat_hours_norm", "chat_overtime", "chat_response_time"} <= codes
