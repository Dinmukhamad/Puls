"""Voice dialogue is learning content; Work Sites observations retain QR access."""

from fastapi import APIRouter, Depends, Response

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.schemas.voice_training import (
    VoiceAnswer,
    VoiceInspection,
    VoiceRetry,
    VoiceReview,
    VoiceStart,
)
from app.services import voice_training

router = APIRouter(prefix="/learning/voice", tags=["Голосовой тренажёр"])


@router.get("")
async def catalog(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await voice_training.catalog(session, user)


@router.post("/start")
async def start(body: VoiceStart, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.start(session, user, body)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.get("/attempts/{attempt_id}")
async def attempt(attempt_id: int, session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return voice_training.attempt_data(await voice_training.own_attempt(session, user, attempt_id))


@router.post("/attempts/{attempt_id}/answer")
async def answer(attempt_id: int, body: VoiceAnswer, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.answer(session, user, attempt_id, body)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/inspect", dependencies=[Depends(require_work_sites)])
async def inspect(attempt_id: int, body: VoiceInspection, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.inspect(session, user, attempt_id, body)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/finish")
async def finish(attempt_id: int, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.finish(session, user, attempt_id)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/retry")
async def retry(attempt_id: int, body: VoiceRetry, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.retry(session, user, attempt_id, body)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.post("/attempts/{attempt_id}/review")
async def review(attempt_id: int, body: VoiceReview, session: SessionDep, user: CurrentUser):
    attempt = await voice_training.review(session, user, attempt_id, body)
    await session.commit()
    return voice_training.attempt_data(attempt)


@router.get("/reviews")
async def reviews(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await voice_training.reviews(session, user)


@router.get("/reviews/{attempt_id}")
async def review_detail(
    attempt_id: int, session: SessionDep, user: CurrentUser, response: Response
):
    response.headers["Cache-Control"] = "private, no-store"
    return await voice_training.review_detail(session, user, attempt_id)


@router.post("/reviews/{attempt_id}/resolve")
async def resolve_review(
    attempt_id: int, body: VoiceReview, session: SessionDep, user: CurrentUser
):
    data = await voice_training.resolve_review(session, user, attempt_id, body)
    await session.commit()
    return data
