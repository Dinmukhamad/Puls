"""Simulated Oktell: the same permission and QR boundary as other Work Sites."""

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.schemas.oktell import ActionInput
from app.services import oktell

router = APIRouter(tags=["Учебный Oktell"], dependencies=[Depends(require_work_sites)])
PREFIX = "/learning/oktell"


@router.get(PREFIX)
async def get_workspace(session: SessionDep, user: CurrentUser):
    return await oktell.state(session, user)


@router.post(PREFIX + "/actions")
async def perform_action(body: ActionInput, session: SessionDep, user: CurrentUser):
    return await oktell.act(session, user, body)
