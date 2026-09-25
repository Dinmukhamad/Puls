from datetime import date

from sqlalchemy import select

from app.models.contest import MetricDefinition, OperatorWeekMetric, OperatorWeekResult
from app.models.enums import WeekStatus
from app.services import weekly
from tests.conftest import auth, login


async def test_dashboard_exposes_all_metric_histories_without_filling_gaps(
    client, session, operator, head
):
    previous = await weekly.get_or_create_week(session, date(2026, 9, 14))
    current = await weekly.get_or_create_week(session, date(2026, 9, 21))
    quality = await session.scalar(
        select(MetricDefinition).where(MetricDefinition.code == "quality")
    )
    quality.description = "Оценка проверенных звонков"
    session.add_all(
        [
            OperatorWeekMetric(
                week_id=previous.id, user_id=operator.id, metric_code="quality", value=90
            ),
            OperatorWeekMetric(
                week_id=current.id, user_id=operator.id, metric_code="quality", value=70
            ),
            OperatorWeekMetric(
                week_id=current.id, user_id=operator.id, metric_code="lateness", value=0
            ),
            OperatorWeekResult(week_id=current.id, user_id=operator.id, final_points=999, rank=1),
        ]
    )
    await session.commit()
    headers = auth(await login(client, head.login))
    response = await client.get(f"/api/v1/analytics/summary?week_id={current.id}", headers=headers)
    assert response.status_code == 200, response.text
    report = response.json()
    person = report["operators"][0]
    assert person["trends"]["quality"] == [None] * 6 + [90, 70]
    assert person["previous_values"]["quality"] == 90
    assert person["previous_values"]["lateness"] is None
    assert person["trends"]["lateness"] == [None] * 7 + [0]
    assert person["points"] is None  # Invalidated results must not appear as current scores.
    quality_out = next(m for m in report["metrics"] if m["code"] == "quality")
    assert quality_out["description"] == quality.description
    assert quality_out["trend"] == [None] * 6 + [90, 70]
    late = next(m for m in report["metrics"] if m["code"] == "lateness")
    assert late["penalty_per_unit"] == 5
    assert report["lateness_metric_code"] == "lateness"
    current.status = WeekStatus.CALCULATED
    await session.commit()
    calculated = (
        await client.get(f"/api/v1/analytics/summary?week_id={current.id}", headers=headers)
    ).json()
    assert calculated["operators"][0]["points"] == 999


async def test_monthly_dashboard_explains_average_and_preserves_missing_history(
    client, session, operator, head
):
    for day, value in [(date(2026, 9, 7), 2), (date(2026, 9, 14), 4)]:
        week = await weekly.get_or_create_week(session, day)
        session.add(
            OperatorWeekMetric(
                week_id=week.id, user_id=operator.id, metric_code="lateness", value=value
            )
        )
    await session.commit()
    response = await client.get(
        "/api/v1/analytics/summary?grain=month&date_from=2026-08-01&date_to=2026-09-01",
        headers=auth(await login(client, head.login)),
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["operators"][0]["trends"]["lateness"] == [None, 3]
    assert "не число событий за весь месяц" in report["methodology"]
