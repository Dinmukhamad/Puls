"""Direct assignment to a supervisor; only heads and admins change membership."""

from fastapi import APIRouter, Response

from app.core.deps import DirectoryUser, HeadUser, SessionDep
from app.schemas.user import SupervisorTeamOut, TeamOperators
from app.services import supervisor_teams as service

router = APIRouter(prefix="/admin/supervisor-teams", tags=["Команды супервайзеров"])


@router.get("", response_model=list[SupervisorTeamOut], summary="Супервайзеры и их команды")
async def teams(
    session: SessionDep, actor: DirectoryUser, response: Response, include_inactive: bool = False
):
    response.headers["Cache-Control"] = "private, no-store"
    return await service.directory(session, actor, include_inactive=include_inactive)


@router.post("/{supervisor_id}/operators", summary="Назначить операторов супервайзеру")
async def assign(session: SessionDep, actor: HeadUser, supervisor_id: int, payload: TeamOperators):
    return await service.assign(
        session, actor, supervisor_id, payload.operator_ids, group_id=payload.group_id
    )


@router.post("/{supervisor_id}/operators/remove", summary="Убрать операторов из команды")
async def remove(session: SessionDep, actor: HeadUser, supervisor_id: int, payload: TeamOperators):
    return await service.assign(session, actor, supervisor_id, payload.operator_ids, remove=True)
