from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.database.db import Base, SessionLocal, engine
from app.models import entities  # noqa: F401
from app.routers import auth, dashboard, operators, rating, shop, wallet, weekly_results

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Puls — Operator Performance Platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,           prefix=settings.api_prefix)
app.include_router(operators.router,      prefix=settings.api_prefix)
app.include_router(weekly_results.router, prefix=settings.api_prefix)
app.include_router(wallet.router,         prefix=settings.api_prefix)
app.include_router(rating.router,         prefix=settings.api_prefix)
app.include_router(shop.router,           prefix=settings.api_prefix)
app.include_router(dashboard.router,      prefix=settings.api_prefix)


@app.on_event("startup")
def startup() -> None:
    logger.info("[startup] Creating tables...")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("[startup] Tables OK")
    except Exception as e:
        logger.error(f"[startup] create_all failed: {e}")
        raise

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
        # Seed не критичен — сервер запускается даже если seed упал


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


# Статические файлы
_root = Path(__file__).parent.parent
for _folder in ("css", "js", "assets"):
    _path = _root / _folder
    if _path.exists():
        app.mount(f"/{_folder}", StaticFiles(directory=str(_path)), name=_folder)

_index = _root / "index.html"

@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return FileResponse(str(_index))
