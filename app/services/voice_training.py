"""Deterministic MVP dialogue based on the brief, not an official Yandex instruction.

Rules revision 1 is deliberately fixed. New policy changes need a new revision and
an evaluator, leaving saved attempts reproducible. Speech recognition and playback
live in the browser; only the learner-reviewed text is stored here.
"""

import re
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.core.visibility import identity_filter
from app.models.enums import Role
from app.models.user import Group, User
from app.models.voice_training import VoiceTrainingAttempt
from app.services import dispatch
from app.services.learning import lock_learner
from app.services.scenarios import utc

KEY = "phone_change"
REVISION = 1
DRIVER_KEY = "kim"
INCOMING_PHONE = "+77015550192"
TITLE = "Смена номера телефона"
DESCRIPTION = (
    "Водитель просит изменить номер телефона. Найдите его учебный аккаунт, "
    "проверьте данные обращения и помогите определить следующий шаг."
)
RULES_SOURCE = "Учебные правила смены номера · CRM v2, голосовой сценарий v1"
MAX_TURNS = 24
PERSONAS = {
    "calm": "Спокойный",
    "confused": "Растерянный",
    "hurried": "Торопящийся",
    "irritated": "Раздражённый",
}
OPENING = {
    "calm": "Здравствуйте, это Виктор Ким. Хочу изменить номер телефона в аккаунте. Поможете?",
    "confused": "Здравствуйте. Это Виктор Ким. Запутался с номером в аккаунте. Как его поменять?",
    "hurried": "Здравствуйте, Виктор Ким. Мне срочно нужно поменять номер в аккаунте. Я на линии.",
    "irritated": "Это Виктор Ким. Мне надо сменить номер в аккаунте. Почему это так сложно?",
}
LOST_SIM = "Старой SIM-карты у меня больше нет. С регистрационного номера позвонить не смогу."
CONFUSED_CLARIFY = "Я запутался. Скажите ещё раз простыми словами, что именно мне сейчас сделать?"
HURRIED_CLARIFY = "Я тороплюсь. Назовите одно действие, с которого мне начать."
IRRITATED_CLARIFY = "Это мой аккаунт! Объясните, почему нельзя изменить номер по этому звонку."


async def require_scope(session, user):
    if not user.is_active or user.role not in (
        Role.TRAINEE,
        Role.OPERATOR,
        Role.TRAINER,
        Role.SUPERVISOR,
        Role.HEAD,
        Role.ADMIN,
    ):
        raise PermissionDeniedError("Голосовой тренажёр недоступен для этой учётной записи.")


def phone_digits(value):
    digits = re.sub(r"\D", "", value or "")
    return "7" + digits[1:] if len(digits) == 11 and digits.startswith("8") else digits


def normalized(text):
    return re.sub(r"\s+", " ", text.casefold().replace("ё", "е")).strip()


def clauses(text):
    return [
        part.strip()
        for part in re.split(r"[.!?;\n]+|\b(?:но|однако|зато)\b", normalized(text))
        if part.strip()
    ]


def affirmative(clause, pattern):
    """Reject a locally negated proposed action, not every sentence containing 'не'."""
    for match in re.finditer(pattern, clause):
        before = clause[max(0, match.start() - 45) : match.start()]
        if re.search(
            r"(?:\bне|нельзя|невозможно|не\s+(?:нужно|надо|стоит|можете|сможете|"
            r"получится|следует|можно|могу|смогу|буду|будем|стану|станем))\s*$",
            before,
        ):
            continue
        return True
    return False


def intents(text):
    """Conservative content patterns; an unknown wording asks for clarification.

    Critical flags require an explicit personal promise; local negation applies
    to that action. Mentioning a channel alone is not a proposed next action.
    """
    parts = clauses(text)
    result = dict.fromkeys(
        ("mismatch", "registered_call", "app", "whatsapp", "next_app", "next_whatsapp", "critical"),
        False,
    )
    for part in parts:
        registered = bool(re.search(r"регистр|зарегистр|стар\w*\s+номер", part))
        incoming = bool(re.search(r"звон|входящ|обращен|друг\w*\s+номер", part))
        differs = bool(re.search(r"не совпад|отлича|друг\w*\s+номер|несовпад", part))
        if registered and incoming and differs:
            result["mismatch"] = True
        if registered and affirmative(part, r"(?:позвон|перезвон|звонит)[а-я]*"):
            result["registered_call"] = True
        channel = re.search(r"whats\s*app|ват[сц]ап|вотсап|вацап|ватс?апп", part)
        channel_rejected = bool(
            re.search(
                r"(?:whats\s*app|ват[сц]ап|вотсап|вацап|ватс?апп).{0,25}"
                r"(?:не поможет|не надо|не нужно|не стоит|нельзя|не следует|нет смысла|бесполез)|"
                r"не\s+(?:нужно\s+|надо\s+|следует\s+)?(?:обращаться|писать|обращайтесь|пишите)",
                part,
            )
        )
        contact = affirmative(part, r"(?:напиш|пиш|обрат|свяж)[а-я]*")
        if channel and contact and not channel_rejected:
            result["whatsapp"] = True
            if re.search(r"(?:смен|измен|помен|замен)[а-я]*.{0,30}номер", part) and affirmative(
                part, r"(?:напишите|пишите|обратитесь|свяжитесь)"
            ):
                result["next_whatsapp"] = True
        change = affirmative(part, r"(?:смен|измен|помен|замен)[а-я]*")
        app_rejected = bool(
            re.search(
                r"(?:в приложении|приложение).{0,20}(?:нельзя|не получится|не поможет)|"
                r"(?:не можете|не получится|нельзя).{0,25}(?:смен|измен|помен)",
                part,
            )
        )
        app_mentioned = bool(re.search(r"приложени|(?:такси|яндекс)\s*про", part))
        if app_mentioned and "номер" in part and change and not app_rejected:
            result["app"] = True
            if affirmative(part, r"(?:откройте|зайдите|воспользуйтесь|измените|смените|поменяйте)"):
                result["next_app"] = True
        # Personal finite promises are distinct from assistance such as 'помогу разобраться'.
        promise = r"\b(?:поменяю|изменю|сменю|заменю|поменяем|изменим|сменим|заменим)\b"
        completed = r"\b(?:я|мы)\s+(?:уже\s+)?(?:сменил[аи]?|поменял[аи]?|изменил[аи]?)\b"
        capability = (
            r"\bя\s+(?:могу|сейчас\s+могу)\s+"
            r"(?:сам\s+)?(?:поменять|изменить|сменить|заменить)\b"
        )
        reported = bool(re.search(r"(?:вы сказали|вы говорите|цитирую|цитата|он сказал)", part))
        if (
            not reported
            and any(affirmative(part, p) for p in (promise, completed, capability))
            and ("номер" in part or re.search(r"\bего\b", part))
        ):
            result["critical"] = True
    return result


def operator_entries(transcript):
    return [entry for entry in transcript if entry["role"] == "operator"]


def aggregate(transcript):
    found = {}
    for entry in operator_entries(transcript):
        for key, present in intents(entry["text"]).items():
            if present:
                found.setdefault(key, entry)
    return found


def next_reply(persona, stage, transcript, text):
    """A driver cannot see the learner's actions in Work Sites."""
    current = intents(text)
    history = aggregate(transcript)
    seen = {entry["text"] for entry in transcript if entry["role"] == "driver"}
    if current["critical"]:
        return (
            "clarify" if LOST_SIM in seen else "opening",
            "Вы действительно можете поменять номер по этому звонку? Уточните способ.",
        )
    if LOST_SIM not in seen:
        meaningful = any(current[key] for key in ("mismatch", "registered_call", "app", "whatsapp"))
        limit = re.search(
            r"(?:не могу|нельзя|не получится).{0,30}(?:смен|измен|помен).{0,25}номер|ограничен",
            normalized(text),
        )
        if meaningful or limit:
            return "lost_sim", LOST_SIM
        return "opening", "Расскажите, пожалуйста, как мне изменить номер в аккаунте?"
    if current["registered_call"] and not (current["app"] or current["whatsapp"]):
        return "lost_sim", "Я же сказал, старой SIM больше нет. Какой другой способ есть?"
    if persona == "irritated" and "mismatch" not in history and not current["mismatch"]:
        return "clarify", IRRITATED_CLARIFY
    if current["app"] or current["whatsapp"]:
        if persona == "confused" and CONFUSED_CLARIFY not in seen:
            return "clarify", CONFUSED_CLARIFY
        if persona == "hurried" and current["app"] and current["whatsapp"]:
            return "clarify", HURRIED_CLARIFY
        if current["next_whatsapp"]:
            return (
                "resolved",
                "Хорошо, напишу в WhatsApp о смене номера и о том, что старой SIM нет.",
            )
        if current["next_app"]:
            return (
                "resolved",
                "Понял. Открою приложение и воспользуюсь возможностью изменить номер.",
            )
        return "next_step", "Какое действие мне сделать в этом канале, чтобы изменить номер?"
    if current["mismatch"]:
        return (
            "next_step",
            "Понял причину. Старой SIM нет, так что какой доступный шаг вы предлагаете?",
        )
    return "next_step", "Уточните, пожалуйста, какой следующий шаг вы мне предлагаете."


def attempt_data(attempt):
    """No rules, detected intents, answer keys or feedback before explicit finish."""
    return {
        "id": attempt.id,
        "scenario_key": attempt.scenario_key,
        "revision": attempt.revision,
        "title": attempt.snapshot["title"],
        "description": attempt.snapshot["description"],
        "rules_source": attempt.snapshot["rules_source"],
        "persona": attempt.persona,
        "state": attempt.state,
        "stage": attempt.stage,
        "turn": attempt.turn,
        "driver": deepcopy(attempt.snapshot["driver"]),
        "incoming_phone": attempt.snapshot["incoming_phone"],
        "transcript": deepcopy(attempt.transcript),
        "practice": {
            key: any(e["system"] == key for e in attempt.practice.get("events", []))
            for key in ("dispatch", "oktell", "compared")
        },
        "result": deepcopy(attempt.result) if attempt.state == "completed" else None,
        "can_finish": attempt.stage == "resolved",
        "retry_of": attempt.retry_of,
        "created_at": utc(attempt.created_at),
        "finished_at": utc(attempt.finished_at) if attempt.finished_at else None,
    }


async def catalog(session, user):
    await require_scope(session, user)
    attempts = list(
        await session.scalars(
            select(VoiceTrainingAttempt)
            .where(VoiceTrainingAttempt.user_id == user.id)
            .order_by(VoiceTrainingAttempt.id.desc())
        )
    )
    return {
        "scenarios": [
            {
                "key": KEY,
                "title": TITLE,
                "description": DESCRIPTION,
                "minutes": 5,
                "personas": [{"key": key, "label": label} for key, label in PERSONAS.items()],
                "revision": REVISION,
                "rules_source": RULES_SOURCE,
            }
        ],
        "attempts": [
            {
                "id": a.id,
                "scenario_key": a.scenario_key,
                "title": a.snapshot["title"],
                "persona": a.persona,
                "state": a.state,
                "stage": a.stage,
                "turn": a.turn,
                "score": a.result["score"] if a.result else None,
                "created_at": utc(a.created_at),
                "finished_at": utc(a.finished_at) if a.finished_at else None,
                "review_status": a.result.get("review_status") if a.result else None,
            }
            for a in attempts
        ],
    }


async def start(session, user, body):
    await require_scope(session, user)
    await lock_learner(session, user.id)
    await session.refresh(user)
    await require_scope(session, user)
    driver = dispatch.fold(await dispatch.history(session, user.id))["drivers"][DRIVER_KEY]
    park = dispatch.PARK_BY_ID[driver["park"]]
    if phone_digits(driver["phone"]) == phone_digits(INCOMING_PHONE):
        raise ConflictError("Учебный номер изменён. Восстановите диспетчерскую перед началом.")
    attempt = VoiceTrainingAttempt(
        user_id=user.id,
        scenario_key=KEY,
        revision=REVISION,
        persona=body.persona,
        state="in_progress",
        stage="opening",
        turn=0,
        snapshot={
            "title": TITLE,
            "description": DESCRIPTION,
            "rules_source": RULES_SOURCE,
            "driver": {
                "id": driver["id"],
                "name": dispatch.full_name(driver),
                "phone": driver["phone"],
                "park_id": park["id"],
                "park": park["name"],
                "city": park["city"],
            },
            "incoming_phone": INCOMING_PHONE,
        },
        transcript=[{"role": "driver", "text": OPENING[body.persona], "turn": 0}],
        practice={"events": []},
        requests={},
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def own_attempt(session, user, attempt_id, *, lock=False):
    await require_scope(session, user)
    if lock:
        await lock_learner(session, user.id)
        await session.refresh(user)
        await require_scope(session, user)
    attempt = await session.scalar(
        select(VoiceTrainingAttempt)
        .where(VoiceTrainingAttempt.id == attempt_id, VoiceTrainingAttempt.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    if attempt is None:
        raise NotFoundError("Попытка голосовой тренировки не найдена")
    return attempt


def require_active(attempt):
    if attempt.state != "in_progress":
        raise ConflictError("Тренировка завершена. Начните новую попытку или повторите момент.")


async def answer(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    request_id = str(body.request_id)
    payload = {"turn": body.turn, "text": body.text}
    previous = attempt.requests.get(request_id)
    if previous is not None:
        if previous != payload:
            raise ConflictError("Идентификатор ответа уже использован для другого текста.")
        return attempt
    require_active(attempt)
    if attempt.turn != body.turn:
        raise ConflictError("Ход изменился. Обновите разговор перед отправкой ответа.")
    if attempt.stage == "resolved":
        raise ConflictError("Водителю понятен следующий шаг. Завершите тренировку.")
    if attempt.turn >= MAX_TURNS:
        raise ConflictError("Достигнут предел реплик. Завершите тренировку и изучите разбор.")
    stage, reply = next_reply(attempt.persona, attempt.stage, attempt.transcript, body.text)
    attempt.transcript = [
        *attempt.transcript,
        {"role": "operator", "text": body.text, "turn": body.turn},
        {"role": "driver", "text": reply, "turn": body.turn + 1},
    ]
    attempt.stage = stage
    attempt.turn += 1
    attempt.requests = {**attempt.requests, request_id: payload}
    await session.flush()
    return attempt


async def inspect(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    require_active(attempt)
    identity = attempt.snapshot["driver"]
    driver = dispatch.fold(await dispatch.history(session, user.id))["drivers"][DRIVER_KEY]
    if (
        driver["id"] != identity["id"]
        or driver["park"] != identity["park_id"]
        or phone_digits(driver["phone"]) != phone_digits(identity["phone"])
    ):
        raise ConflictError("Данные аккаунта изменились после начала. Начните новую тренировку.")
    if body.system in ("dispatch", "compare") and (
        body.driver_id != identity["id"] or body.park_id != identity["park_id"]
    ):
        raise DomainError("Открыт другой учебный аккаунт или парк.")
    if body.system in ("oktell", "compare") and (
        phone_digits(body.incoming_phone) != phone_digits(attempt.snapshot["incoming_phone"])
    ):
        raise DomainError("Номер обращения в OKTEL не совпадает с текущей тренировкой.")
    if body.system == "compare" and (
        phone_digits(body.registration_phone) != phone_digits(identity["phone"])
    ):
        raise DomainError("Регистрационный номер не совпадает с учебным аккаунтом.")
    events = attempt.practice.get("events", [])
    if body.system == "compare" and not all(
        any(event["system"] == key for event in events) for key in ("dispatch", "oktell")
    ):
        raise ConflictError("Сначала откройте правильный аккаунт и данные звонка в OKTEL.")
    event = {
        "system": "compared" if body.system == "compare" else body.system,
        "turn": attempt.turn,
        "at": datetime.now(UTC).isoformat(),
        "driver_id": identity["id"],
        "park_id": identity["park_id"],
        "registered_phone": identity["phone"],
        "incoming_phone": attempt.snapshot["incoming_phone"],
    }
    attempt.practice = {"events": [*events, event]}
    await session.flush()
    return attempt


def criterion(key, label, passed, feedback, evidence, example):
    return {
        "key": key,
        "label": label,
        "passed": bool(passed),
        "feedback": feedback,
        "quote": evidence["text"],
        "turn": evidence["turn"],
        "role": evidence["role"],
        "example": example,
    }


def evaluate_v1(attempt):
    history = aggregate(attempt.transcript)
    operators = operator_entries(attempt.transcript)
    fallback = operators[-1] if operators else attempt.transcript[0]
    lost_turn = next(
        (
            entry["turn"]
            for entry in attempt.transcript
            if (entry["role"] == "driver" and entry["text"] == LOST_SIM)
        ),
        None,
    )
    after_sim = [
        entry for entry in operators if lost_turn is not None and entry["turn"] >= lost_turn
    ]
    alternative = next(
        (
            entry
            for entry in after_sim
            if (intents(entry["text"])["app"] or intents(entry["text"])["whatsapp"])
        ),
        None,
    )
    concrete = next(
        (
            entry
            for entry in reversed(after_sim)
            if (intents(entry["text"])["next_app"] or intents(entry["text"])["next_whatsapp"])
        ),
        None,
    )
    events = attempt.practice.get("events", [])
    practice_ok = all(
        any(e["system"] == key for e in events) for key in ("dispatch", "oktell", "compared")
    )
    critical_errors = [
        {
            "text": "Обещана прямая смена номера оператором по звонку с другого номера.",
            "quote": entry["text"],
            "turn": entry["turn"],
        }
        for entry in operators
        if intents(entry["text"])["critical"]
    ]
    solution_ok = all(key in history for key in ("registered_call", "app", "whatsapp"))
    solution_ok = solution_ok and alternative is not None and not critical_errors
    missing = [
        label
        for key, label in (
            ("registered_call", "звонок с регистрационного номера"),
            ("app", "смена в приложении"),
            ("whatsapp", "обращение в WhatsApp"),
        )
        if key not in history
    ]
    solution_feedback = "Названы допустимые способы и учтена утрата старой SIM."
    if critical_errors:
        solution_feedback = "Зафиксировано обещание недопустимой смены номера по этому звонку."
    elif missing:
        solution_feedback = "Не зафиксированы способы: " + ", ".join(missing) + "."
    elif not alternative:
        solution_feedback = "После сообщения об утрате SIM не предложена доступная альтернатива."
    criteria = [
        criterion(
            "verification",
            "Проверка данных",
            practice_ok,
            (
                "Правильный аккаунт и входящий номер сверены в учебных системах."
                if practice_ok
                else "Не зафиксированы открытие аккаунта, чтение звонка и явная сверка номеров."
            ),
            history.get("mismatch", fallback),
            "Откройте аккаунт водителя, данные звонка в OKTEL и сравните номера.",
        ),
        criterion(
            "solution",
            "Правильность решения",
            solution_ok,
            solution_feedback,
            alternative or history.get("registered_call", fallback),
            "Можно позвонить с номера регистрации, изменить номер в приложении "
            "или обратиться в WhatsApp. "
            "Если старой SIM нет, остаются приложение и WhatsApp.",
        ),
        criterion(
            "clarity",
            "Понятность объяснения",
            "mismatch" in history,
            (
                "Причина ограничения объяснена через несовпадение номеров."
                if "mismatch" in history
                else "Не объяснено, что входящий номер отличается от регистрационного."
            ),
            history.get("mismatch", fallback),
            "Вы звоните с номера, который не совпадает с регистрационным. "
            "По этому звонку изменить номер нельзя.",
        ),
        criterion(
            "next_step",
            "Конкретный следующий шаг",
            concrete is not None and attempt.stage == "resolved",
            (
                "Водитель подтвердил понятный и доступный следующий шаг."
                if concrete is not None and attempt.stage == "resolved"
                else "Не зафиксированы доступный шаг и подтверждение понимания водителем."
            ),
            concrete or fallback,
            "Напишите в WhatsApp, что хотите изменить номер и что старой SIM-карты больше нет.",
        ),
    ]
    score = sum(25 for item in criteria if item["passed"])
    return {
        "score": min(score, 50) if critical_errors else score,
        "criteria": criteria,
        "critical_errors": critical_errors,
        "rules_revision": attempt.revision,
        "assessment_note": (
            "Оценка содержания по учебным шаблонам. Интонация и темп не оцениваются."
        ),
        "review_status": None,
    }


async def finish(session, user, attempt_id):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    if attempt.state == "completed":
        return attempt
    evaluators = {1: evaluate_v1}
    evaluator = evaluators.get(attempt.revision)
    if evaluator is None:
        raise ConflictError("Версия правил недоступна. Обратитесь к наставнику.")
    attempt.result = evaluator(attempt)
    attempt.state = "completed"
    attempt.finished_at = datetime.now(UTC)
    await session.flush()
    return attempt


async def retry(session, user, attempt_id, body):
    original = await own_attempt(session, user, attempt_id, lock=True)
    if original.state != "completed":
        raise ConflictError("Сначала завершите тренировку и откройте разбор.")
    if not any(
        entry["role"] == "operator" and entry["turn"] == body.turn for entry in original.transcript
    ):
        raise DomainError("В разговоре нет указанного ответа оператора.")
    prefix = [
        deepcopy(entry)
        for entry in original.transcript
        if (entry["turn"] < body.turn or (entry["turn"] == body.turn and entry["role"] == "driver"))
    ]
    # Derive state using the same versioned dialogue, never trust a client stage.
    stage, replay = "opening", [deepcopy(original.transcript[0])]
    for entry in operator_entries(prefix):
        stage, _ = next_reply(original.persona, stage, replay, entry["text"])
        replay.extend(
            [
                entry,
                next(
                    item
                    for item in prefix
                    if item["role"] == "driver" and item["turn"] == entry["turn"] + 1
                ),
            ]
        )
    attempt = VoiceTrainingAttempt(
        user_id=user.id,
        scenario_key=original.scenario_key,
        revision=original.revision,
        persona=original.persona,
        state="in_progress",
        stage=stage,
        turn=body.turn,
        snapshot=deepcopy(original.snapshot),
        transcript=prefix,
        requests={},
        # Earlier verified actions are copied with explicit origin; later actions must be repeated.
        practice={
            "events": [
                {**deepcopy(event), "copied_from": original.id}
                for event in original.practice.get("events", [])
                if event["turn"] <= body.turn
            ]
        },
        retry_of=original.id,
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def review(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    if attempt.state != "completed":
        raise ConflictError("Обсудить оценку можно после завершения тренировки.")
    if attempt.review:
        if attempt.review["comment"] != body.comment:
            raise ConflictError("Запрос на проверку уже сохранён для этой попытки.")
        return attempt
    attempt.review = {"comment": body.comment, "created_at": datetime.now(UTC).isoformat()}
    attempt.result = {**attempt.result, "review_status": "pending"}
    await session.flush()
    return attempt


def mentor_query(user):
    if not user.is_active or user.role not in (
        Role.TRAINER,
        Role.SUPERVISOR,
        Role.HEAD,
        Role.ADMIN,
    ):
        raise PermissionDeniedError("Проверка оценок доступна наставникам.")
    query = (
        select(VoiceTrainingAttempt, User)
        .join(User, User.id == VoiceTrainingAttempt.user_id)
        .where(VoiceTrainingAttempt.review.is_not(None), identity_filter(user, User))
    )
    if user.role == Role.SUPERVISOR:
        query = query.where(
            User.group_id.in_(
                select(Group.id).where(Group.supervisor_id == user.id, Group.is_active.is_(True))
            )
        )
    return query


async def reviews(session, user):
    rows = (
        await session.execute(mentor_query(user).order_by(VoiceTrainingAttempt.id.desc()))
    ).all()
    return {
        "reviews": [
            {
                "attempt_id": attempt.id,
                "user_id": learner.id,
                "user_name": learner.full_name,
                "group_id": learner.group_id,
                "title": attempt.snapshot["title"],
                "score": attempt.result["score"],
                "comment": attempt.review["comment"],
                "requested_at": attempt.review["created_at"],
                "status": attempt.result["review_status"],
            }
            for attempt, learner in rows
            if attempt.review
        ]
    }


async def mentor_attempt(session, user, attempt_id):
    row = (
        await session.execute(
            mentor_query(user)
            .where(VoiceTrainingAttempt.id == attempt_id)
            .execution_options(populate_existing=True)
        )
    ).first()
    if row is None or not row[0].review:
        raise NotFoundError("Запрос на проверку не найден.")
    return row


def mentor_data(attempt, learner):
    return {
        **attempt_data(attempt),
        "learner": {"id": learner.id, "name": learner.full_name, "group_id": learner.group_id},
        "review": deepcopy(attempt.review),
    }


async def review_detail(session, user, attempt_id):
    return mentor_data(*await mentor_attempt(session, user, attempt_id))


async def resolve_review(session, user, attempt_id, body):
    attempt, learner = await mentor_attempt(session, user, attempt_id)
    await lock_learner(session, learner.id)
    attempt, learner = await mentor_attempt(session, user, attempt_id)
    if attempt.result["review_status"] == "reviewed":
        if attempt.result["mentor_comment"] != body.comment:
            raise ConflictError("Проверка уже завершена другим ответом.")
        return mentor_data(attempt, learner)
    attempt.result = {
        **attempt.result,
        "review_status": "reviewed",
        "mentor_comment": body.comment,
        "reviewed_at": datetime.now(UTC).isoformat(),
        "mentor_name": user.full_name,
    }
    await session.flush()
    return mentor_data(attempt, learner)
