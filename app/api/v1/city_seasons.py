"""Seasons of the city: the schedule, the reset and the past cities kept in the history."""

from fastapi import APIRouter, Response

from app.core.deps import CurrentUser, HeadUser, SessionDep
from app.schemas.city_season import ResetInput, ScheduleInput
from app.services import city_seasons

router = APIRouter(tags=["Мой город: сезоны"])


@router.get("/learning/city/seasons")
async def seasons(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    await city_seasons.ensure(session)
    return await city_seasons.overview(session, user)


@router.get("/learning/city/seasons/{season_id}/cities/{city_id}")
async def past_city(
    season_id: int, city_id: str, session: SessionDep, user: CurrentUser, response: Response
):
    response.headers["Cache-Control"] = "private, no-store"
    return await city_seasons.past_city(session, user, season_id, city_id)


@router.put("/admin/learning/city/seasons/schedule")
async def schedule(body: ScheduleInput, session: SessionDep, user: HeadUser):
    return await city_seasons.schedule(session, user, body)


@router.post("/admin/learning/city/seasons/reset")
async def reset(body: ResetInput, session: SessionDep, user: HeadUser):
    """Ends the season going on now: both cities start again, the past one goes to the history."""
    return await city_seasons.reset_now(session, user, body)
