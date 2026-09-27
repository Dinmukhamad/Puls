"""Performance reports the 3D city sends every minute and on leave (city v3 TZ §10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, StringConstraints

from app.core.deps import CurrentUser, SessionDep
from app.models.telemetry import CityPerfReport

router = APIRouter(prefix="/telemetry", tags=["Телеметрия"])

MAX_BODY = 2048
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]


class CityPerfIn(BaseModel):
    backend: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)]
    gpu: Annotated[str, StringConstraints(strip_whitespace=True, max_length=128)] = ""
    width: int = Field(ge=1, le=10000)
    height: int = Field(ge=1, le=10000)
    dpr: float = Field(ge=0.5, le=5)
    tier: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)]
    fps_avg: float = Field(ge=0, le=500)
    fps_p1: float = Field(ge=0, le=500)
    first_frame_ms: int | None = Field(default=None, ge=0, le=600_000)
    concessions: list[Short] = Field(default_factory=list, max_length=12)


@router.post("/city", status_code=status.HTTP_204_NO_CONTENT, summary="Отчёт о плавности 3D-города")
async def city_report(
    request: Request, session: SessionDep, user: CurrentUser, payload: CityPerfIn
) -> Response:
    if len(await request.body()) > MAX_BODY:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Отчёт больше 2 КБ")
    session.add(CityPerfReport(user_id=user.id, **payload.model_dump()))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
