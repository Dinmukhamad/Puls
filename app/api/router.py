from __future__ import annotations

from fastapi import APIRouter

from app.modules.analytics.router import router as analytics_router
from app.modules.auth.router import router as auth_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.groups.router import router as groups_router
from app.modules.operator_levels import router as operator_levels_router
from app.modules.operators.router import router as operators_router
from app.modules.rating.router import router as rating_router
from app.modules.reports.router import router as reports_router
from app.modules.shop.router import router as shop_router
from app.modules.tests import router as tests_router
from app.modules.users.router import router as users_router
from app.modules.wallet.router import router as wallet_router
from app.modules.weekly_results.router import router as weekly_results_router
from app.modules.wheel import router as wheel_router
from app.modules.work_norms.router import router as work_norms_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(operator_levels_router.router)
api_router.include_router(operator_levels_router.me_router)
api_router.include_router(operator_levels_router.admin_router)
api_router.include_router(operator_levels_router.admin_rules_router)
api_router.include_router(operator_levels_router.admin_operator_router)
api_router.include_router(groups_router)
api_router.include_router(reports_router)
api_router.include_router(analytics_router)
api_router.include_router(operators_router)
api_router.include_router(weekly_results_router)
api_router.include_router(wallet_router)
api_router.include_router(rating_router)
api_router.include_router(shop_router)
api_router.include_router(dashboard_router)
api_router.include_router(tests_router.router)
api_router.include_router(tests_router.admin_router)
api_router.include_router(work_norms_router)
api_router.include_router(wheel_router.router)
api_router.include_router(wheel_router.admin_router)
