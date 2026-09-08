import pytest
from sqlalchemy import func, select

from app.models.access import AccessRule
from app.models.coin import CoinTransaction
from app.models.driver import DriverProfile
from app.models.enums import Role
from app.models.learning import LearningAttempt, LearningContent
from app.models.progress import XpEntry
from app.models.settings import AuditLog
from tests.conftest import auth, login, make_user

BASE = "/api/v1/learning/driver"
ADMIN = "/api/v1/admin/learning/driver-parks"


async def act(client, headers, action, **extra):
    return await client.put(f"{BASE}/action", headers=headers, json={"action": action, **extra})


async def test_login_resume_and_repeat_keep_own_educational_profile(client, session, operator):
    headers = auth(await login(client, operator.login))
    response = await client.get(BASE, headers=headers)
    assert response.status_code == 200
    assert response.json()["profile"] is None
    park = response.json()["parks"][1]

    response = await client.post(f"{BASE}/start", headers=headers)
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["stage"] == "services"
    assert profile["last_login_at"] is None
    assert (await act(client, headers, "taxi")).json()["profile"]["stage"] == "cooperation"
    # Закрытие приложения до выбора парка не теряет незавершённый вход.
    assert (await client.get(BASE, headers=headers)).json()["profile"]["stage"] == "cooperation"
    response = await act(client, headers, "park", park_id=park["id"])
    assert response.status_code == 200
    assert response.json()["profile"]["stage"] == "loading"
    assert response.json()["profile"]["park"] == park
    response = await act(client, headers, "enter")
    assert response.status_code == 200
    entered = response.json()["profile"]
    assert entered["stage"] == "offline"
    assert entered["last_login_at"] is not None
    # Повтор эффекта/запроса не создаёт ещё один вход и не изменяет дату.
    assert (await act(client, headers, "enter")).json()["profile"] == entered
    assert (await client.get(BASE, headers=headers)).json()["profile"] == entered
    repeated = (await client.post(f"{BASE}/start", headers=headers)).json()["profile"]
    assert repeated["stage"] == "services"
    assert repeated["park"] == park
    assert repeated["created_at"] == profile["created_at"]
    assert repeated["last_login_at"] == entered["last_login_at"]
    assert await session.scalar(select(func.count()).select_from(DriverProfile)) == 1
    # Вход для ознакомления не создаёт попытки оценивания, деньги и XP.
    for model in (LearningAttempt, CoinTransaction, XpEntry):
        assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_login_rejects_skipped_stages_unknown_parks_and_driving_actions(client, operator):
    headers = auth(await login(client, operator.login))
    assert (await act(client, headers, "enter")).status_code == 404
    await client.post(f"{BASE}/start", headers=headers)
    assert (await act(client, headers, "enter")).status_code == 409
    assert (await act(client, headers, "park", park_id="itaxi")).status_code == 409
    assert (await act(client, headers, "taxi")).status_code == 200
    assert (await act(client, headers, "park", park_id="missing")).status_code == 409
    assert (await act(client, headers, "park")).status_code == 422
    assert (await act(client, headers, "taxi", park_id="itaxi")).status_code == 422
    for action in ("online", "accept", "register", "verify", "finish_trip"):
        assert (await act(client, headers, action)).status_code == 422
    assert (await act(client, headers, "services")).json()["profile"]["stage"] == "services"


async def test_profiles_are_isolated_and_credentials_are_never_accepted(client, session, operator):
    headers = auth(await login(client, operator.login))
    other = await make_user(session, login="other-driver")
    other_headers = auth(await login(client, other.login))
    await client.post(f"{BASE}/start", headers=headers)
    assert (await client.get(BASE, headers=other_headers)).json()["profile"] is None
    assert (await act(client, other_headers, "enter")).status_code == 404
    for extra in (
        {"user_id": other.id},
        {"password": "example"},
        {"phone": "123"},
        {"otp": "1234"},
    ):
        assert (await act(client, headers, "taxi", **extra)).status_code == 422
    assert (await client.get(BASE)).status_code == 401
    assert (await client.post(f"{BASE}/start")).status_code == 401


async def test_entry_keeps_own_last_result_even_after_material_archival(client, session, operator):
    from app.db.base import utcnow

    other = await make_user(session, login="another-driver-result")
    content = LearningContent(kind="simulator", title="Archived scenario", status="archived")
    session.add(content)
    await session.flush()
    own = LearningAttempt(
        user_id=operator.id,
        content_id=content.id,
        state="passed",
        score=100,
        snapshot={"title": "Own completed scenario"},
        finished_at=utcnow(),
    )
    session.add(own)
    await session.flush()
    session.add_all(
        [
            LearningAttempt(
                user_id=other.id,
                content_id=content.id,
                state="passed",
                score=50,
                snapshot={"title": "Private result"},
                finished_at=utcnow(),
            ),
            LearningAttempt(
                user_id=operator.id,
                content_id=content.id,
                state="in_progress",
                snapshot={"title": "Unfinished scenario"},
            ),
        ]
    )
    await session.commit()
    headers = auth(await login(client, operator.login))
    result = (await client.get(BASE, headers=headers)).json()["last_result"]
    assert result == {
        "attempt_id": own.id,
        "title": "Own completed scenario",
        "state": "passed",
        "score": 100,
    }


async def test_parks_are_editable_audited_and_preserve_selected_conditions(
    client, session, operator, head
):
    staff_headers = auth(await login(client, head.login))
    headers = auth(await login(client, operator.login))
    custom = [{"id": "test-park", "name": "Учебный парк", "commission": 3.5}]
    response = await client.put(ADMIN, headers=staff_headers, json={"parks": custom})
    assert response.status_code == 200, response.text
    assert (await client.get(BASE, headers=headers)).json()["parks"] == custom
    await client.post(f"{BASE}/start", headers=headers)
    await act(client, headers, "taxi")
    await act(client, headers, "park", park_id="test-park")
    replacement = [{"id": "another", "name": "Другой учебный парк", "commission": 0}]
    assert (
        await client.put(ADMIN, headers=staff_headers, json={"parks": replacement})
    ).status_code == 200
    response = await act(client, headers, "enter")
    assert response.json()["profile"]["park"] == custom[0]
    assert response.json()["parks"] == replacement
    await act(client, headers, "services")
    await act(client, headers, "taxi")
    assert (await act(client, headers, "park", park_id="test-park")).status_code == 409
    assert (await act(client, headers, "park", park_id="another")).status_code == 200
    audits = list(
        await session.scalars(select(AuditLog).where(AuditLog.action == "driver.parks.save"))
    )
    assert len(audits) == 2
    assert audits[-1].payload["after"] == replacement


@pytest.mark.parametrize(
    "parks",
    [
        [],
        [{"id": "p", "name": " ", "commission": 2}],
        [{"id": "p", "name": "A", "commission": -1}],
        [{"id": "p", "name": "A", "commission": 101}],
        [{"id": "p", "name": "A", "commission": 2}] * 2,
        [{"id": "p", "name": "A", "commission": 2}, {"id": "q", "name": "a", "commission": 3}],
    ],
)
async def test_invalid_park_configuration_is_rejected(client, head, parks):
    headers = auth(await login(client, head.login))
    before = (await client.get(ADMIN, headers=headers)).json()
    assert (await client.put(ADMIN, headers=headers, json={"parks": parks})).status_code == 422
    assert (await client.get(ADMIN, headers=headers)).json() == before


async def test_training_grants_and_management_role_are_enforced(
    client, session, operator, supervisor
):
    headers = auth(await login(client, operator.login))
    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="training", effect="deny"
        )
    )
    await session.commit()
    assert (await client.get(BASE, headers=headers)).status_code == 403
    assert (await client.post(f"{BASE}/start", headers=headers)).status_code == 403
    assert (await act(client, headers, "taxi")).status_code == 403
    assert (await client.get(ADMIN, headers=headers)).status_code == 403
    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="learning_admin", effect="allow"
        )
    )
    await session.commit()
    data = {"parks": [{"id": "p", "name": "P", "commission": 0}]}
    assert (await client.put(ADMIN, headers=headers, json=data)).status_code == 403
    supervisor_headers = auth(await login(client, supervisor.login))
    assert (await client.get(ADMIN, headers=supervisor_headers)).status_code == 200
    assert (await client.put(ADMIN, headers=supervisor_headers, json=data)).status_code == 403
    # Персональная выдача раздела работает и для администратора.
    admin = await make_user(session, login="driver-admin", role=Role.ADMIN)
    admin_headers = auth(await login(client, admin.login))
    assert (await client.post(f"{BASE}/start", headers=admin_headers)).status_code == 403
    session.add(
        AccessRule(target_type="user", target_id=str(admin.id), section="training", effect="allow")
    )
    await session.commit()
    assert (await client.post(f"{BASE}/start", headers=admin_headers)).status_code == 200
