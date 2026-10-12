"""Team district land: public city state, the operator's buildings and small things, every change
by idempotency key."""

from fastapi import APIRouter, Path, Response

from app.core.deps import CurrentUser, LearningReader, SessionDep
from app.schemas.city_estate import (
    KEY,
    CancelInput,
    ContributionInput,
    DecorInput,
    PlaceInput,
    ProjectInput,
    PurchaseInput,
    TurnInput,
    UndecorInput,
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
    """A square, a house or an office on free cells of one's district, its land with it."""
    return await city_estate.purchase(session, user, body)


@router.post("/learning/city/decor")
async def lay(body: DecorInput, session: SessionDep, user: CurrentUser):
    """Roads, footpaths, trees, lamps and other small things on free cells, many at once."""
    return await city_estate.lay(session, user, body)


@router.post("/learning/city/decor/remove")
async def take_away(body: UndecorInput, session: SessionDep, user: CurrentUser):
    """One's own small things off the cells named, their coins back."""
    return await city_estate.take_away(session, user, body)


@router.post("/learning/city/buildings/{object_id}/turn")
async def turn(object_id: int, body: TurnInput, session: SessionDep, user: CurrentUser):
    """Where one's building looks with no road beside it."""
    return await city_estate.turn(session, user, object_id, body)


@router.post("/learning/city/buildings/{object_id}/upgrade")
async def upgrade(object_id: int, body: UpgradeInput, session: SessionDep, user: CurrentUser):
    return await city_estate.upgrade(session, user, object_id, body)


@router.post("/learning/city/buildings/{object_id}/place")
async def place(object_id: int, body: PlaceInput, session: SessionDep, user: CurrentUser):
    """A building from the inventory (after a transfer) onto free cells of the new district."""
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
