from __future__ import annotations

from fastapi import APIRouter

from app.modules.wallet import coins_router, wallet_router

router = APIRouter()
router.include_router(wallet_router.router)
router.include_router(coins_router.router)
