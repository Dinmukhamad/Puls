"""Consultation scenarios; real Work Sites practice keeps the existing QR boundary."""

from fastapi import APIRouter, Depends, Response

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.schemas.scenario import ScenarioAnswer, ScenarioCrmCheck, ScenarioDispatchCheck
from app.services import scenarios

router = APIRouter(prefix="/learning/scenarios", tags=["Учебные сценарии"])


@router.get("")
async def catalog(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await scenarios.catalog(session, user)


@router.post("/{key}/start")
async def start(key: str, session: SessionDep, user: CurrentUser):
    attempt = await scenarios.start(session, user, key)
    await session.commit()
    return scenarios.attempt_data(attempt)


@router.get("/attempts/{attempt_id}")
async def attempt(attempt_id: int, session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return scenarios.attempt_data(await scenarios.own_attempt(session, user, attempt_id))


@router.put("/attempts/{attempt_id}/answer")
async def answer(attempt_id: int, body: ScenarioAnswer, session: SessionDep, user: CurrentUser):
    attempt = await scenarios.answer(session, user, attempt_id, body)
    await session.commit()
    return scenarios.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/dispatch-check", dependencies=[Depends(require_work_sites)])
async def dispatch_check(
    attempt_id: int, body: ScenarioDispatchCheck, session: SessionDep, user: CurrentUser
):
    attempt = await scenarios.dispatch_check(session, user, attempt_id, body)
    await session.commit()
    return scenarios.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/crm-check", dependencies=[Depends(require_work_sites)])
async def crm_check(
    attempt_id: int, body: ScenarioCrmCheck, session: SessionDep, user: CurrentUser
):
    attempt = await scenarios.crm_check(session, user, attempt_id, body)
    await session.commit()
    return scenarios.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/finish", dependencies=[Depends(require_work_sites)])
async def finish(attempt_id: int, session: SessionDep, user: CurrentUser):
    attempt = await scenarios.finish(session, user, attempt_id)
    await session.commit()
    return scenarios.attempt_data(attempt)
