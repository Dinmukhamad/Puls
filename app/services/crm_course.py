"""Agreed CRM course: real navigation, call evidence and a separate ticket workflow.

Legacy training stays readable and its rewards stay intact. All mutations run under
the learner lock supplied by the route/saving caller and leave commits to it.
"""

import base64
import hashlib
import struct
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.db.base import utcnow
from app.models.crm import (
    CrmAppeal,
    CrmCourseCapture,
    CrmTicket,
    CrmTicketAttachment,
    CrmTicketEvent,
)
from app.models.crm_training import CrmTrainingAttempt
from app.services import crm_draft, crm_training
from app.services.crm_catalog import category_id

KEYS = ("crm_intro_v2", "crm_phone_v2", "crm_mismatch_v2", "crm_rework_v2", "crm_practice_v2")
ALIASES = {"crm_first": KEYS[0], "crm_phone": KEYS[1], "crm_closed": KEYS[3]}
TITLES = dict(
    zip(
        KEYS,
        (
            "Знакомство с CRM",
            "Смена номера телефона",
            "Звонок с другого номера",
            "Доработка тикета после ООЗ",
            "Самостоятельная смена номера",
        ),
        strict=True,
    )
)
GOALS = dict(
    zip(
        KEYS,
        (
            "Открой обращение, затем перейди в связанный тикет по его номеру.",
            "Сверь номер звонка и регистрации. Сделай снимок двух окон и оформи смену номера.",
            "Проверь номер звонка и объясни водителю три способа смены номера.",
            "Открой тикет по номеру, выполни действия модерации и дополни комментарий ссылкой.",
            "Оформи смену номера самостоятельно: проверка, снимок, обращение и связанный тикет.",
        ),
        strict=True,
    )
)
ADVICE = {"registered_call", "taxi_pro", "whatsapp"}


async def records(session, user):
    return {
        a.task_key: a
        for a in await session.scalars(
            select(CrmTrainingAttempt).where(
                CrmTrainingAttempt.user_id == user.id, CrmTrainingAttempt.task_key.in_(KEYS)
            )
        )
    }


async def own_attempt(session, user, key):
    if key not in KEYS:
        raise HTTPException(404, "Учебное задание не найдено")
    attempt = (await records(session, user)).get(key)
    if attempt is None:
        raise HTTPException(409, "Сначала начни это задание")
    return attempt


async def require_started(session, user, key):
    attempt = await own_attempt(session, user, key)
    if attempt.phase == "passed":
        raise HTTPException(409, "Это задание уже пройдено. Открой следующее задание.")
    if key not in (KEYS[1], KEYS[4]):
        raise HTTPException(409, "В этом задании работай с подготовленным обращением")
    return attempt


def work(attempt):
    return dict(attempt.snapshot.get("work", {}))


def remember(attempt, **values):
    attempt.snapshot = {**attempt.snapshot, "work": {**work(attempt), **values}}


def pass_attempt(attempt):
    if attempt.phase != "passed":
        attempt.phase, attempt.passed_at = "passed", utcnow()


async def ticket_for(session, row):
    if not row.is_ticket:
        return None
    ticket = await session.scalar(select(CrmTicket).where(CrmTicket.appeal_id == row.id))
    if ticket is None:
        ticket = CrmTicket(appeal_id=row.id, status="new")
        session.add(ticket)
        await session.flush()
    return ticket


async def seed_appeal(session, user, attempt):
    d = attempt.snapshot["driver"]
    rework = attempt.task_key == KEYS[3]
    row = CrmAppeal(
        request_id=str(uuid4()),
        author_id=user.id,
        author_name="Учебный оператор",
        channel="Звонок",
        phone=d["phone"],
        license_number=d["license"],
        driver_id=d["id"],
        contacted_at=utcnow(),
        park=d["park"],
        city=d["city"],
        category_ids=[
            category_id(attempt.snapshot["category_path"][: i + 1])
            for i in range(len(attempt.snapshot["category_path"]))
        ],
        category_labels=attempt.snapshot["category_path"],
        details={},
        comment="Прошу снять лимит с аккаунта водителя."
        if rework
        else "Учебное обращение для знакомства с CRM.",
        is_ticket=True,
        status="new",
        training_task=attempt.task_key,
    )
    session.add(row)
    await session.flush()
    attempt.appeal_id = row.id
    ticket = await ticket_for(session, row)
    if rework:
        ticket.status = "awaiting_reply"
        session.add(
            CrmTicketEvent(
                ticket_id=ticket.id,
                request_id=str(uuid4()),
                action="ooz_review",
                author_name="Отдел обработки запросов",
                comment="Для снятия лимита добавьте ссылку на аккаунт водителя в комментарий.",
            )
        )
    await session.flush()


async def start(session, user, key):
    if key not in KEYS:
        raise HTTPException(404, "Учебное задание не найдено")
    attempts = await records(session, user)
    index = KEYS.index(key)
    if index and (KEYS[index - 1] not in attempts or attempts[KEYS[index - 1]].phase != "passed"):
        raise HTTPException(409, "Сначала пройди предыдущее задание")
    if key not in attempts:
        source = (await crm_training._snapshots(session, user))[
            "crm_closed" if key == KEYS[3] else "crm_phone"
        ]
        d = dict(source["driver"])
        # Each call belongs to this exercise. The practice uses a different new number.
        if key == KEYS[4]:
            d["new_phone"] = d["new_phone"][:-1] + str((int(d["new_phone"][-1]) + 2) % 10)
        incoming = d["new_phone"] if key == KEYS[2] else d["phone"]
        speech = (
            "Хочу сменить номер телефона, звоню с другого номера. Как это сделать?"
            if key == KEYS[2]
            # The driver names the same new number the practice checks.
            else source["speech"].replace(source["driver"]["new_phone"], d["new_phone"])
            if key == KEYS[4]
            else source["speech"]
        )
        snapshot = {**source, "driver": d, "incoming_phone": incoming, "speech": speech, "work": {}}
        attempt = CrmTrainingAttempt(
            user_id=user.id, task_key=key, revision=2, snapshot=snapshot, phase="started", checks=[]
        )
        session.add(attempt)
        await session.flush()
        if key in (KEYS[0], KEYS[3]):
            await seed_appeal(session, user, attempt)
    return await state(session, user)


def steps_for(attempt, key):
    w = work(attempt) if attempt else {}
    saved = bool(attempt and attempt.appeal_id)
    checks_ok = bool(attempt and attempt.checks and all(c["ok"] for c in attempt.checks))
    if key == KEYS[0]:
        steps = [
            ("list", "Открой список обращений", w.get("list")),
            ("appeal", "Открой учебное обращение", w.get("appeal")),
            ("ticket", "Нажми на номер связанного тикета", w.get("ticket")),
        ]
    elif key == KEYS[2]:
        steps = [
            ("inspect", "Найди водителя и сравни номера", w.get("inspected")),
            ("advice", "Предложи три допустимых способа смены", w.get("advice")),
        ]
    elif key == KEYS[3]:
        steps = [
            ("appeal", "Открой обращение и найди номер тикета", w.get("appeal")),
            ("ticket", "Открой тикет и прочитай замечание ООЗ", w.get("ticket")),
            ("moderate", "Нажми «Модерация»", w.get("moderate")),
            ("rework", "Нажми «Вернуть на доработку»", w.get("rework")),
            ("comment", "Добавь комментарий со ссылкой и нажми «Отправить»", w.get("comment")),
        ]
    else:
        steps = [
            ("inspect", "Найди водителя и сравни номера", w.get("inspected")),
            ("capture", "Сделай один снимок двух окон", w.get("capture")),
            ("form", "Заполни поля, тему и комментарий; приложи снимок", checks_ok),
            ("save", "Сохрани и отправь обращение", saved and checks_ok),
            ("ticket", "Открой связанный тикет по его номеру", w.get("ticket")),
        ]
    return [
        {"key": name, "label": label, "status": "passed" if ok else "pending"}
        for name, label, ok in steps
    ]


async def state(session, user):
    attempts = await records(session, user)
    tasks = []
    for index, key in enumerate(KEYS):
        a = attempts.get(key)
        unlocked = not index or bool(
            attempts.get(KEYS[index - 1]) and attempts[KEYS[index - 1]].phase == "passed"
        )
        snapshot = a.snapshot if a else {}
        ticket = (
            await session.scalar(select(CrmTicket).where(CrmTicket.appeal_id == a.appeal_id))
            if a and a.appeal_id
            else None
        )
        capture = await session.scalar(
            select(CrmCourseCapture)
            .where(CrmCourseCapture.user_id == user.id, CrmCourseCapture.task_key == key)
            .options(undefer(CrmCourseCapture.data))
        )
        tasks.append(
            {
                "key": key,
                "title": TITLES[key],
                "goal": GOALS[key],
                "state": "passed"
                if a and a.phase == "passed"
                else "locked"
                if not unlocked
                else "in_progress"
                if a
                else "available",
                "speech": snapshot.get("speech", ""),
                "driver": snapshot.get("driver"),
                "incoming_phone": snapshot.get("incoming_phone"),
                "call_form": {
                    "note": snapshot.get("work", {}).get("call_note", ""),
                    "result": snapshot.get("work", {}).get("call_result", "Успешный звонок"),
                },
                "category_path": snapshot.get("category_path", []),
                "steps": steps_for(a, key),
                "checks": a.checks if a else [],
                "appeal_id": a.appeal_id if a else None,
                "ticket_id": ticket.id if ticket else None,
                "started_at": crm_training._iso(a.started_at) if a else None,
                "passed_at": crm_training._iso(a.passed_at) if a else None,
                "capture": {
                    "id": capture.id,
                    "name": f"crm-call-{capture.id}-{capture.digest[:8]}.png",
                    "data_url": "data:image/png;base64," + base64.b64encode(capture.data).decode(),
                }
                if capture
                else None,
            }
        )
    return {
        "revision": 2,
        "completed": sum(t["state"] == "passed" for t in tasks),
        "active_task": next((t["key"] for t in tasks if t["state"] == "in_progress"), None),
        "tasks": tasks,
    }


async def action(session, user, key, body):
    a = await own_attempt(session, user, key)
    if a.phase == "passed":
        return await state(session, user)
    if body.action == "call_form":
        if key not in (KEYS[1], KEYS[2], KEYS[4]):
            raise HTTPException(409, "Открой текущий учебный звонок")
        remember(a, call_note=body.note, call_result=body.call_result)
    elif body.action == "inspect":
        if key not in (KEYS[1], KEYS[2], KEYS[4]):
            raise HTTPException(409, "Открой обращение текущего задания")
        if body.driver_id != a.snapshot["driver"]["id"]:
            raise HTTPException(422, "Открыт другой водитель. Найди аккаунт водителя из звонка.")
        remember(a, inspected=True)
    elif body.action == "advice":
        if key != KEYS[2] or not work(a).get("inspected"):
            raise HTTPException(409, "Сначала открой водителя и сравни номера")
        if set(body.choices) != ADVICE or len(body.choices) != len(ADVICE):
            raise HTTPException(
                422,
                "Предложи звонок с номера регистрации, смену в «Такси Про» и обращение в WhatsApp.",
            )
        remember(a, advice=True)
        pass_attempt(a)
    elif body.action == "list" and key == KEYS[0]:
        remember(a, list=True)
    else:
        raise HTTPException(422, "Выполни действие в карточке обращения или тикета")
    await session.flush()
    return await state(session, user)


async def opened_appeal(session, user, row):
    if row.author_id != user.id or row.training_task not in KEYS:
        return
    a = await own_attempt(session, user, row.training_task)
    if a.appeal_id == row.id and a.phase != "passed":
        remember(a, appeal=True)


async def capture(session, user, key, image):
    a = await own_attempt(session, user, key)
    if key not in (KEYS[1], KEYS[4]) or a.phase == "passed":
        raise HTTPException(409, "Снимок доступен в текущем задании на смену номера")
    if not work(a).get("inspected"):
        raise HTTPException(409, "Сначала открой нужного водителя в диспетчерской")
    if (
        not image.startswith(b"\x89PNG\r\n\x1a\n")
        or not 100 <= len(image) <= 2 * 1024 * 1024
        or image[12:16] != b"IHDR"
        or struct.unpack(">II", image[16:24]) != (1440, 720)
    ):
        raise HTTPException(422, "Не удалось сделать снимок. Повтори попытку.")
    existing = await session.scalar(
        select(CrmCourseCapture).where(
            CrmCourseCapture.user_id == user.id, CrmCourseCapture.task_key == key
        )
    )
    if existing is None:
        session.add(
            CrmCourseCapture(
                user_id=user.id,
                task_key=key,
                driver_id=a.snapshot["driver"]["id"],
                incoming_phone=a.snapshot["incoming_phone"],
                digest=hashlib.sha256(image).hexdigest(),
                data=image,
            )
        )
    else:
        if existing.digest != hashlib.sha256(image).hexdigest():
            a.checks = [
                {
                    **check,
                    "ok": False,
                    "message": "Снимок обновлён. Замени вложение в обращении новым снимком.",
                }
                if check["key"] == "capture"
                else check
                for check in a.checks
            ]
        existing.digest = hashlib.sha256(image).hexdigest()
        existing.data = image
        existing.created_at = utcnow()
    remember(a, capture=True)
    await session.flush()
    return await state(session, user)


async def autograde(session, user, key, row, uploads):
    a = await require_started(session, user, key)
    if row.author_id != user.id or row.training_task != key:
        raise HTTPException(409, "Обращение относится к другому заданию")
    if a.appeal_id not in (None, row.id):
        raise HTTPException(409, "Исправь сохранённое обращение этого задания")
    a.appeal_id = row.id
    d = a.snapshot["driver"]
    checks = []

    def add(name, label, ok, message):
        checks.append(
            {"key": name, "label": label, "ok": bool(ok), "message": "" if ok else message}
        )

    add(
        "phone",
        "Текущий номер",
        crm_training._phone_tail(row.phone) == crm_training._phone_tail(d["phone"]),
        "В поле телефона укажи текущий номер регистрации. Новый номер напиши в комментарии.",
    )
    add(
        "license",
        "Водительское удостоверение",
        crm_training._plain(row.license_number) == crm_training._plain(d["license"]),
        "Проверь номер ВУ в карточке водителя.",
    )
    add("park", "Таксопарк", row.park == d["park"], "Выбери таксопарк водителя из задания.")
    add("city", "Город", row.city == d["city"], "Выбери город водителя из задания.")
    expected = [
        category_id(a.snapshot["category_path"][: i + 1])
        for i in range(len(a.snapshot["category_path"]))
    ]
    add(
        "category",
        "Тема обращения",
        row.category_ids == expected,
        "Выбери тему «Смена номера» в запросах таксопарку — ООЗ.",
    )
    add("ticket", "Формировать тикет", row.is_ticket, "Включи «Формировать тикет».")
    add(
        "channel",
        "Канал обращения",
        row.channel == "Звонок",
        "В этом задании водитель обратился по звонку.",
    )
    linked, why = crm_training._account_link(row.comment, d)
    add("link", "Аккаунт водителя", linked, why)
    without_links = crm_training.FLEET_LINK.sub("", row.comment)
    numbers = {crm_training._phone_tail(p) for p in crm_training.PHONE.findall(without_links)}
    add(
        "number",
        "Новый номер в комментарии",
        crm_training._phone_tail(d["new_phone"]) in numbers,
        "Укажи новый номер из задания в комментарии.",
    )
    add(
        "comment",
        "Описание просьбы",
        len(without_links.strip()) >= 12,
        "Коротко опиши просьбу о смене номера.",
    )
    shot = await session.scalar(
        select(CrmCourseCapture).where(
            CrmCourseCapture.user_id == user.id, CrmCourseCapture.task_key == key
        )
    )
    add(
        "capture",
        "Один снимок двух окон",
        shot is not None
        and len(uploads) == 1
        and any(
            hashlib.sha256(data).hexdigest() == shot.digest
            for _, mime, data in uploads
            if mime == "image/png"
        ),
        "Приложи один снимок, сделанный кнопкой «Сделать снимок» в этом задании.",
    )
    a.checks = checks
    if all(c["ok"] for c in checks):
        await ticket_for(session, row)
    await session.flush()
    return await state(session, user)


async def describe_ticket(session, user, ticket):
    row = await session.get(CrmAppeal, ticket.appeal_id)
    if row is None or row.author_id != user.id:
        raise HTTPException(404, "Учебный тикет не найден")
    events = list(
        await session.scalars(
            select(CrmTicketEvent)
            .where(CrmTicketEvent.ticket_id == ticket.id)
            .order_by(CrmTicketEvent.id)
        )
    )
    comments = []
    for event in events:
        files = list(
            await session.scalars(
                select(CrmTicketAttachment).where(CrmTicketAttachment.event_id == event.id)
            )
        )
        comments.append(
            {
                "id": event.id,
                "action": event.action,
                "author": event.author_name,
                "comment": event.comment,
                "created_at": event.created_at,
                "attachments": [{"id": f.id, "name": f.name, "size": f.size} for f in files],
            }
        )
    return {
        "id": ticket.id,
        "appeal_id": row.id,
        "status": ticket.status,
        "revision": ticket.revision,
        "created_at": ticket.created_at,
        "phone": row.phone,
        "author_name": row.author_name,
        "events": comments,
    }


async def opened_ticket(session, user, ticket):
    row = await session.get(CrmAppeal, ticket.appeal_id)
    if row is None or row.author_id != user.id:
        raise HTTPException(404, "Учебный тикет не найден")
    if row.training_task in KEYS:
        a = await own_attempt(session, user, row.training_task)
        if a.appeal_id == row.id and a.phase != "passed":
            if not work(a).get("appeal"):
                raise HTTPException(409, "Сначала открой обращение и нажми на номер тикета")
            remember(a, ticket=True)
            if a.task_key == KEYS[0] and work(a).get("list"):
                pass_attempt(a)
            if a.task_key in (KEYS[1], KEYS[4]) and a.checks and all(c["ok"] for c in a.checks):
                pass_attempt(a)
    return await describe_ticket(session, user, ticket)


async def ticket_action(session, user, ticket, body, uploads):
    row = await session.get(CrmAppeal, ticket.appeal_id)
    if row is None or row.author_id != user.id or row.training_task != KEYS[3]:
        raise HTTPException(404, "Тикет текущего задания не найден")
    a = await own_attempt(session, user, KEYS[3])
    previous = await session.scalar(
        select(CrmTicketEvent).where(
            CrmTicketEvent.ticket_id == ticket.id, CrmTicketEvent.request_id == str(body.request_id)
        )
    )
    if previous:
        if previous.action != body.action or previous.comment != body.comment:
            raise HTTPException(409, "Этот запрос уже использован. Обнови тикет.")
        return await describe_ticket(session, user, ticket)
    if a.phase == "passed" or a.appeal_id != row.id:
        raise HTTPException(409, "Задание уже завершено")
    if ticket.revision != body.revision:
        raise HTTPException(409, "Тикет изменён в другой вкладке. Обнови его и повтори действие.")
    draft, draft_files = await crm_draft.load_for_save(
        session, user, body.draft_key, body.draft_revision, f"ticket:{ticket.id}"
    )
    if draft and draft.form.get("comment", "").strip() != body.comment:
        raise HTTPException(409, "Комментарий изменился. Дождись сохранения и повтори отправку.")
    uploads = list(dict.fromkeys([*draft_files, *uploads]))
    if len(uploads) > 5 or sum(len(data) for _, _, data in uploads) > 8 * 1024 * 1024:
        raise HTTPException(422, "До 5 файлов, суммарно до 8 МБ")
    w = work(a)
    if not w.get("ticket"):
        raise HTTPException(409, "Сначала открой карточку тикета")
    if body.action == "moderate":
        if ticket.status != "awaiting_reply":
            raise HTTPException(409, "Тикет уже передан на модерацию")
        ticket.status = "moderation"
        remember(a, moderate=True)
    elif body.action == "rework":
        if ticket.status != "moderation" or not w.get("moderate"):
            raise HTTPException(409, "Сначала нажми «Модерация»")
        ticket.status = "rework"
        remember(a, rework=True)
    else:
        if ticket.status != "rework" or not w.get("rework"):
            raise HTTPException(409, "Сначала нажми «Вернуть на доработку»")
        linked, why = crm_training._account_link(body.comment, a.snapshot["driver"])
        if not linked:
            raise HTTPException(422, why)
        remember(a, comment=True)
        pass_attempt(a)
    if uploads and body.action != "comment":
        raise HTTPException(422, "Прикрепить изображение можно к комментарию")
    event = CrmTicketEvent(
        ticket_id=ticket.id,
        request_id=str(body.request_id),
        action=body.action,
        author_name=user.full_name,
        comment=body.comment,
    )
    session.add(event)
    ticket.revision += 1
    await session.flush()
    for name, mime, data in uploads:
        session.add(
            CrmTicketAttachment(event_id=event.id, name=name, mime=mime, data=data, size=len(data))
        )
    await crm_draft.consume_loaded(session, draft)
    await session.flush()
    return await describe_ticket(session, user, ticket)
