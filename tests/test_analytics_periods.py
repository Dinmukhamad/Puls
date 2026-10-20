from datetime import date

from sqlalchemy import update

from app.models.contest import MetricDefinition, OperatorWeekMetric
from app.services import weekly
from tests.conftest import auth, login, make_user


async def _summed_metrics_on(session) -> None:
    """Hours and counts that add up over a week: switched off in the catalogue, on for these."""
    await session.execute(
        update(MetricDefinition)
        .where(MetricDefinition.code.in_(("hours_worked", "driver_gratitudes")))
        .values(is_active=True)
    )
    await session.commit()


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
    await _summed_metrics_on(session)
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
    assert (targets["quality"], targets["calls_per_hour"], targets["lateness"]) == (100, 12, 0)
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


async def test_a_chosen_range_averages_every_day_and_compares_with_the_days_before(
    client, session, operator, supervisor
):
    headers = auth(await login(client, supervisor.login))
    values = [
        {"user_id": operator.id, "day": day, "metric_code": "quality", "value": value}
        for day, value in (("2026-08-01", 60), ("2026-08-03", 90), ("2026-08-04", 70))
    ]
    uploaded = await client.post(
        "/api/v1/admin/day-metrics", json={"values": values}, headers=headers
    )
    assert uploaded.status_code == 200, uploaded.text

    path = (
        "/api/v1/analytics/summary?grain=range"
        "&date_from=2026-08-03&date_to=2026-08-04&metric_code=quality"
    )
    report = (await client.get(path, headers=headers)).json()
    assert (report["custom_range"], report["grain"]) == (True, "day")
    assert (report["period_from"], report["period_to"], report["period_label"]) == (
        "2026-08-03",
        "2026-08-04",
        "03.08.2026–04.08.2026",
    )
    # The cards cover both days; the comparison is the two days before them.
    quality = next(m for m in report["metrics"] if m["code"] == "quality")
    assert (quality["value"], quality["previous"], quality["delta"], quality["improved"]) == (
        80,
        60,
        20,
        True,
    )
    row = report["operators"][0]
    assert (row["value"], row["previous"], row["values"]["quality"]) == (80, 60, 80)
    assert row["previous_values"]["quality"] == 60
    assert report["operators_with_data"] == 1
    # A short range is drawn after the days right before it.
    assert report["context_points"] == 5
    assert [p["label"] for p in report["trend"]] == [
        "29.07",
        "30.07",
        "31.07",
        "01.08",
        "02.08",
        "03.08",
        "04.08",
    ]
    assert [p["value"] for p in report["trend"]] == [None, None, None, 60, None, 90, 70]
    assert "всего выбранного периода" in report["methodology"]


async def test_a_range_without_daily_values_is_read_by_its_contest_weeks(
    client, session, operator, supervisor
):
    for day, value in ((date(2026, 8, 3), 80), (date(2026, 8, 10), 88)):
        week = await weekly.get_or_create_week(session, day)
        session.add(
            OperatorWeekMetric(
                week_id=week.id, user_id=operator.id, metric_code="quality", value=value
            )
        )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    path = (
        "/api/v1/analytics/summary?grain=range"
        "&date_from=2026-08-10&date_to=2026-08-16&metric_code=quality"
    )
    report = (await client.get(path, headers=headers)).json()
    assert (report["custom_range"], report["grain"]) == (True, "week")
    assert report["week"]["label"] == "2026-W33"
    quality = next(m for m in report["metrics"] if m["code"] == "quality")
    assert (quality["value"], quality["previous"], quality["target"]) == (88, 80, 100)
    assert len(report["trend"]) == 8 and report["context_points"] == 7
    assert [p["value"] for p in report["trend"]][-2:] == [80, 88]
    assert report["period_label"] == "10.08.2026–16.08.2026"

    # Without dates the range is the latest contest week.
    default = (await client.get("/api/v1/analytics/summary?grain=range", headers=headers)).json()
    assert (default["period_from"], default["period_to"]) == ("2026-08-10", "2026-08-16")


async def test_whole_contest_weeks_keep_weekly_values_when_days_are_also_loaded(
    client, session, operator, supervisor
):
    await _summed_metrics_on(session)
    for day, hours in ((date(2026, 8, 3), 36), (date(2026, 8, 10), 40)):
        week = await weekly.get_or_create_week(session, day)
        session.add(
            OperatorWeekMetric(
                week_id=week.id, user_id=operator.id, metric_code="hours_worked", value=hours
            )
        )
    await session.commit()
    headers = auth(await login(client, supervisor.login))
    values = [
        {"user_id": operator.id, "day": f"2026-08-{d}", "metric_code": "hours_worked", "value": 8}
        for d in range(10, 15)
    ]
    assert (
        await client.post("/api/v1/admin/day-metrics", json={"values": values}, headers=headers)
    ).status_code == 200

    # Monday to Sunday: the weekly total is judged against the weekly target.
    path = (
        "/api/v1/analytics/summary?grain=range"
        "&date_from=2026-08-10&date_to=2026-08-16&metric_code=hours_worked"
    )
    report = (await client.get(path, headers=headers)).json()
    assert report["grain"] == "week"
    hours = next(m for m in report["metrics"] if m["code"] == "hours_worked")
    assert (hours["value"], hours["previous"], hours["target"]) == (40, 36, 40)
    assert report["operators"][0]["target_met"] is True

    # Dates inside the week are read by their days against a day's share of the target.
    path = (
        "/api/v1/analytics/summary?grain=range"
        "&date_from=2026-08-11&date_to=2026-08-14&metric_code=hours_worked"
    )
    report = (await client.get(path, headers=headers)).json()
    assert report["grain"] == "day"
    hours = next(m for m in report["metrics"] if m["code"] == "hours_worked")
    assert (hours["value"], hours["target"]) == (8, 8)


async def test_a_long_range_is_averaged_by_month(client, session, operator, supervisor):
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
        "/api/v1/analytics/summary?grain=range"
        "&date_from=2026-02-01&date_to=2026-08-31&metric_code=quality"
    )
    report = (await client.get(path, headers=headers)).json()
    assert report["grain"] == "month"
    assert report["trend"][0]["label"] == "фев 2026"
    assert [p["value"] for p in report["trend"]][-2:] == [70, 95]
    quality = next(m for m in report["metrics"] if m["code"] == "quality")
    assert (quality["value"], quality["previous"]) == (82.5, None)


async def test_a_chosen_range_needs_both_valid_dates(client, session, operator, supervisor):
    headers = auth(await login(client, supervisor.login))
    for query in (
        "date_from=2026-08-01",
        "date_to=2026-08-01",
        "date_from=2026-08-05&date_to=2026-08-01",
        "date_from=2024-01-01&date_to=2026-08-31",
        "date_from=0001-01-01&date_to=0001-01-02",
    ):
        response = await client.get(
            f"/api/v1/analytics/summary?grain=range&{query}", headers=headers
        )
        assert response.status_code == 400, (query, response.text)
