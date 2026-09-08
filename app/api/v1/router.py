"""Сборка всех маршрутов версии v1."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    access,
    admin_config,
    admin_panel,
    admin_users,
    admin_weeks,
    analytics,
    auth,
    cabinet,
    driver,
    games,
    learning,
    progress,
    rating,
    shop,
    system,
    wallet,
)

api_router = APIRouter()
api_router.include_router(access.router)
api_router.include_router(auth.router)
api_router.include_router(cabinet.router)
api_router.include_router(rating.router)
api_router.include_router(shop.router)
api_router.include_router(admin_panel.router)
api_router.include_router(admin_weeks.router)
api_router.include_router(admin_config.router)
api_router.include_router(admin_users.router)
api_router.include_router(system.router)
api_router.include_router(progress.router)
api_router.include_router(analytics.router)
api_router.include_router(driver.router)
api_router.include_router(learning.router)
api_router.include_router(games.router)
api_router.include_router(wallet.router)
