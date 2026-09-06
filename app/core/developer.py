"""Полномочия владельца установки, независимые от назначаемых разделов."""

from typing import TYPE_CHECKING

from app.core.config import settings
from app.core.errors import PermissionDeniedError

if TYPE_CHECKING:
    from app.models.user import User


def is_developer(user: "User") -> bool:
    return (
        bool(settings.DEVELOPER_LOGIN)
        and user.login == settings.DEVELOPER_LOGIN
        and user.role == "admin"
    )


def protect_developer_account(actor: "User", target: "User") -> None:
    if target.login == settings.DEVELOPER_LOGIN and not is_developer(actor):
        raise PermissionDeniedError(
            "Учётную запись разработчика изменяет только её владелец",
            code="developer_required",
        )
