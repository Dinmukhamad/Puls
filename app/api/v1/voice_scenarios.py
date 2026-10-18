"""The scenario editor: trainers, supervisors, heads and admins write the voice calls."""

from fastapi import APIRouter, Response

from app.core.deps import CurrentUser, SessionDep
from app.schemas.voice_scenario import ScenarioPublish, ScenarioSave, ScenarioTest
from app.services import voice_scenarios

router = APIRouter(prefix="/admin/learning/voice-scenarios", tags=["Сценарии звонков"])


@router.get("")
async def scenarios(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await voice_scenarios.editor_list(session, user)


@router.post("")
async def create(session: SessionDep, user: CurrentUser):
    row = await voice_scenarios.create(session, user)
    await session.commit()
    return await voice_scenarios.editor_data(session, row)


@router.post("/test")
async def test(body: ScenarioTest, user: CurrentUser):
    return voice_scenarios.test_run(user, body)


@router.get("/{scenario_id}")
async def scenario(scenario_id: int, session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await voice_scenarios.editor_data(
        session, await voice_scenarios.editor_row(session, user, scenario_id)
    )


@router.put("/{scenario_id}")
async def save(scenario_id: int, body: ScenarioSave, session: SessionDep, user: CurrentUser):
    row = await voice_scenarios.save(session, user, scenario_id, body)
    await session.commit()
    return await voice_scenarios.editor_data(session, row)


@router.post("/{scenario_id}/publish")
async def publish(
    scenario_id: int, body: ScenarioPublish, session: SessionDep, user: CurrentUser
):
    row = await voice_scenarios.publish(session, user, scenario_id, body.draft_version)
    await session.commit()
    return await voice_scenarios.editor_data(session, row)


@router.post("/{scenario_id}/withdraw")
async def withdraw(scenario_id: int, session: SessionDep, user: CurrentUser):
    row = await voice_scenarios.withdraw(session, user, scenario_id)
    await session.commit()
    return await voice_scenarios.editor_data(session, row)


@router.delete("/{scenario_id}")
async def delete(scenario_id: int, session: SessionDep, user: CurrentUser):
    await voice_scenarios.delete(session, user, scenario_id)
    await session.commit()
    return {"deleted": scenario_id}
