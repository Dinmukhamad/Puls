from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from urllib.parse import urlparse

from app.core.config import get_settings
from sqlalchemy import text
from app.database.db import Base, SessionLocal, engine
from app.models import entities  # noqa: F401
from app.routers import analytics, auth, coins, dashboard, groups, operator_levels, operators, period_reports, rating, shop, tests, users, wallet, weekly_results

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
# Сжимает текстовые ответы (JSON API + статика отдаваемая через FileResponse) —
# JS/CSS бандлы весят сотни КБ несжатыми, gzip даёт ~70-80% экономии трафика.
app.add_middleware(GZipMiddleware, minimum_size=1000)


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_referer(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _request_origin(request: Request) -> str:
    """
    Реальный публичный origin запроса с учётом Railway proxy. Railway
    терминирует TLS на прокси и проксирует внутрь как http — без учёта
    x-forwarded-proto/x-forwarded-host request.url.scheme будет "http",
    а настоящий клиентский origin — "https://<домен>", из-за чего сравнение
    всегда проваливалось и легитимные запросы отбивались как "недопустимый
    источник".
    """
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")

    proto = (forwarded_proto or request.url.scheme or "https").split(",")[0].strip()
    host = (
        forwarded_host
        or request.headers.get("host")
        or request.url.netloc
    ).split(",")[0].strip()

    return f"{proto}://{host}".rstrip("/")


def _origin_host(origin: str | None) -> str | None:
    if not origin:
        return None
    parsed = urlparse(origin)
    return parsed.netloc.lower() if parsed.netloc else None


@app.middleware("http")
async def csrf_origin_guard(request: Request, call_next):
    if (
        request.method.upper() in UNSAFE_METHODS
        and request.cookies.get(settings.auth_cookie_name)
    ):
        origin = request.headers.get("origin") or _origin_from_referer(request.headers.get("referer"))

        if origin:
            origin = origin.rstrip("/")
            current_origin = _request_origin(request)

            current_host = _origin_host(current_origin)
            origin_host = _origin_host(origin)

            allowed_origins = {current_origin}
            allowed_origins.update(o.rstrip("/") for o in _cors_origins if o != "*")

            # За Railway-прокси схема (http/https) во внутреннем запросе может
            # не совпадать с публичной схемой клиента — поэтому помимо точного
            # совпадения origin допускаем совпадение по host (без схемы),
            # если он совпадает с текущим доменом приложения.
            same_host = bool(current_host and origin_host and current_host == origin_host)

            if origin not in allowed_origins and not same_host:
                return JSONResponse(status_code=403, content={"detail": "Недопустимый источник запроса"})
    return await call_next(request)

app.include_router(auth.router,           prefix=settings.api_prefix)
app.include_router(users.router,          prefix=settings.api_prefix)
app.include_router(operator_levels.router, prefix=settings.api_prefix)
app.include_router(operator_levels.me_router, prefix=settings.api_prefix)
app.include_router(operator_levels.admin_router, prefix=settings.api_prefix)
app.include_router(operator_levels.admin_rules_router, prefix=settings.api_prefix)
app.include_router(operator_levels.admin_operator_router, prefix=settings.api_prefix)
app.include_router(groups.router,          prefix=settings.api_prefix)
app.include_router(period_reports.router,   prefix=settings.api_prefix)
app.include_router(analytics.router,        prefix=settings.api_prefix)
app.include_router(operators.router,      prefix=settings.api_prefix)
app.include_router(weekly_results.router, prefix=settings.api_prefix)
app.include_router(wallet.router,         prefix=settings.api_prefix)
app.include_router(coins.router,          prefix=settings.api_prefix)
app.include_router(rating.router,         prefix=settings.api_prefix)
app.include_router(shop.router,           prefix=settings.api_prefix)
app.include_router(dashboard.router,      prefix=settings.api_prefix)
app.include_router(tests.router,          prefix=settings.api_prefix)
app.include_router(tests.admin_router,    prefix=settings.api_prefix)


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
            from app.services.operator_levels import ensure_default_levels
            db = SessionLocal()
            try:
                ensure_default_levels(db)
                seed_database(db)
                db.commit()
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


class CachedStaticFiles(StaticFiles):
    """
    Статика (css/js/img/assets) подключается через query-параметр версии
    (например styles.css?v=race-compact-3) — при деплое версия меняется,
    значит можно безопасно отдавать длинный immutable-кеш: один и тот же
    URL с одним и тем же ?v= всегда отдаёт один и тот же файл.
    """
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# Статические файлы
_root = Path(__file__).parent.parent
for _folder in ("css", "js", "assets", "img"):
    _path = _root / _folder
    if _path.exists():
        app.mount(f"/{_folder}", CachedStaticFiles(directory=str(_path)), name=_folder)

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
