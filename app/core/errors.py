"""Доменные исключения и их отображение в HTTP-ответы."""
from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Базовая ошибка бизнес-логики. Соответствует коду 400."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "domain_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFoundError(DomainError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class PermissionDeniedError(DomainError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "permission_denied"


class ConflictError(DomainError):
    """Нарушение состояния: неделя уже закрыта, заявка уже обработана и т. п."""

    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class InsufficientCoinsError(DomainError):
    """Недостаточно доступных коинов для операции (п. 4.3.2)."""

    status_code = status.HTTP_409_CONFLICT
    code = "insufficient_coins"

    def __init__(self, required: int, available: int) -> None:
        super().__init__(
            f"Недостаточно коинов: нужно {required}, доступно {available}. "
            f"Не хватает {required - available}."
        )
        self.required = required
        self.available = available


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        body: dict[str, object] = {"code": exc.code, "detail": exc.message}
        if isinstance(exc, InsufficientCoinsError):
            body["required"] = exc.required
            body["available"] = exc.available
            body["missing"] = exc.required - exc.available
        return JSONResponse(status_code=exc.status_code, content=body)
