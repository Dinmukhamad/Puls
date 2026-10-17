"""Ordinary CRM practice behind the existing Work Sites access boundary."""

from fastapi import APIRouter, Depends, Response

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.schemas.crm_training import CrmTrainingCheck, CrmTrainingStart
from app.services import crm_training

router = APIRouter(
    prefix="/learning/crm/training",
    tags=["Учебная CRM"],
    dependencies=[Depends(require_work_sites)],
)


@router.get("")
async def state(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await crm_training.state(session, user)


@router.post("/tasks/{key}/start")
async def start(
    key: str, session: SessionDep, user: CurrentUser, body: CrmTrainingStart | None = None
):
    result = await crm_training.start(session, user, key, body.request_id if body else None)
    await session.commit()
    return result


@router.post("/tasks/{key}/check")
async def check(key: str, body: CrmTrainingCheck, session: SessionDep, user: CurrentUser):
    result = await crm_training.check(session, user, key, body.appeal_id, body.request_id)
    await session.commit()
    return result
