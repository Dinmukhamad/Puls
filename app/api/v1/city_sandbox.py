"""The administrators' test city (app/services/city_sandbox.py): free building, any stage, at once.

Administrators only; nothing of it reaches the real districts, operators or the coin journal.
"""

from fastapi import APIRouter, Path, Response

from app.core.deps import AdminUser, SessionDep
from app.schemas.city_estate import (
    SANDBOX_DISTRICT,
    LevelInput,
    SandboxDistrictInput,
    SandboxPlotInput,
    SandboxProjectInput,
)
from app.services import city_sandbox

router = APIRouter(prefix="/admin/learning/city/sandbox", tags=["Мой город: тестовый город"])


@router.get("/cities/{city_id}")
async def state(city_id: str, session: SessionDep, user: AdminUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await city_sandbox.state(session, user, city_id)


@router.post("/plots")
async def build(body: SandboxPlotInput, session: SessionDep, user: AdminUser):
    return await city_sandbox.build(session, user, body)


@router.post("/buildings/{object_id}/level")
async def set_level(object_id: int, body: LevelInput, session: SessionDep, user: AdminUser):
    return await city_sandbox.set_level(session, user, object_id, body)


@router.delete("/buildings/{object_id}")
async def remove(object_id: int, session: SessionDep, user: AdminUser):
    return await city_sandbox.remove(session, user, object_id)


@router.put("/districts/{district_id}")
async def set_district(
    body: SandboxDistrictInput,
    session: SessionDep,
    user: AdminUser,
    district_id: str = Path(pattern=SANDBOX_DISTRICT),
):
    return await city_sandbox.set_district(session, user, district_id, body)


@router.post("/projects")
async def open_project(body: SandboxProjectInput, session: SessionDep, user: AdminUser):
    return await city_sandbox.open_project(session, user, body)


@router.post("/projects/{project_id}/complete")
async def complete_project(project_id: int, session: SessionDep, user: AdminUser):
    return await city_sandbox.complete_project(session, user, project_id)


@router.delete("/projects/{project_id}")
async def cancel_project(project_id: int, session: SessionDep, user: AdminUser):
    return await city_sandbox.cancel_project(session, user, project_id)


@router.post("/cities/{city_id}/reset")
async def reset(city_id: str, session: SessionDep, user: AdminUser):
    return await city_sandbox.reset(session, user, city_id)
