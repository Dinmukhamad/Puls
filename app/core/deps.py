"""Зависимости FastAPI: текущий пользователь, проверка ролей, границы видимости."""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.developer import is_developer
from app.core.errors import PermissionDeniedError
from app.core.security import decode_token
from app.db.session import get_session
from app.models.enums import ROLE_LEVEL, Role
from app.models.session import LoginSession
from app.models.user import Group, User
from app.services.access import effective_access, request_sections
from app.services.sessions import is_valid

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_PREFIX}/auth/login", auto_error=False
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Не удалось подтвердить учётные данные",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    session: SessionDep,
    token: Annotated[str | None, Depends(oauth2_scheme)],
    request: Request,
) -> User:
    if not token:
        raise _CREDENTIALS_ERROR
    try:
        payload = decode_token(token, "access")
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise _CREDENTIALS_ERROR from exc

    record = await session.get(LoginSession, session_id)
    if not is_valid(record, user_id):
        raise _CREDENTIALS_ERROR
    request.state.auth_session_id = session_id
    user = await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user_id)
    )
    if user is None:
        raise _CREDENTIALS_ERROR
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена"
        )
    access = await effective_access(session, user)
    request.state.section_access = access
    path = request.url.path.removeprefix(settings.API_V1_PREFIX)
    sections = request_sections(path, request.method, user.role)
    request.state.required_sections = sections
    if sections and not any(access["allowed"].get(code, False) for code in sections):
        raise PermissionDeniedError(
            "Доступ к разделу закрыт администратором", code="section_denied"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_developer(user: CurrentUser) -> User:
    if not is_developer(user):
        raise PermissionDeniedError(
            "Сессии и устройства доступны только разработчику", code="developer_required"
        )
    return user


DeveloperUser = Annotated[User, Depends(require_developer)]


class RequireRole:
    """Зависимость-страж: пропускает пользователей с ролью не ниже указанной."""

    def __init__(self, minimum: Role) -> None:
        self.minimum = minimum

    async def __call__(self, user: CurrentUser, request: Request) -> User:
        if not user.has_role_at_least(self.minimum):
            # Explicit section grants open read views; roles still bound data and writes.
            access = request.state.section_access
            if (
                self.minimum != Role.ADMIN
                and request.method in ("GET", "HEAD")
                and any(
                    access["allowed"].get(code) and access["decisions"][code]["source"] != "default"
                    for code in request.state.required_sections
                )
            ):
                return user
            raise PermissionDeniedError("Недостаточно прав для этого раздела", code="role_required")
        return user


require_operator = RequireRole(Role.OPERATOR)
require_supervisor = RequireRole(Role.SUPERVISOR)
require_head = RequireRole(Role.HEAD)
require_admin = RequireRole(Role.ADMIN)

StaffUser = Annotated[User, Depends(require_supervisor)]
HeadUser = Annotated[User, Depends(require_head)]
AdminUser = Annotated[User, Depends(require_admin)]


async def supervised_group_ids(session: AsyncSession, actor: User) -> list[int]:
    """Идентификаторы групп, за которые отвечает супервайзер."""
    rows = await session.scalars(select(Group.id).where(Group.supervisor_id == actor.id))
    return list(rows)


async def visible_users_filter(session: AsyncSession, actor: User) -> ColumnElement[bool]:
    """
    Условие SQL, ограничивающее выборку операторов зоной ответственности актора.

    Руководитель и администратор видят всех; супервайзер - свои группы и себя;
    оператор - только себя (п. 5 «Права доступа»).
    """
    if actor.has_role_at_least(Role.HEAD):
        return User.id.is_not(None)
    if actor.role == Role.SUPERVISOR:
        group_ids = await supervised_group_ids(session, actor)
        if not group_ids:
            return User.id == actor.id
        return (User.group_id.in_(group_ids)) | (User.id == actor.id)
    return User.id == actor.id


async def ensure_can_manage(session: AsyncSession, actor: User, target: User) -> None:
    """Проверяет право актора выполнять операции над конкретным оператором."""
    if actor.has_role_at_least(Role.HEAD):
        return
    if actor.role == Role.SUPERVISOR:
        group_ids = await supervised_group_ids(session, actor)
        if target.group_id is not None and target.group_id in group_ids:
            return
        raise PermissionDeniedError(
            f"Оператор {target.full_name} не входит в вашу зону ответственности"
        )
    raise PermissionDeniedError("Недостаточно прав для этой операции")


async def ensure_can_manage_credentials(
    session: AsyncSession, actor: User, target: User
) -> None:
    """
    Право менять чужой логин и пароль.

    Иерархия ролей: администратор - любому сотруднику, руководитель -
    супервайзерам и операторам, супервайзер - операторам. Роль актора должна
    быть строго выше роли сотрудника, иначе равные могли бы отбирать доступ
    друг у друга.

    Поверх иерархии действует обычная зона ответственности: супервайзер
    работает только со своими группами. Сбрасывать пароль сотруднику, которого
    не видно даже в списке, он не должен.

    Свой аккаунт через этот путь не меняется. Смена собственных данных живёт
    в профиле и требует текущего пароля - иначе оставленная открытой сессия
    позволила бы сменить пароль, не зная старого.
    """
    if actor.id == target.id:
        raise PermissionDeniedError(
            "Свои логин и пароль меняются в профиле, с подтверждением паролем",
            code="self_service_required",
        )

    if actor.role == Role.ADMIN:
        return

    if ROLE_LEVEL[Role(actor.role)] <= ROLE_LEVEL[Role(target.role)]:
        raise PermissionDeniedError(
            f"Недостаточно прав, чтобы менять учётные данные: {target.full_name} "
            f"занимает равную или более высокую должность"
        )

    if actor.role == Role.SUPERVISOR:
        group_ids = await supervised_group_ids(session, actor)
        if target.group_id is None or target.group_id not in group_ids:
            raise PermissionDeniedError(
                f"Сотрудник {target.full_name} не входит в вашу зону ответственности"
            )


class Pagination:
    """Общие параметры постраничной выдачи."""

    def __init__(
        self,
        page: Annotated[int, Query(ge=1, description="Номер страницы, с единицы")] = 1,
        size: Annotated[int | None, Query(ge=1, le=500, description="Размер страницы")] = None,
    ) -> None:
        self.page = page
        self.size = min(size or settings.DEFAULT_PAGE_SIZE, settings.MAX_PAGE_SIZE)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


PaginationDep = Annotated[Pagination, Depends(Pagination)]
