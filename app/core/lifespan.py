from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.database.db import Base, SessionLocal, engine
from app.services.database_migrations import upgrade_database_schema

logger = logging.getLogger(__name__)
settings = get_settings()


def run_startup_tasks() -> None:
    try:
        settings.check_production_safety()
    except RuntimeError as exc:
        logger.critical(str(exc))
        raise

    if engine.dialect.name != "sqlite":
        logger.info("[startup] Applying pending database migrations...")
        upgrade_database_schema()

    if settings.auto_create_tables:
        logger.info("[startup] AUTO_CREATE_TABLES=true - creating missing tables...")
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("[startup] Tables OK")
        except Exception as exc:
            logger.error("[startup] create_all failed: %s", exc)

    try:
        from app.services.schema_maintenance import (
            ensure_operator_management_schema,
            ensure_wheel_schema,
        )

        ensure_operator_management_schema(engine)
        ensure_wheel_schema(engine)
        logger.info("[startup] Schema compatibility OK")
    except Exception as exc:
        logger.error("[startup] Schema maintenance failed (non-fatal): %s", exc)

    if settings.auto_seed:
        logger.info("[startup] Running seed...")
        try:
            from app.modules.achievements.service import ensure_default_achievements
            from app.modules.missions.seed import ensure_default_missions
            from app.services.operator_levels import ensure_default_levels
            from app.services.seed import seed_database
            from app.services.shop_seed import ensure_default_shop
            from app.services.wheel_seed import ensure_default_wheel

            db = SessionLocal()
            try:
                ensure_default_levels(db)
                ensure_default_wheel(db)
                ensure_default_achievements(db)
                ensure_default_shop(db)
                ensure_default_missions(db)
                seed_database(db)
                db.commit()
                logger.info("[startup] Seed OK")
            finally:
                db.close()
        except Exception as exc:
            logger.error("[startup] Seed failed (non-fatal): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup_tasks()

    scheduler = None
    if settings.enable_weekly_accrual_cron:
        try:
            from app.core.scheduler import start_scheduler
            scheduler = start_scheduler()
        except Exception:
            logger.exception("[startup] Не удалось запустить планировщик еженедельного расчёта (non-fatal)")

    yield

    if scheduler is not None:
        from app.core.scheduler import stop_scheduler
        stop_scheduler()
