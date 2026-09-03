"""Сборка всех маршрутов версии v1."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin_config,
    admin_panel,
    admin_users,
    admin_weeks,
    auth,
    cabinet,
    rating,
    shop,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(cabinet.router)
api_router.include_router(rating.router)
api_router.include_router(shop.router)
api_router.include_router(admin_panel.router)
api_router.include_router(admin_weeks.router)
api_router.include_router(admin_config.router)
api_router.include_router(admin_users.router)
