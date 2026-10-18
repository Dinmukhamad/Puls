"""A simulated phone workspace built only from each learner's accepted events.

The document supplies interface examples, not production phone credentials. The team's rules
are enforced here: a driver is called back through the park's code in «Перезвон», and more than
three minutes in that status ends the session. Drivers of the voice trainer call in: an operator in
the call-centre, in automatic mode, without a pause, gets a call that rings, is answered (by hand
or by «Автоответ») and opens a voice attempt; hanging up finishes it. Calls and messages here stay
in this database; this service has no telephony client. Exercise completion is derived by the
server and survives resetting the practice workspace.
"""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.oktell import OktellEvent
from app.services import voice_training
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
        "status": "paused",
    },
    {
        "id": "operator-03",
        "name": "Ерлан Жаксылыков",
        "number": "6605",
        "department": "Операторы",
        "status": "busy",
    },
    {
        "id": "operator-04",
        "name": "Мадина Ким",
        "number": "6606",
        "department": "Операторы",
        "status": "available",
    },
    {
        "id": "operator-05",
        "name": "Руслан Тлеубаев",
        "number": "6607",
        "department": "Операторы",
        "status": "paused",
    },
)
CONTACT_BY_ID = {item["id"]: item for item in CONTACTS}
# A driver is dialled through his park's line: its code, then his number from 7 without «+».
PARK_CODES = {"0880": "iTaxi"}
# The team's rule: «Перезвон» for longer than this ends the operator's Oktell session.
CALLBACK_LIMIT_SECONDS = 180
# A driver's call rings this long; unanswered, the queue moves it on and it is missed.
RING_SECONDS = 25
# What the operator may do while a call rings; anything else lets the call go.
KEEP_RINGING = frozenset({"answer", "voice_language", "call_comment", "message"})
PAUSE_TITLES = {
    "technical": "Тех.причина",
    "callback": "Перезвон",
    "training": "Тренинг",
    "break": "Перерыв",
}
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
        "ringing": None,
        "voice_language": "ru",
        "notice": None,
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
        # Who rings now and who called last: the server's choice, never shown before answering.
        "_ring_call": None,
        "_last_voice": None,
    }


def apply(workspace: dict, kind: str, payload: dict, request_id: str, when: datetime) -> None:
    """Fold one validated action. The private clocks never come from a client."""
    if workspace["ringing"] and kind not in KEEP_RINGING:
        miss(workspace, when)
    if kind == "reset":
        completed = workspace["completed"]
        workspace.clear()
        workspace.update(initial())
        workspace["completed"] = completed
    elif kind == "login":
        workspace["logged_in"] = True
        workspace["notice"] = None
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
        # Choosing a mode in the status menu also ends a pause: the operator is back at work.
        workspace["center_mode"] = payload["mode"]
        if workspace["pause_reason"]:
            resume(workspace, when)
    elif kind == "phone_settings":
        workspace.update(web_phone=payload["web_phone"], auto_answer=payload["auto_answer"])
    elif kind == "pause":
        workspace["pause_reason"] = payload["reason"]
        workspace["_pause_since"] = when
        workspace["_break_cycle"] = 1 if payload["reason"] == "break" else 0
    elif kind == "resume":
        resume(workspace, when)
    elif kind == "call_start":
        contact = CONTACT_BY_ID[payload["contact_id"]]
        workspace["active_call"] = {
            "id": request_id,
            "contact_id": contact["id"],
            "number": contact["number"],
            "name": contact["name"],
            "department": contact["department"],
            "started_at": when.isoformat(),
        }
    elif kind == "dial":
        try:
            line = driver_line(payload["number"])
        except DomainError:  # Park codes may change later; an accepted call keeps its digits.
            line = {"number": payload["number"], "park": "таксопарк"}
        workspace["active_call"] = {
            "id": request_id,
            "contact_id": "",
            "number": line["number"],
            "name": f"Водитель · {line['park']}",
            "department": line["park"],
            "started_at": when.isoformat(),
        }
    elif kind == "voice_language":
        workspace["voice_language"] = payload["language"]
    elif kind == "ring":
        call = payload["call"]
        workspace["ringing"] = {
            "id": request_id,
            "number": call["number"],
            "name": "Водитель",
            "department": call["park"],
            "started_at": when.isoformat(),
        }
        workspace["_ring_call"] = call
    elif kind == "answer":
        call = workspace["_ring_call"]
        workspace["active_call"] = {
            **workspace["ringing"],
            "contact_id": "",
            "started_at": when.isoformat(),
            "direction": "inbound",
            "voice_attempt_id": payload["call"]["attempt_id"],
        }
        workspace.update(
            ringing=None, _ring_call=None, _last_voice=[call["scenario_key"], call["persona"]]
        )
    elif kind == "call_end":
        call = workspace["active_call"]
        seconds = elapsed(datetime.fromisoformat(call["started_at"]), when)
        workspace["calls"].insert(
            0,
            {
                **call,
                "direction": call.get("direction", "outbound"),
                "status": "completed",
                "finished_at": when.isoformat(),
                "duration_seconds": seconds,
                "comment": "",
                "tags": [],
            },
        )
        workspace["active_call"] = None
        workspace["metrics"]["talk_seconds"] += seconds
        # A call made in a pause is already busy time: the pause counts it when it closes.
        if not workspace["pause_reason"]:
            workspace["metrics"]["busy_seconds"] += seconds
        workspace["metrics"]["calls"] += 1
        workspace["metrics"]["successful"] += 1
        # A call in «Перезвон» is never cut off; past the limit the session ends as it finishes.
        deadline = callback_deadline(workspace)
        if deadline and when >= deadline:
            expel(workspace, when)
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


def driver_line(number: str) -> dict:
    """The dialled digits as the park's code and the driver's 11 digits, or why they are wrong."""
    digits = "".join(number.split()).replace("-", "")
    if "+" in digits:
        raise DomainError("Номер набирается без «+»: код таксопарка, затем номер водителя с 7")
    if not digits.isdigit():
        raise DomainError("Наберите цифрами код таксопарка, затем номер водителя с 7")
    code, phone = digits[:4], digits[4:]
    park = PARK_CODES.get(code)
    if park is None:
        raise DomainError("Сначала наберите код таксопарка: для iTaxi это 0880")
    if not phone:
        raise DomainError("После кода таксопарка наберите номер водителя с 7")
    if not phone.startswith("7"):
        raise DomainError("После кода таксопарка номер водителя начинается с 7, без «+» и без 8")
    if len(phone) != 11:
        raise DomainError("В номере водителя 11 цифр с 7 в начале, например 77075053636")
    return {"code": code, "park": park, "phone": phone, "number": code + phone}


def miss(workspace: dict, when: datetime) -> None:
    """The driver was not answered: the journal keeps the call as missed."""
    workspace["calls"].insert(
        0,
        {
            **workspace["ringing"],
            "contact_id": "",
            "direction": "inbound",
            "status": "missed",
            "finished_at": when.isoformat(),
            "duration_seconds": 0,
            "comment": "",
            "tags": [],
        },
    )
    workspace["metrics"]["calls"] += 1
    workspace.update(ringing=None, _ring_call=None)


def resume(workspace: dict, when: datetime) -> None:
    workspace["_break_cycle"] = 2 if workspace["pause_reason"] == "break" else 0
    close_pause(workspace, when)


def callback_deadline(workspace: dict) -> datetime | None:
    if workspace["pause_reason"] != "callback" or workspace["_pause_since"] is None:
        return None
    return workspace["_pause_since"] + timedelta(seconds=CALLBACK_LIMIT_SECONDS)


def expel(workspace: dict, when: datetime) -> None:
    """Oktell ends the session: the operator leaves the call-centre and has to log in again."""
    close_center(workspace, when)
    workspace.update(logged_in=False, notice={"kind": "callback_timeout", "at": when.isoformat()})


def advance(workspace: dict, until: datetime) -> None:
    """Rules that act with time alone: an unanswered call is missed, «Перезвон» past its limit
    ends the session unless a call is still going."""
    ring = workspace["ringing"]
    if ring:
        missed = datetime.fromisoformat(ring["started_at"]) + timedelta(seconds=RING_SECONDS)
        if until >= missed:
            miss(workspace, missed)
    deadline = callback_deadline(workspace)
    if deadline and not workspace["active_call"] and until >= deadline:
        expel(workspace, deadline)


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
        when = aware(event.created_at)
        advance(workspace, when)
        # An action accepted before the time limit existed cannot follow its forced logout.
        if workspace["logged_in"] or event.kind in ("login", "reset"):
            apply(workspace, event.kind, event.payload, event.request_id, when)
        workspace["completed"] = list(dict.fromkeys([*workspace["completed"], *event.completed]))
    return workspace


def build(workspace: dict, user, now: datetime) -> dict:
    result = deepcopy(workspace)
    advance(result, now)
    metrics = result["metrics"]
    metrics["center_seconds"] += elapsed(result["_center_since"], now)
    pause_seconds = elapsed(result["_pause_since"], now)
    result["pause_seconds"] = pause_seconds
    metrics["busy_seconds"] += pause_seconds
    if result["pause_reason"] == "break":
        metrics["break_seconds"] += pause_seconds
    if result["active_call"]:
        live_seconds = elapsed(datetime.fromisoformat(result["active_call"]["started_at"]), now)
        metrics["talk_seconds"] += live_seconds
        if not result["pause_reason"]:
            metrics["busy_seconds"] += live_seconds
    for key in ("_center_since", "_pause_since", "_break_cycle", "_ring_call", "_last_voice"):
        result.pop(key)
    result["ring_seconds"] = RING_SECONDS
    result["operator"] = {"name": user.full_name, "login": user.login, "number": DEMO_LOGIN}
    result["demo_credentials"] = {"login": DEMO_LOGIN, "password": DEMO_PASSWORD}
    result["contacts"] = deepcopy(CONTACTS)
    result["park_codes"] = dict(PARK_CODES)
    result["callback_limit_seconds"] = CALLBACK_LIMIT_SECONDS
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
    result = build(fold(await history(session, user.id)), user, datetime.now(UTC))
    result["voice_calls"] = voice_training.can_call(user)
    return result


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
        kind
        in ("leave", "logout", "pause", "resume", "office_status", "center_mode", "phone_settings")
        and workspace["active_call"]
    ):
        raise DomainError("Сначала завершите учебный звонок")
    if kind == "join" and workspace["center_joined"]:
        raise DomainError("Вы уже в call-центре")
    if (
        kind in ("leave", "pause", "resume", "call_start", "dial", "ring")
        and not workspace["center_joined"]
    ):
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
    if kind == "dial":
        if workspace["active_call"]:
            raise DomainError("Учебный звонок уже идёт")
        if not workspace["web_phone"]:
            raise DomainError("Включите веб-телефон в меню статусов")
        pause = workspace["pause_reason"]
        if pause and pause != "callback":
            raise DomainError(
                f"Сейчас пауза «{PAUSE_TITLES[pause]}». Вернитесь к работе "
                "и для звонка водителю поставьте «Перезвон»"
            )
        if not pause and workspace["center_mode"] != "manual":
            raise DomainError(
                "Чтобы перезвонить водителю, сначала поставьте статус «Перезвон»: "
                "тогда вам не будут поступать звонки"
            )
        driver_line(payload["number"])
    if kind == "ring":
        if workspace["active_call"] or workspace["ringing"]:
            raise DomainError("Учебный звонок уже идёт")
        if not workspace["web_phone"]:
            raise DomainError("Включите веб-телефон: звонки поступают через него")
        if (
            workspace["pause_reason"]
            or workspace["center_mode"] != "automatic"
            or workspace["office_status"] != "available"
        ):
            raise DomainError(
                "Звонки поступают в автоматическом режиме без паузы и со статусом «На связи»"
            )
    if kind == "answer":
        if not workspace["ringing"]:
            raise DomainError("Звонок уже не поступает: он ушёл в пропущенные")
        if workspace["active_call"]:
            raise DomainError("Сначала завершите текущий звонок")
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


async def voice_payload(session, user, workspace: dict, kind: str, payload: dict) -> dict:
    """The server's part of a driver's call, kept in the event: who rings, the attempt the answer
    opens. Hanging up (or resetting the workspace) during the call finishes its attempt."""
    if kind == "ring":
        retry = payload.get("retry")
        call = await (
            voice_training.retry_call(session, user, retry["attempt_id"], retry["turn"])
            if retry
            else voice_training.incoming(
                session, user, workspace["voice_language"], workspace["_last_voice"]
            )
        )
        return {**payload, "call": call}
    if kind == "answer":
        attempt = await voice_training.answer_call(session, user, workspace["_ring_call"])
        return {**payload, "call": {"attempt_id": attempt.id}}
    attempt_id = (workspace["active_call"] or {}).get("voice_attempt_id")
    if kind in ("call_end", "reset") and attempt_id:
        await voice_training.finish(session, user, attempt_id)
    return payload


async def act(session, user, body) -> dict:
    request_id, kind = str(body.request_id), body.action
    payload = body.model_dump(
        mode="json", exclude={"request_id", "action", "password"}, exclude_none=kind == "ring"
    )
    sent = payload
    # Credentials in the document are not reused. Even retries accept only the public demo pair.
    if kind == "login" and (body.login != DEMO_LOGIN or body.password != DEMO_PASSWORD):
        raise DomainError("Используйте учебный логин 6600 и пароль training")
    uid = user.id
    await lock_learner(session, uid)
    events = await history(session, uid)
    existing = next((event for event in events if event.request_id == request_id), None)
    if existing is None:
        before, now = fold(events), datetime.now(UTC)
        advance(before, now)
        validate(before, kind, payload)
        payload = await voice_payload(session, user, before, kind, payload)
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
    # A retry repeats what the client sent; the server's part of a call is not compared.
    if existing.kind != kind or {k: v for k, v in existing.payload.items() if k != "call"} != sent:
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
