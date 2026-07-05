from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import get_settings
from app.core.lifespan import lifespan
from app.core.middleware import setup_middlewares
from app.core.static import setup_static
from app.database.db import engine
from app.models import entities  # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Puls - Operator Performance Platform", lifespan=lifespan)

setup_middlewares(app, settings)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "port": os.environ.get("PORT", "unknown")}


@app.get("/ready")
def ready() -> dict[str, str] | JSONResponse:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "detail": str(exc)},
        )


setup_static(app, settings)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    logger.info("[main] Starting on port %s", port)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
