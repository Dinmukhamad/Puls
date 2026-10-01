"""Team district land: public city state, the operator's plots, every change by idempotency key."""

from fastapi import APIRouter, Path, Response

from app.core.deps import CurrentUser, LearningReader, SessionDep
from app.schemas.city_estate import (
    KEY,
    CancelInput,
    ContributionInput,
    PlaceInput,
    ProjectInput,
    PurchaseInput,
    UpgradeInput,
)
from app.services import city_estate

router = APIRouter(tags=["Мой город: районы команд"])


def private(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


@router.get("/learning/city/cities/{city_id}")
async def city_state(city_id: str, session: SessionDep, user: CurrentUser, response: Response):
    private(response)
    return await city_estate.city_state(session, user, city_id)


@router.get("/learning/city/estate")
async def estate(session: SessionDep, user: CurrentUser, response: Response):
    private(response)
    return await city_estate.estate(session, user)


@router.post("/learning/city/plots")
async def purchase(body: PurchaseInput, session: SessionDep, user: CurrentUser):
    """A free plot of one's district with a square or a house on it."""
    return await city_estate.purchase(session, user, body)


@router.post("/learning/city/buildings/{object_id}/upgrade")
async def upgrade(object_id: int, body: UpgradeInput, session: SessionDep, user: CurrentUser):
    return await city_estate.upgrade(session, user, object_id, body)


@router.post("/learning/city/buildings/{object_id}/place")
async def place(object_id: int, body: PlaceInput, session: SessionDep, user: CurrentUser):
    """A building from the inventory (after a transfer) onto free plots of the new district."""
    return await city_estate.place(session, user, object_id, body)


@router.post("/learning/city/projects")
async def open_project(body: ProjectInput, session: SessionDep, user: CurrentUser):
    return await city_estate.open_project(session, user, body)


@router.post("/learning/city/projects/{project_id}/contributions")
async def contribute(
    project_id: int, body: ContributionInput, session: SessionDep, user: CurrentUser
):
    return await city_estate.contribute(session, user, project_id, body)


@router.post("/learning/city/projects/{project_id}/cancel")
async def cancel_project(
    project_id: int, body: CancelInput, session: SessionDep, user: CurrentUser
):
    return await city_estate.cancel_project(session, user, project_id, body)


@router.get("/learning/city/operations/{key}")
async def operation_status(
    session: SessionDep, user: CurrentUser, response: Response, key: str = Path(pattern=KEY)
):
    """After a lost answer: whether the operation with this key was done, before repeating it."""
    private(response)
    return await city_estate.operation_status(session, user, key)


@router.get("/admin/learning/city/estates")
async def report(session: SessionDep, user: LearningReader, response: Response):
    private(response)
    return await city_estate.report(session)
