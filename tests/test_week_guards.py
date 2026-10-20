"""A week is published once it is over, and only with values from the work (docs/CHANNELS.md)."""

from datetime import timedelta

from app.models.contest import OperatorWeekMetric
from app.models.enums import WeekStatus
from app.services import weekly as weekly_service
from app.services.economy import local_today
from tests.conftest import auth, login


async def test_a_week_in_progress_cannot_be_published(client, session, operator, head):
    week = await weekly_service.get_or_create_week(session, local_today())
    session.add(OperatorWeekMetric(week_id=week.id, user_id=operator.id, metric_code="quality",
                                   value=95, source="report"))
    await session.commit()
    response = await client.post(f"/api/v1/admin/weeks/{week.id}/close",
                                 headers=auth(await login(client, head.login)))
    assert response.status_code == 400 and response.json()["code"] == "week_not_over"
    await session.refresh(week)
    assert week.status != WeekStatus.CLOSED


async def test_the_previous_week_waits_for_the_reports(client, session, operator, supervisor, head):
    previous = await weekly_service.get_or_create_week(session, local_today() - timedelta(days=3))
    previous_id, starts_on, operator_id = previous.id, previous.starts_on, operator.id
    await session.commit()
    headers = auth(await login(client, head.login))
    # Nothing but a supervisor's record of foreign sites: not closed, the reports have not come.
    recorded = await client.post("/api/v1/admin/violations", json={
        "user_id": operator_id, "count": 1, "comment": "Соцсеть в смену",
        "noticed_on": starts_on.isoformat(),
    }, headers=auth(await login(client, supervisor.login)))
    assert recorded.status_code == 201, recorded.text
    skipped = (await client.post("/api/v1/admin/weeks/close-previous", headers=headers)).json()
    assert skipped["skipped"] is True and skipped["week_id"] == previous_id
    session.expire_all()
    assert (await weekly_service.get_week(session, previous_id)).status != WeekStatus.CLOSED
    # The week's values from the reports: now it closes.
    session.add(OperatorWeekMetric(week_id=previous_id, user_id=operator_id,
                                   metric_code="quality", value=95, source="report"))
    await session.commit()
    closed = (await client.post("/api/v1/admin/weeks/close-previous", headers=headers)).json()
    assert closed["skipped"] is False and closed["participants"] == 1
