from datetime import date

from app.models.contest import OperatorWeekMetric
from app.services import weekly
from tests.conftest import auth, login, make_user


async def test_daily_values_upload_and_show_day_by_day(client, session, operator, supervisor):
    headers = auth(await login(client, supervisor.login))
    values = [
        {"user_id": operator.id, "day": "2026-08-03", "metric_code": "quality", "value": 90},
        {"user_id": operator.id, "day": "2026-08-04", "metric_code": "quality", "value": 70},
        {"user_id": operator.id, "day": "2026-08-04", "metric_code": "efficiency", "value": 55},
    ]
    uploaded = await client.post(
        "/api/v1/admin/day-metrics", json={"values": values}, headers=headers
    )
    assert uploaded.status_code == 200, uploaded.text
    # A repeated upload updates the same days instead of adding rows.
    values[0]["value"] = 80
    again = await client.post("/api/v1/admin/day-metrics", json={"values": values}, headers=headers)
    assert "обновлено 3" in again.json()["detail"]

    path = (
        "/api/v1/analytics/summary?grain=day"
        "&date_from=2026-08-02&date_to=2026-08-04&metric_code=quality"
    )
    report = (await client.get(path, headers=headers)).json()
    assert report["grain"] == "day" and report["week"] is None
    assert (report["period_from"], report["period_to"], report["period_label"]) == (
        "2026-08-04",
        "2026-08-04",
        "04.08",
    )
    assert [p["label"] for p in report["trend"]] == ["02.08", "03.08", "04.08"]
    assert [p["value"] for p in report["trend"]] == [None, 80, 70]
    quality = next(m for m in report["metrics"] if m["code"] == "quality")
    assert (quality["value"], quality["previous"], quality["delta"]) == (70, 80, -10)
    assert report["operators"][0]["points"] is None

    too_long = await client.get(
        "/api/v1/analytics/summary?grain=day&date_from=2026-07-01&date_to=2026-08-04",
        headers=headers,
    )
    assert too_long.status_code >= 400
    backwards = await client.get(
        "/api/v1/analytics/summary?grain=day&date_from=2026-08-05&date_to=2026-08-01",
        headers=headers,
    )
    assert backwards.status_code >= 400


async def test_daily_upload_rejects_duplicates_and_foreign_operators(
    client, session, operator, supervisor
):
    outsider = await make_user(session, login="day-outsider")
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    row = {"user_id": operator.id, "day": "2026-08-03", "metric_code": "quality", "value": 90}
    duplicate = await client.post(
        "/api/v1/admin/day-metrics", json={"values": [row, row]}, headers=headers
    )
    assert duplicate.status_code >= 400
    foreign = {**row, "user_id": outsider.id}
    assert (
        await client.post("/api/v1/admin/day-metrics", json={"values": [foreign]}, headers=headers)
    ).status_code == 403
    own = auth(await login(client, operator.login))
    assert (
        await client.post("/api/v1/admin/day-metrics", json={"values": [row]}, headers=own)
    ).status_code == 403


async def test_months_average_weeks_and_fall_back_to_days(client, session, operator, supervisor):
    for day, value in ((date(2026, 7, 6), 60), (date(2026, 7, 13), 80)):
        week = await weekly.get_or_create_week(session, day)
        session.add(
            OperatorWeekMetric(
                week_id=week.id, user_id=operator.id, metric_code="quality", value=value
            )
        )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    values = [
        {"user_id": operator.id, "day": f"2026-08-{d:02d}", "metric_code": "quality", "value": v}
        for d, v in ((3, 90), (4, 100))
    ]
    assert (
        await client.post("/api/v1/admin/day-metrics", json={"values": values}, headers=headers)
    ).status_code == 200

    path = (
        "/api/v1/analytics/summary?grain=month"
        "&date_from=2026-06-01&date_to=2026-08-31&metric_code=quality"
    )
    report = (await client.get(path, headers=headers)).json()
    assert [p["label"] for p in report["trend"]] == ["июн 2026", "июл 2026", "авг 2026"]
    assert [p["value"] for p in report["trend"]] == [None, 70, 95]
    assert (report["period_from"], report["period_to"]) == ("2026-08-01", "2026-08-31")
    quality = next(m for m in report["metrics"] if m["code"] == "quality")
    assert (quality["value"], quality["previous"], quality["improved"]) == (95, 70, True)
    assert (
        await client.get(
            "/api/v1/analytics/summary?grain=month&date_from=2024-01-01&date_to=2026-08-31",
            headers=headers,
        )
    ).status_code >= 400


async def test_week_range_lists_every_week_between_the_dates(client, session, operator, supervisor):
    week = await weekly.get_or_create_week(session, date(2026, 8, 10))
    session.add(
        OperatorWeekMetric(week_id=week.id, user_id=operator.id, metric_code="quality", value=88)
    )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    report = (
        await client.get(
            "/api/v1/analytics/summary?grain=week&date_from=2026-08-05&date_to=2026-08-20",
            headers=headers,
        )
    ).json()
    assert [p["label"] for p in report["trend"]] == ["2026-W32", "2026-W33", "2026-W34"]
    assert [p["value"] for p in report["trend"]] == [None, 88, None]
    assert report["period_label"] == "2026-W34"


async def test_days_are_judged_against_a_days_share_of_weekly_targets(
    client, session, operator, supervisor
):
    second = await make_user(session, login="op2", group_id=operator.group_id)
    headers = auth(await login(client, supervisor.login))
    day = "2026-08-04"
    values = [
        {"user_id": user_id, "day": day, "metric_code": code, "value": value}
        for user_id, hours in ((operator.id, 8), (second.id, 7))
        for code, value in (
            ("hours_worked", hours),
            ("driver_gratitudes", 1),
            ("quality", 100),
            ("lateness", 1),
        )
    ]
    uploaded = await client.post(
        "/api/v1/admin/day-metrics", json={"values": values}, headers=headers
    )
    assert uploaded.status_code == 200, uploaded.text

    path = (
        f"/api/v1/analytics/summary?grain=day&date_from={day}&date_to={day}"
        "&metric_code=hours_worked"
    )
    report = (await client.get(path, headers=headers)).json()
    metrics = {m["code"]: m for m in report["metrics"]}
    targets = {code: metric["target"] for code, metric in metrics.items()}
    # Hours and counts add up over a week, so one working day carries a fifth of the goal.
    assert (targets["hours_worked"], targets["overtime"], targets["driver_gratitudes"]) == (
        8,
        1.6,
        1,
    )
    # Percentages, per-hour rates and violation limits do not depend on the period.
    assert (targets["quality"], targets["calls_per_hour"], targets["lateness"]) == (100, 12, 1)
    assert metrics["hours_worked"]["below_target"] == 1, "only the 7-hour day misses 8 h"
    assert metrics["driver_gratitudes"]["below_target"] == 0
    assert {row["full_name"]: row["target_met"] for row in report["operators"]} == {
        operator.full_name: True,
        second.full_name: False,
    }
    assert "делится на 5" in report["methodology"]

    weekly_report = (
        await client.get("/api/v1/analytics/summary?grain=week", headers=headers)
    ).json()
    targets = {m["code"]: m["target"] for m in weekly_report["metrics"]}
    assert (targets["hours_worked"], targets["driver_gratitudes"]) == (40, 5)
    assert "делится на 5" not in weekly_report["methodology"]
