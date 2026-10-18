"""Voice dialogue is learning content; Work Sites observations retain QR access."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.core.deps import CurrentUser, SessionDep
from app.core.errors import DomainError, NotFoundError
from app.core.work_sites import require_work_sites
from app.schemas.voice_training import (
    VoiceAnswer,
    VoiceInspection,
    VoiceRetry,
    VoiceReview,
    VoiceSpeechPreview,
    VoiceSpeechTurn,
    VoiceStart,
)
from app.services import voice_training, voice_tts

router = APIRouter(prefix="/learning/voice", tags=["Голосовой тренажёр"])


class PrivateSpeechRoute(APIRoute):
    """Audio, configuration, and all errors stay outside shared/browser caches."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request: Request):
            try:
                response = await handler(request)
            except DomainError as error:
                response = JSONResponse(
                    {"code": error.code, "detail": error.message}, status_code=error.status_code
                )
                if error.status_code == 429:
                    response.headers["Retry-After"] = "60"
            except HTTPException as error:
                error.headers = {**(error.headers or {}), "Cache-Control": "private, no-store"}
                raise
            except RequestValidationError as error:
                response = JSONResponse(
                    {"detail": jsonable_encoder(error.errors())}, status_code=422
                )
            response.headers["Cache-Control"] = "private, no-store"
            return response

        return private_handler


speech_router = APIRouter(route_class=PrivateSpeechRoute)


@speech_router.get("/speech/config")
async def speech_configuration(session: SessionDep, user: CurrentUser):
    await voice_training.require_scope(session, user)
    return voice_tts.configuration()


@speech_router.post("/speech/preview")
async def speech_preview(body: VoiceSpeechPreview, session: SessionDep, user: CurrentUser):
    await voice_training.require_scope(session, user)
    audio = await voice_tts.engine.synthesize(
        body.provider, voice_tts.PREVIEWS[body.language], body.persona, user.id, body.language
    )
    return audio.data()


@speech_router.post("/attempts/{attempt_id}/speech")
async def speech_turn(
    attempt_id: int, body: VoiceSpeechTurn, session: SessionDep, user: CurrentUser
):
    attempt = await voice_training.own_attempt(session, user, attempt_id)
    entry = next(
        (
            item for item in attempt.transcript
            if item["role"] == "driver" and item["turn"] == body.turn
        ),
        None,
    )
    if entry is None:
        raise NotFoundError("Реплика водителя не найдена.")
    audio = await voice_tts.engine.synthesize(
        body.provider, entry["text"], attempt.persona, user.id,
        attempt.snapshot.get("language", "ru"),
    )
    return audio.data()


router.include_router(speech_router)


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
