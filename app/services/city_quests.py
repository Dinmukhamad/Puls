"""Daily situations on the city map: three a day, answered once each, right in the city.

A day's situations repeat questions from materials the operator has already passed (review of what
was learned, so a new test's answers are never given away); a small built-in set of work situations
fills in when there are too few. The question is frozen when the day is dealt, the answer is checked
here, and a right answer pays a few coins once, with a key that cannot pay twice.
"""

import random
from copy import deepcopy
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import settings
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.db.base import utcnow
from app.models.city import CityQuest
from app.models.enums import Role, TxType
from app.models.learning import LearningAward, LearningContent
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


def bank_questions():
    return [
        {
            "source": "bank",
            "ref": f"bank-{i}",
            "title": "Рабочая ситуация",
            "speaker": speaker,
            "text": text,
            "options": options,
            "correct": correct,
            "explanation": explanation,
        }
        for i, (speaker, text, options, correct, explanation) in enumerate(BANK)
    ]


async def review_questions(session, user_id):
    """Questions from the published tests and missions the operator has already passed."""
    passed = select(LearningAward.content_id).where(LearningAward.user_id == user_id)
    contents = await session.scalars(
        select(LearningContent).where(
            LearningContent.id.in_(passed),
            LearningContent.status == "published",
            LearningContent.kind != "simulator",
        )
    )
    return [
        {
            "source": "review",
            "ref": f"content-{content.id}-{content.revision}-{i}",
            "title": content.title,
            "speaker": step.get("speaker") or "",
            "text": step["text"],
            "options": list(step["options"]),
            "correct": step["correct"],
            "explanation": step.get("explanation") or "",
        }
        for content in contents
        for i, step in enumerate(content.steps or [])
    ]


def deal(user_id, day, review, bank):
    """The day's questions: review first, the bank for the rest; the same for the same day."""
    rng = random.Random(f"{user_id}:{day.isoformat()}")
    picks = rng.sample(review, min(SLOTS, len(review)))
    picks += rng.sample(bank, SLOTS - len(picks))
    # Drivers' questions wait at the depot's taxi, callers' at the CRM centre, others at the guide.
    wants = ("водител", "клиент")
    slots = [None] * SLOTS
    for want, slot in zip(wants, range(SLOTS), strict=False):
        match = next((q for q in picks if q not in slots and want in q["speaker"].lower()), None)
        slots[slot] = match
    rest = iter(q for q in picks if q not in slots)
    picks = [q if q is not None else next(rest) for q in slots]
    # The options come in a new order each time, so the right one cannot be learnt by its place.
    dealt = []
    for q in picks:
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
    """Today's situations; the first read of the day deals them (never for staff)."""
    if user.role != Role.OPERATOR:
        return None
    day = today()
    rows = await rows_for(session, user.id, day)
    if not rows and not inspecting:
        await lock_learner(session, user.id)
        rows = await rows_for(session, user.id, day)
        if not rows:
            picks = deal(user.id, day, await review_questions(session, user.id), bank_questions())
            rows = [
                CityQuest(user_id=user.id, day=day, slot=slot, snapshot=deepcopy(q))
                for slot, q in enumerate(picks)
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
