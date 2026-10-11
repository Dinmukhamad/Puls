"""Daily situations on the city map: up to three a day, answered once each, right in the city.

A day's situations come from the set of work situations the head edits (a built-in set until the
first save). An operator never meets a situation they have already answered: when every enabled
one is answered, the day has none until trainers add new ones. The question is frozen when the day
is dealt, the answer is checked here, and a right answer pays a few coins once, with a key that
cannot pay twice.
"""

import random
from copy import deepcopy
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import distinct, func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.db.base import utcnow
from app.models.city import CityQuest, CitySituations
from app.models.enums import Role, TxType
from app.models.user import User
from app.services.coins import post_transaction
from app.services.learning import lock_learner
from app.services.rules import write_audit

SLOTS = 3
COINS = 10
# Who asks, on the map: a taxi at the depot, a caller at the CRM centre, the guide on the plaza.
GIVERS = ("driver", "client", "guide")
BANK = [
    (
        "Водитель",
        "Водитель просит сменить номер телефона в профиле. Что нужно для обращения?",
        [
            "Только новый номер",
            "Старый и новый номера и скриншот, подтверждающий смену",
            "Номер водительского удостоверения",
        ],
        1,
        "Для «Смены номера» нужны старый и новый номера и скриншот — "
        "без них обращение не пройдёт проверку.",
    ),
    (
        "Водитель",
        "Водитель недоволен и повышает голос. Как лучше начать ответ?",
        [
            "Попросить перезвонить позже",
            "Спокойно выслушать и назвать, чем можете помочь",
            "Сразу перевести звонок другому сотруднику",
        ],
        1,
        "Сначала выслушайте и покажите, что понимаете проблему: "
        "так разговор быстрее становится спокойным.",
    ),
    (
        "Клиент",
        "Звонящий просит сообщить номер телефона водителя. Что ответить?",
        [
            "Продиктовать номер из карточки",
            "Отказать: личные данные водителя не передаются третьим лицам",
            "Отправить номер сообщением",
        ],
        1,
        "Личные данные водителей не передаются. Помогите решить вопрос через обращение.",
    ),
    (
        "Водитель",
        "Вы сохранили тикет по вопросу водителя. Когда он считается решённым?",
        [
            "Сразу после сохранения",
            "Когда сотрудник проверит его и переведёт в статус «Закрыт»",
            "Через сутки автоматически",
        ],
        1,
        "Тикет закрывает сотрудник после проверки — только тогда вопрос решён.",
    ),
    (
        "Клиент",
        "Вы не знаете ответа на вопрос звонящего. Как поступить?",
        [
            "Ответить наугад, чтобы не задерживать",
            "Честно сказать, что уточните, и зафиксировать обращение",
            "Завершить звонок",
        ],
        1,
        "Лучше уточнить и зафиксировать обращение, чем дать неверный ответ.",
    ),
    (
        "Водитель",
        "Водитель жалуется, что заказ отменился в пути. Засчитывается ли он в завершённые?",
        [
            "Да, если водитель доехал до пассажира",
            "Нет, отменённый заказ не считается завершённым",
            "Да, всегда",
        ],
        1,
        "Завершённым считается только заказ, доведённый до расчёта.",
    ),
    (
        "Клиент",
        "При создании обращения категория выбрана не до конца. Что будет?",
        [
            "Обращение сохранится как есть",
            "Нужно выбрать все уровни категории, иначе обращение не сохранится",
            "Категорию заполнит система",
        ],
        1,
        "Выберите все уровни категории и заполните обязательные поля — тогда обращение сохранится.",
    ),
    (
        "Водитель",
        "Водитель просит изменить данные в профиле, но не может подтвердить, "
        "что это его аккаунт. Что делать?",
        [
            "Изменить данные, раз он просит",
            "Не менять данные, пока личность не подтверждена",
            "Удалить аккаунт",
        ],
        1,
        "Данные меняются только после подтверждения, что обращается владелец аккаунта.",
    ),
    (
        "Клиент",
        "Разговор окончен, вопрос решён. Что важно сделать?",
        [
            "Ничего, всё и так понятно",
            "Кратко подвести итог и попрощаться",
            "Сразу положить трубку",
        ],
        1,
        "Короткий итог показывает, что вопрос решён, и оставляет хорошее впечатление.",
    ),
]


async def economy(session):
    from app.services.city_economy import economy as load

    return await load(session)


def today():
    return datetime.now(ZoneInfo(settings.TIMEZONE)).date()


def default_situations():
    """The built-in situations, as the editor lists them until a trainer saves the set."""
    return [
        {
            "id": f"bank-{i}",
            "speaker": speaker,
            "text": text,
            "options": list(options),
            "correct": correct,
            "explanation": explanation,
            "enabled": True,
        }
        for i, (speaker, text, options, correct, explanation) in enumerate(BANK)
    ]


def bank_questions(items=None):
    """The enabled situations as questions to deal."""
    return [
        {
            "source": "bank",
            "ref": item["id"],
            "title": "Рабочая ситуация",
            "speaker": item["speaker"],
            "text": item["text"],
            "options": list(item["options"]),
            "correct": item["correct"],
            "explanation": item["explanation"],
        }
        for item in (default_situations() if items is None else items)
        if item["enabled"]
    ]


async def situations(session):
    row = await session.get(CitySituations, 1)
    return {
        "revision": row.revision if row else 0,
        "items": deepcopy(row.items) if row else default_situations(),
    }


def _ref():
    """The situation a dealt question came from (its id in the set)."""
    return CityQuest.snapshot["ref"].as_string()


async def answered_refs(session, user_id):
    """The situations this operator has already answered, on any day."""
    # SELECT DISTINCT keeps the text type; distinct() around the JSON path reads it back as JSON
    # on SQLite.
    refs = await session.scalars(
        select(_ref()).where(CityQuest.user_id == user_id, CityQuest.answer.is_not(None)).distinct()
    )
    return {ref for ref in refs if ref}


async def situation_stats(session, items):
    """For the editor: how many operators answered each situation, and how many have none left."""
    ref = _ref()
    rows = await session.execute(
        select(ref, func.count(distinct(CityQuest.user_id)))
        .where(CityQuest.answer.is_not(None))
        .group_by(ref)
    )
    answered = {key: count for key, count in rows if key}
    enabled = [item["id"] for item in items if item["enabled"]]
    exhausted = 0
    if enabled:
        done = (
            select(CityQuest.user_id)
            .join(User, User.id == CityQuest.user_id)
            .where(
                CityQuest.answer.is_not(None),
                ref.in_(enabled),
                User.role == Role.OPERATOR,
                User.is_active.is_(True),
            )
            .group_by(CityQuest.user_id)
            .having(func.count(distinct(ref)) >= len(enabled))
            .subquery()
        )
        exhausted = await session.scalar(select(func.count()).select_from(done))
    return {"answered": answered, "exhausted": exhausted or 0}


async def save_situations(session, actor, body):
    items = [item.model_dump() for item in body.items]
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CitySituations(id=1, revision=revision, items=items, updated_by_id=actor.id))
    else:
        result = await session.execute(
            update(CitySituations)
            .where(CitySituations.id == 1, CitySituations.revision == body.revision)
            .values(revision=revision, items=items, updated_by_id=actor.id)
        )
        if result.rowcount != 1:
            raise ConflictError("Ситуации уже изменили. Обновите страницу и повторите.")
    try:
        await write_audit(
            session,
            actor_id=actor.id,
            action="city.situations",
            entity_type="city_situations",
            entity_id="1",
            payload={"revision": revision, "count": len(items)},
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Ситуации уже изменили. Обновите страницу.") from None
    return {"revision": revision, "items": items}


def deal(user_id, day, bank):
    """The day's questions from the bank by slot, None where the bank ran short.

    The same for the same day and bank.
    """
    rng = random.Random(f"{user_id}:{day.isoformat()}")
    picks = rng.sample(bank, min(len(bank), SLOTS))
    # Drivers' questions wait at the depot's taxi, callers' at the CRM centre, others at the guide.
    wants = ("водител", "клиент")
    slots = [None] * SLOTS
    for want, slot in zip(wants, range(SLOTS), strict=False):
        match = next((q for q in picks if q not in slots and want in q["speaker"].lower()), None)
        slots[slot] = match
    rest = iter(q for q in picks if q not in slots)
    picks = [q if q is not None else next(rest, None) for q in slots]
    # The options come in a new order each time, so the right one cannot be learnt by its place.
    dealt = []
    for q in picks:
        if q is None:
            dealt.append(None)
            continue
        order = list(range(len(q["options"])))
        rng.shuffle(order)
        dealt.append(
            {**q, "options": [q["options"][i] for i in order], "correct": order.index(q["correct"])}
        )
    return dealt


def public(row):
    q = row.snapshot
    answered = row.answer is not None
    return {
        "slot": row.slot,
        "giver": GIVERS[row.slot % len(GIVERS)],
        "title": q["title"],
        "speaker": q["speaker"],
        "text": q["text"],
        "options": q["options"],
        "answered": answered,
        "answer": row.answer,
        "correct": row.correct,
        # Only once answered: the right option and why.
        "right": q["correct"] if answered else None,
        "explanation": q["explanation"] if answered else None,
        "coins": row.coins,
    }


async def rows_for(session, user_id, day):
    return list(
        await session.scalars(
            select(CityQuest)
            .where(CityQuest.user_id == user_id, CityQuest.day == day)
            .order_by(CityQuest.slot)
        )
    )


async def quests(session, user, *, inspecting=False):
    """Today's situations; the first read of the day deals them (never for staff).

    Situations the operator has answered before are never dealt again. With none left the day
    stays empty, and a later read deals the new situations trainers add.
    """
    if user.role != Role.OPERATOR:
        return None
    day = today()
    rows = await rows_for(session, user.id, day)
    if not rows and not inspecting:
        passed = await answered_refs(session, user.id)
        fresh = [
            q
            for q in bank_questions((await situations(session))["items"])
            if q["ref"] not in passed
        ]
        if fresh:
            await lock_learner(session, user.id)
            rows = await rows_for(session, user.id, day)
            if not rows:
                rows = [
                    CityQuest(user_id=user.id, day=day, slot=slot, snapshot=deepcopy(q))
                    for slot, q in enumerate(deal(user.id, day, fresh))
                    if q is not None
                ]
                session.add_all(rows)
                await session.commit()
    return {
        "day": day.isoformat(),
        "coins": (await economy(session))["quest_coins"],
        "items": [public(row) for row in rows],
    }


async def answer(session, user, slot, choice):
    if user.role != Role.OPERATOR:
        raise PermissionDeniedError("В предварительном просмотре задания не засчитываются")
    await lock_learner(session, user.id)
    row = await session.get(CityQuest, (user.id, today(), slot), populate_existing=True)
    if not row:
        raise NotFoundError("Задание на сегодня не найдено. Обновите город.")
    if row.answer is not None:
        raise ConflictError("На это задание уже есть ответ")
    if choice >= len(row.snapshot["options"]):
        raise DomainError("Такого ответа нет")
    row.answer, row.correct, row.answered_at = choice, choice == row.snapshot["correct"], utcnow()
    reward = (await economy(session))["quest_coins"]
    if row.correct and reward:
        row.coins = reward
        await post_transaction(
            session,
            user_id=user.id,
            amount=reward,
            tx_type=TxType.LEARNING_REWARD,
            reason="Мой город: задание дня",
            idempotency_key=f"city-quest:{user.id}:{row.day.isoformat()}:{slot}",
            meta={"quest": row.snapshot["ref"], "day": row.day.isoformat()},
        )
    await write_audit(
        session,
        actor_id=user.id,
        action="city.quest",
        entity_type="city_quest",
        entity_id=f"{row.day.isoformat()}:{slot}",
        payload={"ref": row.snapshot["ref"], "correct": row.correct},
    )
    await session.commit()
    return public(row)
