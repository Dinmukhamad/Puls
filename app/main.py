from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from urllib.parse import urlparse

from app.core.config import get_settings
from sqlalchemy import text
from app.database.db import Base, SessionLocal, engine
from app.models import entities  # noqa: F401
from app.routers import analytics, auth, dashboard, groups, operators, period_reports, rating, shop, wallet, weekly_results

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Puls — Operator Performance Platform")

settings = get_settings()
_cors_origins = settings.cors_origin_list
# If CORS is *, credentials must be False (browser restriction)
# In production, set explicit domains in CORS_ORIGINS
_allow_credentials = "*" not in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_referer(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


@app.middleware("http")
async def csrf_origin_guard(request: Request, call_next):
    if (
        request.method.upper() in UNSAFE_METHODS
        and request.cookies.get(settings.auth_cookie_name)
    ):
        origin = request.headers.get("origin") or _origin_from_referer(request.headers.get("referer"))
        if origin:
            current_origin = f"{request.url.scheme}://{request.headers.get('host', '')}".rstrip("/")
            allowed_origins = {current_origin}
            allowed_origins.update(o.rstrip("/") for o in _cors_origins if o != "*")
            if origin.rstrip("/") not in allowed_origins:
                return JSONResponse(status_code=403, content={"detail": "Недопустимый источник запроса"})
    return await call_next(request)

app.include_router(auth.router,           prefix=settings.api_prefix)
app.include_router(groups.router,          prefix=settings.api_prefix)
app.include_router(period_reports.router,   prefix=settings.api_prefix)
app.include_router(analytics.router,        prefix=settings.api_prefix)
app.include_router(operators.router,      prefix=settings.api_prefix)
app.include_router(weekly_results.router, prefix=settings.api_prefix)
app.include_router(wallet.router,         prefix=settings.api_prefix)
app.include_router(rating.router,         prefix=settings.api_prefix)
app.include_router(shop.router,           prefix=settings.api_prefix)
app.include_router(dashboard.router,      prefix=settings.api_prefix)


@app.on_event("startup")
def startup() -> None:
    settings = get_settings()
    # Production safety check
    try:
        settings.check_production_safety()
    except RuntimeError as e:
        logger.critical(str(e))
        raise

    # Schema: Alembic runs via start.sh before uvicorn starts.
    # create_all is kept only as dev fallback (AUTO_CREATE_TABLES=true).
    if settings.auto_create_tables:
        logger.info("[startup] AUTO_CREATE_TABLES=true — creating missing tables...")
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("[startup] Tables OK")
        except Exception as e:
            logger.error(f"[startup] create_all failed: {e}")

        try:
            from app.services.schema_maintenance import ensure_operator_management_schema
            ensure_operator_management_schema(engine)
            logger.info("[startup] Schema compatibility OK")
        except Exception as e:
            logger.error(f"[startup] Schema maintenance failed (non-fatal): {e}")

    # Seed initial data
    if settings.auto_seed:
        logger.info("[startup] Running seed...")
        try:
            from app.services.seed import seed_database
            db = SessionLocal()
            try:
                seed_database(db)
                logger.info("[startup] Seed OK")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[startup] Seed failed (non-fatal): {e}")

@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "port": os.environ.get("PORT", "unknown")}


@app.get("/ready")
def ready() -> Dict[str, str]:
    """Readiness check — verifies DB connection."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"status": "not ready", "detail": str(e)})


# Статические файлы
_root = Path(__file__).parent.parent
for _folder in ("css", "js", "assets", "img"):
    _path = _root / _folder
    if _path.exists():
        app.mount(f"/{_folder}", StaticFiles(directory=str(_path)), name=_folder)

_index = _root / "index.html"


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return FileResponse(
        str(_index),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
    )


# Точка входа — читаем PORT из env сами
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"[main] Starting on port {port}")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
