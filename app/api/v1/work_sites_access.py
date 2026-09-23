from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.core.deps import CurrentUser, DirectoryUser, SessionDep
from app.services import work_sites_access as service


def no_store(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


router = APIRouter(
    prefix="/work-sites-access", tags=["QR-доступ"], dependencies=[Depends(no_store)]
)


class QrInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    payload: str = Field(min_length=1, max_length=150)


@router.get("/status")
async def status(session: SessionDep, user: CurrentUser, request: Request):
    return await service.status(session, user, request.state.auth_session_id)


@router.post("/request")
async def request_qr(session: SessionDep, user: CurrentUser, request: Request):
    return await service.issue(session, user, request.state.auth_session_id)


@router.post("/preview")
async def preview(body: QrInput, session: SessionDep, user: DirectoryUser):
    return await service.preview(session, body.payload)


@router.post("/approve")
async def approve(body: QrInput, session: SessionDep, user: DirectoryUser):
    return await service.approve(session, user, body.payload)
