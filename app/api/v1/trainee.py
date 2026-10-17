"""Learning-only dashboard. Completion is derived from verified simulator evidence."""

from fastapi import APIRouter, Response

from app.core.deps import CurrentUser, SessionDep
from app.core.errors import PermissionDeniedError
from app.models.enums import Role
from app.services import city

router = APIRouter(tags=["Подготовка стажёра"])


@router.post("/learning/trainee/progress")
async def progress(session: SessionDep, user: CurrentUser, response: Response):
    if user.role != Role.TRAINEE:
        raise PermissionDeniedError("Раздел доступен стажёрам", code="role_required")
    response.headers["Cache-Control"] = "private, no-store"
    data = await city.dashboard(session, user)
    # Advance prerequisites only after the simulator has recorded the required actions.
    # Every claim revalidates evidence and serializes on the user; repeated syncs are safe.
    for _ in range(len(city.TEMPLATES)):
        ready = [
            m
            for m in data["missions"]
            if m["state"] == "ready" and m["key"] != "scenario_business_park"
        ]
        if not ready:
            break
        for mission in ready:
            await city.claim(session, user, mission["key"], data["revision"])
        data = await city.dashboard(session, user)
    return data
