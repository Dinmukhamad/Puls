"""Точка входа приложения: сборка FastAPI, жизненный цикл, служебные маршруты."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.db.init_db import create_schema, seed_reference_data
from app.db.session import SessionLocal, engine
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

DESCRIPTION = """
Бэкенд системы геймификации операторов: коины, рейтинг, магазин бонусов
и административная панель.

**Роли:** оператор, супервайзер, руководитель, администратор.
Авторизация - Bearer-токен, получаемый в `POST /api/v1/auth/login`.
"""


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.AUTO_CREATE_SCHEMA:
        await create_schema()
    if settings.SEED_REFERENCE_DATA:
        async with SessionLocal() as session:
            created = await seed_reference_data(session)
        if any(created.values()):
            logger.info("Справочники дополнены: %s", created)

    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()
        await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=DESCRIPTION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    """
    Корень отдаёт документацию.

    Сервис - это API без собственного интерфейса, и без этого маршрута открытие
    домена в браузере упиралось бы в 404.
    """
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["Служебные"], summary="Проверка живости сервиса")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.APP_VERSION}
