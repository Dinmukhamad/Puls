"""Apply to every API router that exposes Work Sites resources."""

from fastapi import Request

from app.core.deps import CurrentUser, SessionDep
from app.core.errors import PermissionDeniedError
from app.models.enums import Role
from app.services.work_sites_access import has_grant


async def require_work_sites(user: CurrentUser, session: SessionDep, request: Request):
    if user.role == Role.OPERATOR and not await has_grant(session, request.state.auth_session_id):
        raise PermissionDeniedError(
            "Для Рабочих сайтов требуется QR-подтверждение сотрудника",
            code="work_sites_qr_required",
        )
