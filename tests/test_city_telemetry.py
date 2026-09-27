from datetime import timedelta

from sqlalchemy import select

from app.db.base import utcnow
from app.models.telemetry import CityPerfReport
from app.services import telemetry
from tests.conftest import auth, login

REPORT = {
    "backend": "webgpu", "gpu": "Apple M1", "width": 1440, "height": 900, "dpr": 2,
    "tier": "high", "fps_avg": 58.4, "fps_p1": 41.2, "first_frame_ms": 1800,
    "concessions": ["ao"],
}
URL = "/api/v1/telemetry/city"


async def test_report_is_stored_for_the_user(client, session, operator):
    headers = auth(await login(client, operator.login))
    response = await client.post("/api/v1/telemetry/city", json=REPORT, headers=headers)
    assert response.status_code == 204, response.text
    row = await session.scalar(select(CityPerfReport))
    assert (row.user_id, row.backend, row.concessions) == (operator.id, "webgpu", ["ao"])


async def test_report_is_validated_and_bounded(client, operator):
    headers = auth(await login(client, operator.login))
    bad = await client.post("/api/v1/telemetry/city", json={**REPORT, "width": 0}, headers=headers)
    assert bad.status_code == 422
    many = {**REPORT, "concessions": ["x"] * 13}
    assert (await client.post(URL, json=many, headers=headers)).status_code == 422
    padded = {**REPORT, "gpu": "g" * 128, "concessions": ["c" * 32] * 12, "pad": "p" * 2000}
    huge = await client.post(URL, json=padded, headers=headers)
    assert huge.status_code == 413
    anonymous = await client.post("/api/v1/telemetry/city", json=REPORT)
    assert anonymous.status_code == 401


async def test_old_reports_are_purged(session, operator):
    fields = dict(REPORT)
    session.add_all([
        CityPerfReport(user_id=operator.id, created_at=utcnow() - timedelta(days=91), **fields),
        CityPerfReport(user_id=operator.id, created_at=utcnow() - timedelta(days=10), **fields),
    ])
    await session.commit()
    assert await telemetry.purge_old_reports(session) == 1
    assert len(list(await session.scalars(select(CityPerfReport)))) == 1
