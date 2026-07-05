from __future__ import annotations

from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_referer(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _request_origin(request: Request) -> str:
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


def setup_middlewares(app: FastAPI, settings) -> None:
    cors_origins = settings.cors_origin_list
    allow_credentials = "*" not in cors_origins

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.middleware("http")
    async def csrf_origin_guard(request: Request, call_next):
        if (
            request.method.upper() in UNSAFE_METHODS
            and request.cookies.get(settings.auth_cookie_name)
        ):
            origin = request.headers.get("origin") or _origin_from_referer(
                request.headers.get("referer")
            )

            if origin:
                origin = origin.rstrip("/")
                current_origin = _request_origin(request)

                current_host = _origin_host(current_origin)
                origin_host = _origin_host(origin)

                allowed_origins = {current_origin}
                allowed_origins.update(o.rstrip("/") for o in cors_origins if o != "*")

                same_host = bool(
                    current_host and origin_host and current_host == origin_host
                )

                if origin not in allowed_origins and not same_host:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Недопустимый источник запроса"},
                    )
        return await call_next(request)
