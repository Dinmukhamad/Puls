"""Training fleet cabinet «Диспетчерская»: every operator practises on an own copy."""

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.schemas.dispatch import (
    AnswerInput,
    CarInput,
    CodeInput,
    DetailsInput,
    InventoryInput,
    RequestInput,
    TicketInput,
)
from app.services import dispatch

router = APIRouter(tags=["Учебная Диспетчерская"], dependencies=[Depends(require_work_sites)])
PREFIX = "/learning/dispatch"


@router.get(PREFIX)
async def get_cabinet(session: SessionDep, user: CurrentUser):
    return await dispatch.state(session, user)


@router.put(PREFIX + "/drivers/{driver_id}/details")
async def save_details(driver_id: str, body: DetailsInput, session: SessionDep, user: CurrentUser):
    return await dispatch.save_details(session, user, driver_id, body)


@router.put(PREFIX + "/drivers/{driver_id}/car")
async def save_car(driver_id: str, body: CarInput, session: SessionDep, user: CurrentUser):
    return await dispatch.save_car(session, user, driver_id, body)


@router.post(PREFIX + "/codes")
async def request_code(body: CodeInput, session: SessionDep, user: CurrentUser):
    return await dispatch.request_code(session, user, body)


@router.post(PREFIX + "/inventory")
async def issue_inventory(body: InventoryInput, session: SessionDep, user: CurrentUser):
    return await dispatch.issue_inventory(session, user, body)


@router.post(PREFIX + "/inventory/return")
async def return_inventory(body: InventoryInput, session: SessionDep, user: CurrentUser):
    return await dispatch.return_inventory(session, user, body)


@router.post(PREFIX + "/tickets")
async def create_ticket(body: TicketInput, session: SessionDep, user: CurrentUser):
    return await dispatch.create_ticket(session, user, body)


@router.post(PREFIX + "/calls/{call_id}/answer")
async def answer_call(call_id: str, body: AnswerInput, session: SessionDep, user: CurrentUser):
    return await dispatch.answer_call(session, user, call_id, body)


@router.post(PREFIX + "/reset")
async def reset(body: RequestInput, session: SessionDep, user: CurrentUser):
    return await dispatch.reset(session, user, body)
