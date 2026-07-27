from __future__ import annotations

from urllib.parse import urlparse
from uuid import uuid4

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


def _request_origin(request: Request, trusted_proxy_ips: set[str] | None = None) -> str:
    client_ip = request.client.host if request.client else ""
    trust_forwarded = client_ip in (trusted_proxy_ips or set())
    forwarded_proto = request.headers.get("x-forwarded-proto") if trust_forwarded else None
    forwarded_host = request.headers.get("x-forwarded-host") if trust_forwarded else None

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
    async def request_context_and_security_headers(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'"
        )
        if settings.auth_cookie_secure:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

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
                current_origin = _request_origin(
                    request, settings.trusted_proxy_ip_list
                )

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
            if settings.csrf_enforced:
                cookie_token = request.cookies.get("pulse_csrf_token")
                header_token = request.headers.get("x-csrf-token")
                if not cookie_token or not header_token or cookie_token != header_token:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Недействительный CSRF-токен"},
                    )
        return await call_next(request)
