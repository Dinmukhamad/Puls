"""A simulated phone workspace built only from each learner's accepted events.

The document supplies interface examples, not production phone credentials or operational
policy. Calls and messages here stay in this database; this service has no telephony client.
Exercise completion is derived by the server and survives resetting the practice workspace.
"""

from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.oktell import OktellEvent
from app.services.learning import lock_learner

DEMO_LOGIN = "6600"
DEMO_PASSWORD = "training"  # Public training credential, unrelated to the Puls account.
CONTACTS = (
    {
        "id": "supervisor",
        "name": "Айдана Садыкова",
        "number": "6601",
        "department": "Супервизоры",
        "status": "available",
    },
    {
        "id": "operator-01",
        "name": "Алексей Орлов",
        "number": "6602",
        "department": "Операторы",
        "status": "available",
    },
    {
        "id": "operator-02",
        "name": "Дана Мусина",
        "number": "6603",
        "department": "Операторы",
        "status": "busy",
    },
    {
        "id": "trainer",
        "name": "Марат Исаев",
        "number": "6604",
        "department": "Обучение",
        "status": "offline",
    },
)
CONTACT_BY_ID = {item["id"]: item for item in CONTACTS}
EXERCISES = (
    {
        "id": "oktell_ready",
        "title": "Начало учебной смены",
        "screen": "cabinet",
        "description": "Войдите с учебными данными, войдите в call-центр, выберите автоматический "
        "режим и включите веб-телефон.",
    },
    {
        "id": "oktell_call",
        "title": "Учебный звонок и журнал",
        "screen": "phone",
        "description": "Найдите коллегу, проведите учебный звонок и добавьте комментарий "
        "к завершённому звонку в журнале.",
    },
    {
        "id": "oktell_message",
        "title": "Связь с супервизором",
        "screen": "messages",
        "description": "Найдите учебного супервизора и отправьте ему сообщение в тренажёре.",
    },
    {
        "id": "oktell_shift",
        "title": "Перерыв и завершение смены",
        "screen": "cabinet",
        "description": "В call-центре выберите перерыв, вернитесь к работе "
        "и выйдите из call-центра.",
    },
)
EXERCISE_IDS = tuple(item["id"] for item in EXERCISES)


def aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def elapsed(start: datetime | None, finish: datetime) -> int:
    return max(0, int((finish - start).total_seconds())) if start else 0


def initial() -> dict:
    return {
        "logged_in": False,
        "center_joined": False,
        "office_status": "available",
        "center_mode": "automatic",
        "pause_reason": None,
        "forward_number": "",
        "web_phone": False,
        "auto_answer": False,
        "active_call": None,
        "calls": [],
        "messages": [],
        "completed": [],
        "metrics": {
            "center_seconds": 0,
            "break_seconds": 0,
            "talk_seconds": 0,
            "busy_seconds": 0,
            "calls": 0,
            "successful": 0,
        },
        "_center_since": None,
        "_pause_since": None,
        "_break_cycle": 0,
    }


def apply(workspace: dict, kind: str, payload: dict, request_id: str, when: datetime) -> None:
    """Fold one validated action. The private clocks never come from a client."""
    if kind == "reset":
        completed = workspace["completed"]
        workspace.clear()
        workspace.update(initial())
        workspace["completed"] = completed
    elif kind == "login":
        workspace["logged_in"] = True
    elif kind == "logout":
        close_center(workspace, when)
        workspace["logged_in"] = False
    elif kind == "join":
        workspace["center_joined"] = True
        workspace["_center_since"] = when
        workspace["_break_cycle"] = 0
    elif kind == "leave":
        close_center(workspace, when)
    elif kind == "office_status":
        workspace["office_status"] = payload["status"]
        workspace["forward_number"] = payload.get("number") or ""
    elif kind == "center_mode":
        workspace["center_mode"] = payload["mode"]
    elif kind == "phone_settings":
        workspace.update(web_phone=payload["web_phone"], auto_answer=payload["auto_answer"])
    elif kind == "pause":
        workspace["pause_reason"] = payload["reason"]
        workspace["_pause_since"] = when
        workspace["_break_cycle"] = 1 if payload["reason"] == "break" else 0
    elif kind == "resume":
        workspace["_break_cycle"] = 2 if workspace["pause_reason"] == "break" else 0
        close_pause(workspace, when)
    elif kind == "call_start":
        contact = CONTACT_BY_ID[payload["contact_id"]]
        workspace["active_call"] = {
            "id": request_id,
            "contact_id": contact["id"],
            "number": contact["number"],
            "name": contact["name"],
            "started_at": when.isoformat(),
        }
    elif kind == "call_end":
        call = workspace["active_call"]
        seconds = elapsed(datetime.fromisoformat(call["started_at"]), when)
        workspace["calls"].insert(
            0,
            {
                **call,
                "department": CONTACT_BY_ID[call["contact_id"]]["department"],
                "direction": "outbound",
                "status": "completed",
                "finished_at": when.isoformat(),
                "duration_seconds": seconds,
                "comment": "",
                "tags": [],
            },
        )
        workspace["active_call"] = None
        workspace["metrics"]["talk_seconds"] += seconds
        workspace["metrics"]["busy_seconds"] += seconds
        workspace["metrics"]["calls"] += 1
        workspace["metrics"]["successful"] += 1
    elif kind == "call_comment":
        call = next(item for item in workspace["calls"] if item["id"] == payload["call_id"])
        call.update(comment=payload["comment"], tags=payload["tags"])
    elif kind == "message":
        contact = CONTACT_BY_ID[payload["contact_id"]]
        workspace["messages"].append(
            {
                "id": request_id,
                "contact_id": contact["id"],
                "recipient": contact["name"],
                "text": payload["text"],
                "sent_at": when.isoformat(),
            }
        )


def close_pause(workspace: dict, when: datetime) -> None:
    seconds = elapsed(workspace["_pause_since"], when)
    workspace["metrics"]["busy_seconds"] += seconds
    if workspace["pause_reason"] == "break":
        workspace["metrics"]["break_seconds"] += seconds
    workspace.update(pause_reason=None, _pause_since=None)


def close_center(workspace: dict, when: datetime) -> None:
    workspace["metrics"]["center_seconds"] += elapsed(workspace["_center_since"], when)
    close_pause(workspace, when)
    workspace.update(center_joined=False, _center_since=None, _break_cycle=0)


def fold(events: list[OktellEvent]) -> dict:
    workspace = initial()
    for event in events:
        apply(workspace, event.kind, event.payload, event.request_id, aware(event.created_at))
        workspace["completed"] = list(dict.fromkeys([*workspace["completed"], *event.completed]))
    return workspace


def build(workspace: dict, user, now: datetime) -> dict:
    result = deepcopy(workspace)
    metrics = result["metrics"]
    metrics["center_seconds"] += elapsed(result["_center_since"], now)
    pause_seconds = elapsed(result["_pause_since"], now)
    metrics["busy_seconds"] += pause_seconds
    if result["pause_reason"] == "break":
        metrics["break_seconds"] += pause_seconds
    if result["active_call"]:
        live_seconds = elapsed(datetime.fromisoformat(result["active_call"]["started_at"]), now)
        metrics["talk_seconds"] += live_seconds
        metrics["busy_seconds"] += live_seconds
    for key in ("_center_since", "_pause_since", "_break_cycle"):
        result.pop(key)
    result["operator"] = {"name": user.full_name, "login": user.login, "number": DEMO_LOGIN}
    result["demo_credentials"] = {"login": DEMO_LOGIN, "password": DEMO_PASSWORD}
    result["contacts"] = deepcopy(CONTACTS)
    result["exercises"] = [
        {**item, "done": item["id"] in result["completed"]} for item in EXERCISES
    ]
    return result


async def history(session, user_id: int) -> list[OktellEvent]:
    return list(
        await session.scalars(
            select(OktellEvent).where(OktellEvent.user_id == user_id).order_by(OktellEvent.id)
        )
    )


async def state(session, user) -> dict:
    return build(fold(await history(session, user.id)), user, datetime.now(UTC))


def validate(workspace: dict, kind: str, payload: dict) -> None:
    if kind == "reset":
        return
    if kind == "login":
        if workspace["logged_in"]:
            raise DomainError("Вы уже вошли в учебный Oktell")
        return
    if not workspace["logged_in"]:
        raise DomainError("Сначала войдите в учебный Oktell")
    if (
        kind in ("leave", "logout", "pause", "office_status", "center_mode", "phone_settings")
        and workspace["active_call"]
    ):
        raise DomainError("Сначала завершите учебный звонок")
    if kind == "join" and workspace["center_joined"]:
        raise DomainError("Вы уже в call-центре")
    if kind in ("leave", "pause", "resume", "call_start") and not workspace["center_joined"]:
        raise DomainError("Сначала войдите в call-центр")
    if kind == "pause" and workspace["pause_reason"]:
        raise DomainError("Сначала вернитесь к работе из текущей паузы")
    if kind == "resume" and not workspace["pause_reason"]:
        raise DomainError("Сейчас нет активной паузы")
    if kind in ("call_start", "message") and payload["contact_id"] not in CONTACT_BY_ID:
        raise NotFoundError("Учебный контакт не найден")
    if (
        kind == "office_status"
        and payload["status"] == "forward"
        and payload["number"] not in {contact["number"] for contact in CONTACTS}
    ):
        raise DomainError("Выберите внутренний номер из учебного справочника")
    if kind == "call_start":
        if workspace["active_call"]:
            raise DomainError("Учебный звонок уже идёт")
        if workspace["pause_reason"] or workspace["office_status"] != "available":
            raise DomainError("Для учебного звонка вернитесь к работе и выберите «На связи»")
        if not workspace["web_phone"]:
            raise DomainError("Включите веб-телефон для учебного звонка")
        if CONTACT_BY_ID[payload["contact_id"]]["status"] != "available":
            raise DomainError("Учебный контакт сейчас недоступен. Выберите коллегу на связи")
    if kind == "call_end" and not workspace["active_call"]:
        raise DomainError("Нет активного учебного звонка")
    if kind == "call_comment" and not any(
        call["id"] == payload["call_id"] for call in workspace["calls"]
    ):
        raise NotFoundError("Завершённый учебный звонок не найден")


def achievements(before: dict, after: dict, kind: str) -> list[str]:
    earned = []
    if (
        after["logged_in"]
        and after["center_joined"]
        and after["web_phone"]
        and after["center_mode"] == "automatic"
    ):
        earned.append("oktell_ready")
    if any(call["status"] == "completed" and call["comment"].strip() for call in after["calls"]):
        earned.append("oktell_call")
    if any(message["contact_id"] == "supervisor" for message in after["messages"]):
        earned.append("oktell_message")
    if kind == "leave" and before["_break_cycle"] == 2:
        earned.append("oktell_shift")
    return [key for key in earned if key not in before["completed"]]


async def act(session, user, body) -> dict:
    request_id, kind = str(body.request_id), body.action
    payload = body.model_dump(mode="json", exclude={"request_id", "action", "password"})
    # Credentials in the document are not reused. Even retries accept only the public demo pair.
    if kind == "login" and (body.login != DEMO_LOGIN or body.password != DEMO_PASSWORD):
        raise DomainError("Используйте учебный логин 6600 и пароль training")
    uid = user.id
    await lock_learner(session, uid)
    events = await history(session, uid)
    existing = next((event for event in events if event.request_id == request_id), None)
    if existing is None:
        before, now = fold(events), datetime.now(UTC)
        validate(before, kind, payload)
        after = deepcopy(before)
        apply(after, kind, payload, request_id, now)
        existing = OktellEvent(
            user_id=uid,
            request_id=request_id,
            kind=kind,
            payload=payload,
            completed=achievements(before, after, kind),
            created_at=now,
        )
        session.add(existing)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await session.refresh(user)
            existing = await session.scalar(
                select(OktellEvent).where(
                    OktellEvent.user_id == uid, OktellEvent.request_id == request_id
                )
            )
            if existing is None:
                raise
    if existing.kind != kind or existing.payload != payload:
        raise ConflictError("Этот запрос уже выполнен с другими данными. Повторите действие заново")
    return await state(session, user)


async def mission_facts(session, user_ids: list[int]) -> dict[int, dict[str, int]]:
    """City rewards depend exclusively on persisted, server-verified achievements."""
    facts = {uid: dict.fromkeys(EXERCISE_IDS, 0) for uid in user_ids}
    if not facts:
        return facts
    rows = await session.execute(
        select(OktellEvent.user_id, OktellEvent.completed).where(OktellEvent.user_id.in_(user_ids))
    )
    for uid, completed in rows:
        for key in completed:
            if key in facts[uid]:
                facts[uid][key] = 1
    return facts
