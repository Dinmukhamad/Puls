import io

from openpyxl import Workbook
from sqlalchemy import select

from app.models.contest import ContestWeek, OperatorDayMetric, OperatorWeekMetric
from tests.conftest import auth, login

AUGUST = [f"{day:02d}.08" for day in range(1, 32)]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def team_report(name: str, rate: float = 1) -> bytes:
    book = Workbook()
    book.remove(book.active)
    for title, value in (("Отработанные часы", 8), ("Звонки", 40), ("Эффективность", 6)):
        sheet = book.create_sheet(title)
        sheet.append(["Оператор", "Ставка", "Норма часов (ч)", *AUGUST])
        # Weekends are empty: 5 working days × 8 h = 40 h a week.
        days = [value if (day + 4) % 7 < 5 else None for day in range(1, 32)]
        sheet.append([name, rate, 176, *days])
        sheet.append(["Другой Человек др.", 1, 176, *days])
        sheet.append(["Итого", None, None, *days])
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
    assert [f["kind"] for f in body["files"]] == ["team", "quality"]
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
