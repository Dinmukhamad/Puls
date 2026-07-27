from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import get_settings
from app.core.lifespan import lifespan
from app.core.middleware import setup_middlewares
from app.core.static import setup_static
from app.database.db import engine
from app.models import entities  # noqa: F401
from app.services.database_readiness import assert_database_schema_current

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Puls - Operator Performance Platform", lifespan=lifespan)

setup_middlewares(app, settings)
app.include_router(api_router, prefix=settings.api_prefix)


def _error_payload(request: Request, code: str, message, details=None) -> dict:
    return {
        "code": code,
        "message": message if isinstance(message, str) else "Ошибка запроса",
        "details": details,
        "request_id": getattr(request.state, "request_id", None),
        # Compatibility for existing clients while they migrate to the envelope.
        "detail": message,
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=jsonable_encoder(
            _error_payload(request, f"http_{exc.status_code}", exc.detail)
        ),
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            _error_payload(
                request,
                "validation_error",
                "Проверьте заполнение полей",
                errors,
            )
        ),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "port": os.environ.get("PORT", "unknown"),
        "release_id": settings.release_id,
    }


@app.get("/ready", response_model=None)
def ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            assert_database_schema_current(conn)
        return {"status": "ready", "release_id": settings.release_id}
    except Exception:
        logger.exception("[ready] Database readiness check failed")
        return JSONResponse(
            status_code=503,
            content={"status": "not ready"},
        )


setup_static(app, settings)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    logger.info("[main] Starting on port %s", port)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
