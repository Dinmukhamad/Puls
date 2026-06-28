from __future__ import annotations

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
from app.services.seed import seed_database

settings = get_settings()

app = FastAPI(title="Puls — Operator Performance Platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API роуты
app.include_router(auth.router,           prefix=settings.api_prefix)
app.include_router(operators.router,      prefix=settings.api_prefix)
app.include_router(weekly_results.router, prefix=settings.api_prefix)
app.include_router(wallet.router,         prefix=settings.api_prefix)
app.include_router(rating.router,         prefix=settings.api_prefix)
app.include_router(shop.router,           prefix=settings.api_prefix)
app.include_router(dashboard.router,      prefix=settings.api_prefix)


@app.on_event("startup")
def startup() -> None:
    if settings.auto_create_tables:
        Base.metadata.create_all(bind=engine)
    if settings.auto_seed:
        db = SessionLocal()
        try:
            seed_database(db)
        finally:
            db.close()


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


# Статические файлы (css, js, assets)
_static_root = Path(__file__).parent.parent

for _folder in ("css", "js", "assets"):
    _path = _static_root / _folder
    if _path.exists():
        app.mount(f"/{_folder}", StaticFiles(directory=str(_path)), name=_folder)


# SPA fallback — всё остальное отдаёт index.html
_index = _static_root / "index.html"

@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return FileResponse(str(_index))
