"""Simulated Oktell: the same permission and QR boundary as other Work Sites."""

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, SessionDep
from app.core.errors import PermissionDeniedError
from app.core.work_sites import require_work_sites
from app.schemas.oktell import ActionInput
from app.services import oktell
from app.services.voice_training import chat_operator


async def require_calls(user: CurrentUser):
    """Oktell is the telephony of the line: chat operators take no calls (docs/CHANNELS.md)."""
    if chat_operator(user):
        raise PermissionDeniedError(
            "Oktell — телефония линии: операторы чатов не принимают звонки."
        )


router = APIRouter(
    tags=["Учебный Oktell"], dependencies=[Depends(require_work_sites), Depends(require_calls)]
)
PREFIX = "/learning/oktell"


@router.get(PREFIX)
async def get_workspace(session: SessionDep, user: CurrentUser):
    return await oktell.state(session, user)


@router.post(PREFIX + "/actions")
async def perform_action(body: ActionInput, session: SessionDep, user: CurrentUser):
    return await oktell.act(session, user, body)
