"""Versioned, contextual dialogue based on the approved training rules.

Revision 1 remains fixed so saved attempts and retries stay reproducible. Revision 2
follows the channel offered by the learner instead of requiring a scripted order.
Only the learner-reviewed text is stored here.
"""

import random
import re
from collections import namedtuple
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.core.visibility import identity_filter
from app.models.enums import Role
from app.models.user import Group, User
from app.models.voice_training import VoiceTrainingAttempt
from app.schemas.voice_training import VoiceRetry, VoiceStart
from app.services import dispatch, voice_ai, voice_scenarios
from app.services.learning import lock_learner
from app.services.scenarios import support_allowed, utc

KEY = "phone_change"
REVISION = 3
DRIVER_KEY = "kim"
INCOMING_PHONE = "+77015550192"
TITLE = "Смена номера телефона"
DESCRIPTION = (
    "Водитель просит изменить номер телефона. Найдите его учебный аккаунт, "
    "проверьте данные обращения и помогите определить следующий шаг."
)
RULES_SOURCE = "Учебные правила смены номера · CRM v2, голосовой сценарий v2"
MAX_TURNS = 24
PERSONAS = {
    "calm": "Спокойный",
    "confused": "Растерянный",
    "hurried": "Торопящийся",
    "irritated": "Раздражённый",
    "aggressive": "Агрессивный",
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


def can_call(user):
    return user.is_active and user.role in (
        Role.TRAINEE,
        Role.OPERATOR,
        Role.TRAINER,
        Role.SUPERVISOR,
        Role.HEAD,
        Role.ADMIN,
    )


async def require_scope(session, user):
    if not can_call(user):
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


APP_CHANNEL = r"приложени[а-я]*|(?:такси|яндекс|taxi|yandex)[\s-]*(?:про|pro)\b"
WHATSAPP_CHANNEL = r"whats\s*app|ват[сц]ап|вотсап|вацап|ватс?апп"
CHANGE_ACTION = r"(?:смен[а-я]*|измен[а-я]*|помен[а-я]*|замен[а-я]*|обнов[а-я]*)"
CHANGE_NUMBER = rf"(?:{CHANGE_ACTION}.{{0,45}}(?:номер|телефон)|(?:номер|телефон).{{0,45}}{CHANGE_ACTION})"
CHANGE_COMMAND = r"\b(?:измените|смените|поменяйте|замените|обновите)\b"
OPEN_APP = r"\b(?:откройте|зайдите|войдите|воспользуйтесь|перейдите|запустите)\b"
CONTACT = r"\b(?:напиш[а-я]*|пиш[а-я]*|обрат[а-я]*|свяж[а-я]*|сообщ[а-я]*)\b"
ADVICE_COMMAND = r"\b(?:вы можете|вам нужно|вам надо|нужно|необходимо|следует|попробуйте|рекомендую)\b"


def unsafe_account_action_v2(text):
    deletion = r"(?:удал[а-я]*|сотр[а-я]*|стер[а-я]*).{0,25}?аккаунт"
    for part in clauses(text):
        for match in re.finditer(deletion, part):
            if not affirmative(part[: match.end()], rf"{deletion}$"):
                continue
            # Quoting a dangerous button in a warning does not recommend it.
            before = part[: match.start()]
            if re.search(
                r"\bне\s+(?:нажимайте|нажмите|выбирайте|выберите)\s+"
                r"(?:(?:на\s+)?(?:кнопку|пункт|команду)\s*)?[«\"“']?\s*$",
                before,
            ):
                continue
            return True
    return False


def advice_v2(text, channel=None):
    """Extract a proposed action, retaining its channel across short follow-ups.

    A mentioned product, a question or a negated action cannot complete a step.
    No application menu names are required: the approved rule only says that the
    driver can change the number in the application.
    """
    base = intents(text)
    result = {
        "mismatch": base["mismatch"],
        "critical": base["critical"],
        "offers": [],
        "steps": set(),
        "rejected": set(),
        "focus": None,
        "unsafe": unsafe_account_action_v2(text),
    }
    clean = re.sub(
        r"\b(такси|яндекс|taxi|yandex)\s*\.\s*(про|pro)\b", r"\1 \2", normalized(text)
    )
    parts = [
        part.strip()
        for part in re.split(
            r"(?<=[.!?;])|\n+|\b(?:но|однако|зато|или|либо)\b|,\s*(?=(?:а\s|лучше\s|вместо\s))",
            clean,
        )
        if part.strip()
    ]
    active_channel = channel
    for part in parts:
        mentioned = {
            "app": re.search(APP_CHANNEL, part),
            "whatsapp": re.search(WHATSAPP_CHANNEL, part),
        }
        change = affirmative(part, CHANGE_NUMBER)
        # Purpose can precede the action: «для смены номера напишите туда».
        purpose = bool(re.search(CHANGE_NUMBER, part))
        rejected = {
            "app": bool(
                mentioned["app"]
                and re.search(
                    rf"(?:не\s+(?:нужно\s+|надо\s+|стоит\s+|следует\s+)?"
                    rf"(?:открыва[а-я]*|заход[а-я]*|использ[а-я]*|польз[а-я]*|меня[а-я]*|изменя[а-я]*)"
                    rf".{{0,35}}(?:{APP_CHANNEL})|"
                    rf"(?:{APP_CHANNEL}).{{0,35}}(?:не работает|не открыва[а-я]*|не поможет|"
                    r"нельзя|невозможно|не получится|не надо|не нужно|не стоит|недоступ[а-я]*|"
                    r"не\s+(?:меняйте|изменяйте|сменяйте|поменяйте|измените|смените|открывайте)))",
                    part,
                )
            ),
            "whatsapp": bool(
                mentioned["whatsapp"]
                and re.search(
                    rf"(?:не\s+(?:нужно\s+|надо\s+|стоит\s+|следует\s+)?"
                    rf"(?:пиш[а-я]*|писать|обращ[а-я]*|связыв[а-я]*)"
                    rf".{{0,35}}(?:{WHATSAPP_CHANNEL})|"
                    rf"(?:{WHATSAPP_CHANNEL}).{{0,35}}(?:не поможет|не надо|не нужно|не стоит|"
                    r"нельзя|невозможно|нет смысла|бесполез|недоступ[а-я]*|"
                    r"не\s+(?:пишите|обращайтесь|обратитесь|напишите)))",
                    part,
                )
            ),
        }
        # «Нельзя изменить номер в приложении» also rejects a postposed channel.
        if mentioned["app"] and re.search(
            rf"(?:нельзя|невозможно|не получится|не можете|не сможете).{{0,30}}"
            rf"(?:смен|измен|помен|замен)[а-я]*.{{0,35}}(?:{APP_CHANNEL})",
            part,
        ):
            rejected["app"] = True
        for name, pattern in (("app", APP_CHANNEL), ("whatsapp", WHATSAPP_CHANNEL)):
            if re.search(rf"\bвместо\s+(?:{pattern})", part):
                rejected[name] = True
        if not any(mentioned.values()) and active_channel:
            negated = (
                r"\bне\s+(?:нужно\s+|надо\s+|следует\s+)?"
                r"(?:пишите|пиш[а-я]*|обращайтесь|обращаться)"
                if active_channel == "whatsapp"
                else r"\bне\s+(?:нужно\s+|надо\s+|следует\s+)?"
                r"(?:меняйте|изменяйте|менять|изменять|открывайте|открывать)"
            )
            if re.search(negated, part):
                rejected[active_channel] = True
        for name, is_rejected in rejected.items():
            if is_rejected:
                result["rejected"].add(name)
                result["offers"] = [item for item in result["offers"] if item != name]
                result["steps"].discard(name)
                if active_channel == name:
                    active_channel = None
        explicit = sorted(
            (name for name, match in mentioned.items() if match),
            key=lambda name: mentioned[name].start(),
        )
        correction = bool(re.search(r"\b(?:лучше|вместо|тогда|предлагаю|давайте)\b", part))
        for name in explicit:
            if rejected[name]:
                continue
            if "?" in part:
                result["focus"] = name
                active_channel = name
                continue
            actionable = (
                (change or affirmative(part, OPEN_APP))
                if name == "app"
                else affirmative(part, CONTACT)
            )
            if actionable or correction:
                if name not in result["offers"]:
                    result["offers"].append(name)
                result["rejected"].discard(name)
        # Short references only inherit an established channel. «Напишите туда»
        # on the first turn does not invent WhatsApp, nor does «измените его»
        # invent an application.
        target = next(
            (name for name in explicit if name in result["offers"]),
            active_channel if not explicit else None,
        )
        if "?" in part:
            continue
        if target == "app" and not rejected["app"]:
            command = affirmative(part, CHANGE_COMMAND)
            open_and_change = affirmative(part, OPEN_APP) and change
            modal_advice = affirmative(part, ADVICE_COMMAND) and change and "?" not in part
            if (
                (command and (purpose or re.search(r"\b(?:его|там)\b", part)))
                or open_and_change
                or modal_advice
            ):
                result["steps"].add("app")
                if "app" not in result["offers"]:
                    result["offers"].append("app")
        if target == "whatsapp" and not rejected["whatsapp"]:
            contact = affirmative(part, CONTACT)
            if contact and purpose:
                result["steps"].add("whatsapp")
                if "whatsapp" not in result["offers"]:
                    result["offers"].append("whatsapp")
        if result["offers"]:
            active_channel = result["offers"][-1]
    result["registered_call"] = False
    for part in clauses(text):
        if not re.search(r"регистр|зарегистр|стар[а-я]*\s+номер", part):
            continue
        # A description of this incoming call is not a request to call again.
        request = re.sub(r"\bвы\s+(?:сейчас\s+)?звоните\b", "", part)
        if affirmative(
            request, r"\b(?:позвоните|перезвоните|позвонить|перезвонить|звоните|звонить)\b"
        ):
            result["registered_call"] = True
    return result


LOST_LINES = {"lost_sim", "lost_sim_again"}


def dialogue_state_v2(transcript, advice=advice_v2):
    """Rebuild small, reviewable memory from saved utterances, never client state."""
    state = {
        "channel": None,
        "offer": None,
        "step": None,
        "mismatch": None,
        "lost_sim": False,
        "critical": [],
        "unsafe": [],
    }
    for entry in transcript:
        if entry["role"] == "driver":
            # Revision 3 marks its lines; revision 2 is recognised by its fixed words.
            if (
                entry.get("line") in LOST_LINES
                or entry["text"] == LOST_SIM
                or "Я же сказал, старой SIM" in entry["text"]
            ):
                state["lost_sim"] = True
            continue
        current = advice(entry["text"], state["channel"])
        if current["mismatch"]:
            state["mismatch"] = entry
        if current["critical"]:
            state["critical"].append(entry)
            continue
        if current["unsafe"]:
            state["unsafe"].append(entry)
            continue
        if state["channel"] in current["rejected"]:
            state.update(channel=None, offer=None, step=None)
        if current["registered_call"] and not current["offers"]:
            state.update(channel=None, offer=None, step=None)
        if current["focus"] and not current["offers"]:
            if state["channel"] != current["focus"]:
                state.update(channel=current["focus"], offer=None, step=None)
        if current["offers"]:
            chosen = next(
                (name for name in reversed(current["offers"]) if name in current["steps"]),
                (
                    state["channel"]
                    if state["channel"] in current["offers"]
                    else current["offers"][0]
                ),
            )
            if chosen != state["channel"]:
                state.update(channel=chosen, offer=entry, step=None)
            else:
                state["offer"] = entry
            if chosen in current["steps"]:
                state["step"] = entry
    return state


def _identity(snapshot):
    snapshot = snapshot or {}
    driver = snapshot.get("driver", {})
    return {
        "name": driver.get("name", "Ким Виктор Андреевич"),
        "incoming": snapshot.get("incoming_phone", INCOMING_PHONE),
        "phone": driver.get("phone"),
    }


def driver_fact_v2(text, snapshot=None):
    """Ordinary verification questions, answered from the attempt's own scenario data."""
    value = normalized(text)
    identity = _identity(snapshot)
    if re.search(r"как.{0,12}вас зовут|назовите.{0,20}(?:фио|фамили|имя)|представьтесь", value):
        return "fact_name", identity
    if re.search(
        r"(?:с какого|назовите|какой).{0,25}(?:номер|телефон).{0,25}(?:звон|обращ)", value
    ):
        return "fact_incoming", identity
    if identity["phone"] and re.search(
        r"(?:какой|назовите|подскажите).{0,30}(?:регистрацион|стар[а-я]*\s+номер|номер.{0,20}регистрац)",
        value,
    ):
        return "fact_registered", identity
    if re.search(
        r"(?:есть|остал[а-я]*|доступ[а-я]*|можете).{0,25}(?:стар[а-я]*\s+(?:sim|сим|номер)|"
        r"регистрацион[а-я]*\s+номер)|(?:стар[а-я]*\s+(?:sim|сим|номер)).{0,25}(?:есть|доступ|остал)",
        value,
    ) and ("?" in text or re.search(r"\b(?:подскажите|скажите|у вас)\b", value)):
        return "lost_sim", identity
    return None


RU_LIMIT = r"(?:не могу|нельзя|не получится).{0,40}(?:смен|измен|помен)|ограничен"
Analyzer = namedtuple("Analyzer", "advice fact limit")


def reply_plan(persona, stage, transcript, text, snapshot, analyzer):
    """The driver's next move as a line key; each revision says it in its own words."""
    previous = dialogue_state_v2(transcript, analyzer.advice)
    current = analyzer.advice(text, previous["channel"])
    state = dialogue_state_v2(
        [*transcript, {"role": "operator", "text": text, "turn": 0}], analyzer.advice
    )
    if current["critical"]:
        return "clarify", "critical", {}
    if current["unsafe"]:
        return "clarify", "unsafe", {}
    fact = analyzer.fact(text, snapshot)
    if fact and not current["offers"]:
        key, params = fact
        return ("lost_sim" if key == "lost_sim" else stage), key, params
    if current["focus"] == "app" and not current["offers"]:
        return "next_step", "focus_app", {}
    if current["focus"] == "whatsapp" and not current["offers"]:
        return "next_step", "focus_whatsapp", {}
    channel = state["channel"]
    if channel and channel in current["steps"]:
        return "resolved", f"resolved_{channel}", {}
    if channel == "app":
        if persona == "confused":
            return "clarify", "app_confused", {}
        if persona == "hurried":
            return "next_step", "app_hurried", {}
        return "next_step", "app_next", {}
    if channel == "whatsapp":
        if persona == "confused":
            return "clarify", "whatsapp_confused", {}
        return "next_step", "whatsapp_next", {}
    if current["registered_call"]:
        return "lost_sim", ("lost_sim_again" if previous["lost_sim"] else "lost_sim"), {}
    if current["mismatch"]:
        return "next_step", "mismatch", {}
    if current["rejected"]:
        return "next_step", "rejected", {}
    if analyzer.limit(text):
        return "next_step", "limit", {}
    return "opening", "ask_how", {}


V2_LINES = {
    "critical": "Вы действительно можете поменять номер по этому звонку? Уточните способ.",
    "unsafe": "Вы предлагаете удалить аккаунт? Мне нужно изменить номер. "
    "Уточните безопасный способ.",
    "fact_name": "Меня зовут {name}.",
    "fact_incoming": "Сейчас звоню с номера {incoming}.",
    "fact_registered": "В аккаунте зарегистрирован номер {phone}.",
    "lost_sim": LOST_SIM,
    "lost_sim_again": "Я же сказал, старой SIM больше нет. Какой другой способ есть?",
    "focus_app": "Могу открыть Такси Про. Что мне дальше сделать в приложении?",
    "focus_whatsapp": "Могу написать в WhatsApp. Что именно нужно сообщить?",
    "resolved_app": "Понял. Открою Такси Про и изменю номер в приложении.",
    "resolved_whatsapp": "Хорошо, напишу в WhatsApp, что хочу изменить номер телефона.",
    "app_confused": "Хорошо, Такси Про. Объясните простыми словами: что мне сделать в приложении?",
    "app_hurried": "Хорошо, выбираю Такси Про. Назовите одно действие, с которого мне начать.",
    "app_next": "Вы предлагаете Такси Про. Что мне сейчас сделать в приложении, "
    "чтобы изменить номер?",
    "whatsapp_confused": "Хорошо, WhatsApp. Объясните простыми словами: "
    "что именно мне туда написать?",
    "whatsapp_next": "Хорошо, обращусь в WhatsApp. Что именно мне написать о смене номера?",
    "mismatch": "Понял, входящий номер отличается от регистрационного. "
    "Как мне теперь изменить номер?",
    "rejected": "Этот способ не подходит. Какой доступный шаг вы предлагаете вместо него?",
    "limit": "Понял, по этому звонку нельзя. Каким способом я могу изменить номер?",
    "ask_how": "Расскажите, пожалуйста, как мне изменить номер в аккаунте?",
}
RU = Analyzer(advice_v2, driver_fact_v2, lambda text: bool(re.search(RU_LIMIT, normalized(text))))


def driver_fact_reply_v2(text, snapshot=None):
    fact = driver_fact_v2(text, snapshot)
    return V2_LINES[fact[0]].format(**fact[1]) if fact else None


def next_reply_v2(persona, stage, transcript, text, snapshot=None):
    stage, key, params = reply_plan(persona, stage, transcript, text, snapshot, RU)
    return stage, V2_LINES[key].format(**params)


# --- Revision 3: the driver speaks in character, in Russian or Kazakh -----------------

KZ_LETTERS = {
    "ә": "[әа]", "ғ": "[ғг]", "қ": "[қк]", "ң": "[ңн]", "ө": "[өо]",
    "ұ": "[ұу]", "ү": "[үу]", "і": "[іи]", "һ": "[һх]",
}


def kz(pattern):
    """Kazakh letters also match their Russian look-alikes: typed answers often lack them."""
    return "".join(KZ_LETTERS.get(char, char) for char in pattern)


KK_NUMBER = r"нөмір|номер|телефон"
KK_CHANGE = r"ауыстыр|өзгерт|алмастыр|жаңарт|смен|измен|помен|замен"
KK_CHANGE_NUMBER = (
    rf"(?:(?:{KK_NUMBER})\S*.{{0,45}}(?:{KK_CHANGE})|(?:{KK_CHANGE})\S*.{{0,45}}(?:{KK_NUMBER}))"
)
KK_APP = r"қосымша|приложени|бағдарлама|(?:такси|яндекс|taxi|yandex)[\s.-]*(?:про|pro)\b"
KK_WHATSAPP = r"whats\s*app|ват[сц]ап|вотсап|вацап|ватс?апп|уатсап"
KK_OPEN = (
    r"\b(?:ашыңыз|ашып|кіріңіз|кіріп|өтіңіз|пайдаланыңыз|пайдаланып|қолданыңыз|қолданып|"
    r"откройте|зайдите)"
)
KK_CONTACT = (
    r"\b(?:жазыңыз|жазып|жазсаңыз|жазу\S*|хабарласыңыз|хабарласу\S*|хабарлама\S*|жолдаңыз|"
    r"жіберіңіз|напишите|обратитесь)"
)
KK_CHANGE_COMMAND = (
    r"\b(?:ауыстырыңыз|өзгертіңіз|алмастырыңыз|жаңартыңыз|(?:ауыстырып|өзгертіп)\s+алыңыз|"
    r"измените|смените|поменяйте)"
)
KK_ADVICE = r"\b(?:керек|қажет|болады|аласыз|ұсынамын|көріңіз)"
KK_REJECT = (
    r"болмайды|мүмкін\s+емес|жұмыс\s+істемейді|ашылмайды|көмектеспейді|керек\s+емес|"
    r"қажет\s+емес|қажеті\s+жоқ|керегі\s+жоқ|(?:ауыстыра|өзгерте)\s+алмайсыз|жарамайды"
)
# Kazakh negates after the verb: «ауыстыруға болмайды», «өзгерте алмайсыз», «жазбаңыз».
KK_NEG_AFTER = (
    r"^\S*\s*(?:емес|болмайды|болмас|жоқ|мүмкін\s+емес|келмейді|алмайсыз|алмайды|алмаймын|"
    r"көмектеспейді|жарамайды|қажеті\s+жоқ|керегі\s+жоқ)"
)
KK_NEG_SUFFIX = r"^(?:ма|ме|ба|бе|па|пе)(?:ңыз|ңдар|йсыз|йды|ймын|ған|ген|у)"
KK_PROMISE = (
    r"\b(?:ауыстырамын|өзгертемін|ауыстырамыз|өзгертеміз|ауыстырдым|өзгерттім|ауыстырдық|"
    r"өзгерттік|(?:ауыстырып|өзгертіп)\s+(?:беремін|береміз|қоямын|қоямыз|қойдым|қойдық))\b"
)
KK_REGISTERED = r"тіркел|тіркеу|ескі\s+нөмір|регистр|стар\S*\s+номер"
KK_LIMIT = (
    r"(?:бұл|осы)\s+қоңырау.{0,40}(?:болмайды|мүмкін\s+емес)|(?:ауыстыруға|өзгертуге)\s+болмайды|"
    r"(?:ауыстыра|өзгерте)\s+алмаймын|шектеу"
)


def kk_affirmative(part, pattern):
    """A match that the following words or the verb's own suffix do not negate."""
    for match in re.finditer(kz(pattern), part):
        rest = part[match.end():]
        if re.match(kz(KK_NEG_SUFFIX), rest) or re.match(kz(KK_NEG_AFTER), rest):
            continue
        return True
    return False


def kk_unsafe(value):
    deletion = kz(r"аккаунт\S*\s+(?:өшіріңіз|өшіріп|өшіру\S*|жойыңыз|жойып|жою\S*)")
    for match in re.finditer(deletion, value):
        # Naming the dangerous button in a warning does not recommend it.
        warning = kz(r"^.{0,40}?(?:баспаңыз|таңдамаңыз|болмайды|керек\s+емес)")
        if re.match(warning, value[match.end():]):
            continue
        return True
    return False


def advice_kk_only(text, channel=None):
    """The Kazakh counterpart of advice_v2: channels, steps and refusals in Kazakh words."""
    value = normalized(text)
    result = {
        "mismatch": False,
        "critical": False,
        "offers": [],
        "steps": set(),
        "rejected": set(),
        "focus": None,
        "unsafe": kk_unsafe(value),
        "registered_call": False,
    }
    parts = [
        part.strip()
        for part in re.split(
            kz(
                r"(?<=[.!?;])|\n+|\b(?:бірақ|алайда|немесе|әйтпесе|ал|но|однако|или|либо)\b|"
                r",\s*(?=(?:бұл\s|осы\s|себебі\s|өйткені\s|оның\s+орнына\s|жақсырақ\s))"
            ),
            value,
        )
        if part.strip()
    ]
    active = channel
    for part in parts:
        question = "?" in part or bool(re.search(kz(r"\s(?:ма|ме|ба|бе|па|пе)\s*$"), part))
        mentioned = {
            "app": re.search(kz(KK_APP), part),
            "whatsapp": re.search(kz(KK_WHATSAPP), part),
        }
        change = kk_affirmative(part, KK_CHANGE_NUMBER)
        purpose = bool(re.search(kz(KK_CHANGE_NUMBER), part))
        rejected = {
            "app": bool(
                mentioned["app"]
                and (
                    re.search(kz(rf"(?:{KK_APP})\S*.{{0,40}}(?:{KK_REJECT})"), part)
                    or re.search(kz(rf"(?:{KK_APP})\S*\s+(?:емес|орнына)"), part)
                    or re.search(kz(r"\b(?:ашпаңыз|кірмеңіз|пайдаланбаңыз|қолданбаңыз)"), part)
                )
            ),
            "whatsapp": bool(
                mentioned["whatsapp"]
                and (
                    re.search(
                        kz(rf"(?:{KK_WHATSAPP})\S*.{{0,40}}(?:{KK_REJECT}|мағынасы\s+жоқ|пайдасы\s+жоқ)"),
                        part,
                    )
                    or re.search(kz(rf"(?:{KK_WHATSAPP})\S*\s+(?:емес|орнына)"), part)
                    or re.search(kz(r"\b(?:жазбаңыз|хабарласпаңыз)"), part)
                )
            ),
        }
        if not any(mentioned.values()) and active:
            negated = (
                r"\b(?:жазбаңыз|хабарласпаңыз)"
                if active == "whatsapp"
                else r"\b(?:ауыстырмаңыз|өзгертпеңіз|ашпаңыз)"
            )
            if re.search(kz(negated), part):
                rejected[active] = True
        for name, is_rejected in rejected.items():
            if is_rejected:
                result["rejected"].add(name)
                result["offers"] = [item for item in result["offers"] if item != name]
                result["steps"].discard(name)
                if active == name:
                    active = None
        explicit = sorted(
            (name for name, match in mentioned.items() if match),
            key=lambda name: mentioned[name].start(),
        )
        correction = bool(
            re.search(
                kz(r"\b(?:жақсырақ|онда|ұсынамын|дұрысы|лучше|вместо|тогда|предлагаю)\b"), part
            )
        )
        for name in explicit:
            if rejected[name]:
                continue
            if question:
                result["focus"] = name
                active = name
                continue
            actionable = (
                (change or kk_affirmative(part, KK_OPEN))
                if name == "app"
                else kk_affirmative(part, KK_CONTACT)
            )
            if actionable or correction:
                if name not in result["offers"]:
                    result["offers"].append(name)
                result["rejected"].discard(name)
        target = next(
            (name for name in explicit if name in result["offers"]),
            active if not explicit else None,
        )
        if question:
            continue
        if target == "app" and not rejected["app"]:
            command = kk_affirmative(part, KK_CHANGE_COMMAND)
            there = re.search(kz(r"\b(?:оны|сонда|сол\s+жерде|онда)\b"), part)
            if (
                (command and (purpose or there))
                or (kk_affirmative(part, KK_OPEN) and change)
                or (kk_affirmative(part, KK_ADVICE) and change)
            ):
                result["steps"].add("app")
                if "app" not in result["offers"]:
                    result["offers"].append("app")
        if (
            target == "whatsapp"
            and not rejected["whatsapp"]
            and kk_affirmative(part, KK_CONTACT)
            and purpose
        ):
            result["steps"].add("whatsapp")
            if "whatsapp" not in result["offers"]:
                result["offers"].append("whatsapp")
        if result["offers"]:
            active = result["offers"][-1]
    for part in re.split(kz(r"[.!?;\n]+|\b(?:бірақ|алайда|немесе|ал|но|однако)\b"), value):
        registered = re.search(kz(KK_REGISTERED), part)
        incoming = re.search(
            kz(r"хабарлас|қоңырау|звон|входящ|қазіргі\s+нөмір|басқа\s+нөмір"), part
        )
        differs = re.search(
            kz(r"сәйкес\s+келмей|сәйкес\s+емес|басқа|өзгеше|бөлек|не\s+совпад|отлича"), part
        )
        if registered and incoming and differs:
            result["mismatch"] = True
        if (
            registered
            and not re.search(kz(KK_WHATSAPP), part)
            and kk_affirmative(
                part, r"\b(?:қоңырау\s+шалыңыз|шалып\s+көріңіз|хабарласыңыз|позвоните|перезвоните)"
            )
        ):
            result["registered_call"] = True
        if kk_affirmative(part, KK_PROMISE) and re.search(kz(rf"{KK_NUMBER}|\bоны\b"), part):
            result["critical"] = True
    return result


def advice_kk(text, channel=None):
    """Kazakh calls often switch to Russian words, so both readings are combined."""
    kk, ru = advice_kk_only(text, channel), advice_v2(text, channel)
    offers = list(dict.fromkeys([*kk["offers"], *ru["offers"]]))
    return {
        "mismatch": kk["mismatch"] or ru["mismatch"],
        "critical": kk["critical"] or ru["critical"],
        "unsafe": kk["unsafe"] or ru["unsafe"],
        "registered_call": kk["registered_call"] or ru["registered_call"],
        "offers": offers,
        "steps": kk["steps"] | ru["steps"],
        "rejected": (kk["rejected"] | ru["rejected"]) - set(offers),
        "focus": kk["focus"] or ru["focus"],
    }


def driver_fact_kk(text, snapshot=None):
    value = normalized(text)
    identity = _identity(snapshot)
    if re.search(kz(r"атыңыз|аты-жөн|аты\s+жөн|өзіңізді\s+таныстыр|кіммен\s+сөйлес"), value):
        return "fact_name", identity
    if re.search(kz(r"(?:қай|қандай)\s+нөмірден.{0,30}(?:хабарлас|қоңырау|звон)"), value):
        return "fact_incoming", identity
    if identity["phone"] and re.search(
        kz(r"тіркелген\s+нөмір\S*\s+(?:қандай|қай|айтыңыз)|қай\s+нөмірге\s+тіркел|тіркеу\s+нөмір"),
        value,
    ):
        return "fact_registered", identity
    if re.search(
        kz(r"ескі\s+(?:sim|сим|нөмір)\S*.{0,30}(?:бар\s+ма|бар\s+па|қолыңызда|жоқ\s+па|қалды\s+ма)"),
        value,
    ):
        return "lost_sim", identity
    return driver_fact_v2(text, snapshot)


KK = Analyzer(
    advice_kk,
    driver_fact_kk,
    lambda text: bool(
        re.search(kz(KK_LIMIT), normalized(text)) or re.search(RU_LIMIT, normalized(text))
    ),
)
ANALYZERS = {"ru": RU, "kk": KK}
LANGUAGES = {"ru": "Русский", "kk": "Қазақша"}

OPENING_V3 = {
    "ru": {
        "calm": "Здравствуйте, это Виктор Ким. Хочу изменить номер телефона в аккаунте. Поможете?",
        "confused": "Здравствуйте… э-э, это Виктор Ким. Я тут запутался с номером в аккаунте. "
        "Как его поменять?",
        "hurried": "Алло, здравствуйте, Виктор Ким. Мне срочно нужно поменять номер в аккаунте, "
        "я на линии. Давайте быстро.",
        "irritated": "Алло! Это Виктор Ким. Мне надо сменить номер в аккаунте. "
        "Почему это так сложно, а?",
        "aggressive": "Алло! Это Виктор Ким. Я уже полчаса не могу сменить номер в аккаунте! "
        "Вы там вообще работаете?!",
    },
    "kk": {
        "calm": "Сәлеметсіз бе, бұл Виктор Ким. Аккаунттағы телефон нөмірін ауыстырғым келеді. "
        "Көмектесе аласыз ба?",
        "confused": "Сәлеметсіз бе… э-э, бұл Виктор Ким. Аккаунттағы нөмірге байланысты шатасып "
        "қалдым. Оны қалай ауыстыруға болады?",
        "hurried": "Алло, сәлеметсіз бе, Виктор Ким. Аккаунттағы нөмірді тез ауыстыруым керек, "
        "мен линиядамын. Тезірек болайықшы.",
        "irritated": "Алло! Бұл Виктор Ким. Аккаунттағы нөмірді ауыстыруым керек. "
        "Неге бәрі осыншама қиын?",
        "aggressive": "Алло! Бұл Виктор Ким. Жарты сағаттан бері аккаунттағы нөмірді ауыстыра "
        "алмай жүрмін! Сіздер мүлде жұмыс істейсіздер ме?!",
    },
}
LINES = {
    "ru": V2_LINES,
    "kk": {
        "critical": "Нөмірді осы қоңырау арқылы шынымен ауыстыра аласыз ба? "
        "Қалай екенін нақтылаңызшы.",
        "unsafe": "Аккаунтты өшіруді ұсынып тұрсыз ба? Маған нөмірді ауыстыру керек. "
        "Қауіпсіз жолын айтыңызшы.",
        "fact_name": "Менің атым {name}.",
        "fact_incoming": "Қазір {incoming} нөмірінен хабарласып тұрмын.",
        "fact_registered": "Аккаунтта {phone} нөмірі тіркелген.",
        "lost_sim": "Ескі SIM-картам енді жоқ. Тіркелген нөмірден қоңырау шала алмаймын.",
        "lost_sim_again": "Айттым ғой, ескі SIM-карта жоқ. Басқа қандай жолы бар?",
        "focus_app": "Такси Про-ны аша аламын. Қосымшада әрі қарай не істеуім керек?",
        "focus_whatsapp": "WhatsApp-қа жаза аламын. Нақты не деп жазуым керек?",
        "resolved_app": "Түсіндім. Такси Про-ны ашып, нөмірді қосымшада ауыстырамын.",
        "resolved_whatsapp": "Жақсы, WhatsApp-қа телефон нөмірін ауыстырғым келетінін жазамын.",
        "app_confused": "Жақсы, Такси Про. Қарапайым тілмен түсіндіріңізші: қосымшада не "
        "істеуім керек?",
        "app_hurried": "Жақсы, Такси Про. Неден бастауым керек, бір ғана әрекетті айтыңызшы.",
        "app_next": "Такси Про-ны ұсынып тұрсыз. Нөмірді ауыстыру үшін қосымшада не істеуім керек?",
        "whatsapp_confused": "Жақсы, WhatsApp. Қарапайым тілмен түсіндіріңізші: оған нақты не "
        "деп жазамын?",
        "whatsapp_next": "Жақсы, WhatsApp-қа жазамын. Нөмірді ауыстыру туралы нақты не деп "
        "жазуым керек?",
        "mismatch": "Түсіндім, мен хабарласып тұрған нөмір тіркелген нөмірден басқа. Енді нөмірді "
        "қалай ауыстырамын?",
        "rejected": "Бұл жол маған келмейді. Оның орнына қандай жолды ұсынасыз?",
        "limit": "Түсіндім, бұл қоңырау арқылы болмайды. Нөмірді қандай жолмен ауыстыра аламын?",
        "ask_how": "Айтыңызшы, аккаунттағы нөмірді қалай ауыстырамын?",
    },
}
# How each character starts a line: hesitation, haste, or irritation that builds up.
MANNER = {
    "ru": {
        "confused": ["Э-э… ", "Так, подождите… ", "Ой, я запутался… "],
        "hurried": ["Давайте быстрее. ", "Я на линии, коротко, пожалуйста. ",
                    "У меня заказ через пять минут. "],
        "irritated": ["Мне некогда. ", "Я уже теряю время. ", "Ну сколько можно! ",
                      "Да что ж такое! "],
        "aggressive": ["Алло, вы меня слышите вообще?! ", "Я уже третий раз звоню! ",
                       "Позовите старшего! ", "Я на вас жалобу напишу! "],
    },
    "kk": {
        "confused": ["Э-э… ", "Тоқтаңызшы… ", "Ой, шатасып кеттім… "],
        "hurried": ["Тезірек болайықшы. ", "Мен линиядамын, қысқаша айтыңызшы. ",
                    "Бес минуттан кейін тапсырысым бар. "],
        "irritated": ["Уақытым жоқ. ", "Уақытымды алып жатырсыз. ", "Қашанға дейін?! ",
                      "Ой, қойыңызшы! "],
        "aggressive": ["Алло, мені естіп тұрсыз ба?! ", "Үшінші рет хабарласып тұрмын! ",
                       "Басшыңызды шақырыңыз! ", "Сізге шағым жазамын! "],
    },
}
RELIEF = {
    "ru": {"confused": "А, вот оно что! ", "hurried": "Супер, спасибо. ",
           "irritated": "Ну наконец-то. ", "aggressive": "Ну наконец-то нормальный ответ. "},
    "kk": {"confused": "А, солай ма! ", "hurried": "Жарайды, рақмет. ",
           "irritated": "Әйтеуір. ", "aggressive": "Әйтеуір дұрыс жауап. "},
}
# The aggressive driver shouts until the operator owns his frustration and apologises; then he
# speaks with the ordinary lines, grudgingly.
AGGRESSIVE_LINES = {
    "ru": {
        "ask_how": "Мне нужно сменить номер, всё! Как это сделать?!",
        "limit": "Нельзя, нельзя… А как тогда?! Говорите, как мне сменить номер!",
        "rejected": "Не подходит мне это! Что ещё вы можете предложить?!",
        "lost_sim_again": "Я же сказал — нет старой SIM! Вы меня не слушаете?!",
        "app_next": "Такси Про, допустим. И что мне там делать?! Конкретно!",
        "whatsapp_next": "WhatsApp?! И что мне туда писать? Говорите конкретно!",
        "critical": "Так вы сами поменяете или нет?! Отвечайте прямо!",
        "unsafe": "Удалить аккаунт?! Вы с ума сошли? Мне номер поменять надо!",
        "mismatch": "Да какая разница, с какого номера я звоню?! Как мне поменять номер?!",
    },
    "kk": {
        "ask_how": "Маған нөмірді ауыстыру керек, болды! Қалай істеймін?!",
        "limit": "Болмайды, болмайды… Онда қалай?! Нөмірді қалай ауыстырамын, айтыңыз!",
        "rejected": "Бұл маған келмейді! Тағы не ұсына аласыз?!",
        "lost_sim_again": "Айттым ғой — ескі SIM жоқ! Мені тыңдамай отырсыз ба?!",
        "app_next": "Такси Про, жарайды. Онда не істеймін?! Нақты айтыңыз!",
        "whatsapp_next": "WhatsApp па?! Оған не жазамын? Нақты айтыңыз!",
        "critical": "Сонда өзіңіз ауыстырасыз ба, жоқ па?! Тура жауап беріңіз!",
        "unsafe": "Аккаунтты өшіру ме?! Есіңіз дұрыс па? Маған нөмірді ауыстыру керек!",
        "mismatch": "Қай нөмірден хабарласқанымның не айырмашылығы бар?! "
        "Нөмірді қалай ауыстырамын?!",
    },
}
CALMED = {
    "ru": ["Ладно. ", "Хорошо, слушаю. ", "Ну допустим. "],
    "kk": ["Жарайды. ", "Жақсы, тыңдап тұрмын. ", "Мейлі. "],
}
# Owning the driver's frustration: «понимаю», «извините», «мне жаль»; «түсінемін», «кешіріңіз».
EMPATHY = re.compile(
    r"\bпонима(?:ю|ем)\b|извин|\bпрости(?:те)?\b|сожале|\b(?:мне|нам) (?:очень )?жаль"
    r"|неприятн|разделя(?:ю|ем)|приношу|могу понять"
    r"|түсінем|кешір|өкінем|өкінішт|ренжімеңіз"
)


def empathic(text):
    return bool(EMPATHY.search(normalized(text)))


def calmed_down(transcript, text=""):
    """Whether the operator has owned the driver's frustration in this call so far."""
    return empathic(text) or any(
        empathic(entry["text"]) for entry in transcript if entry["role"] == "operator"
    )


def say(language, persona, key, turn, params=None, *, calmed=False):
    """The line in the driver's own manner; the calm driver speaks plainly."""
    angry = persona == "aggressive" and not calmed
    line = (AGGRESSIVE_LINES[language] if angry else {}).get(key) or LINES[language][key]
    return in_manner(
        language, persona, line.format(**(params or {})), turn,
        relief=key.startswith("resolved_"), calmed=calmed,
    )


def in_manner(language, persona, line, turn, *, relief=False, calmed=False):
    if persona == "calm":
        return line
    if relief:
        return RELIEF[language][persona] + line
    if persona == "aggressive" and calmed:
        return CALMED[language][(turn - 1) % len(CALMED[language])] + line
    manner = MANNER[language][persona]
    if persona in ("irritated", "aggressive"):
        # Irritation builds up over the call, then alternates between the last two.
        index = turn - 1 if turn - 1 < len(manner) else len(manner) - 2 + (turn - 1) % 2
    else:
        index = (turn - 1) % len(manner)
    return manner[max(0, index)] + line


def next_reply_v3(persona, stage, transcript, text, snapshot=None):
    language = (snapshot or {}).get("language", "ru")
    stage, key, params = reply_plan(persona, stage, transcript, text, snapshot, ANALYZERS[language])
    turn = sum(1 for entry in transcript if entry["role"] == "operator") + 1
    calmed = calmed_down(transcript, text)
    return stage, say(language, persona, key, turn, params, calmed=calmed), key


def custom_reply(persona, stage, transcript, text, snapshot):
    """A scenario from the editor: its keyword steps, said in the driver's manner."""
    content = snapshot["content"]
    stage, line, key, _ = voice_scenarios.reply(content, stage, text)
    turn = sum(1 for entry in transcript if entry["role"] == "operator") + 1
    spoken = in_manner(
        content["language"], persona, line, turn,
        relief=stage == "resolved", calmed=calmed_down(transcript, text),
    )
    return stage, spoken, key


def dialogue_for(revision, snapshot=None):
    if snapshot and snapshot.get("custom"):
        return lambda persona, stage, transcript, text: custom_reply(
            persona, stage, transcript, text, snapshot
        )
    if revision == 1:
        return next_reply
    if revision == 2:
        return lambda persona, stage, transcript, text: next_reply_v2(
            persona, stage, transcript, text, snapshot=snapshot
        )
    if revision == 3:
        return lambda persona, stage, transcript, text: next_reply_v3(
            persona, stage, transcript, text, snapshot=snapshot
        )
    raise ConflictError("Версия правил недоступна. Обратитесь к наставнику.")


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
        "language": attempt.snapshot.get("language", "ru"),
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
        # A scenario from the editor: no training systems, the author's notes instead.
        "custom": bool(attempt.snapshot.get("custom")),
        "notes": attempt.snapshot.get("notes", ""),
        # «oktell»: the driver called the operator's Oktell; earlier calls were started on the page.
        "channel": attempt.snapshot.get("channel", "page"),
        "ai_driver": ai_driver(attempt),
        "result": deepcopy(attempt.result) if attempt.state == "completed" else None,
        "can_finish": attempt.stage == "resolved",
        "retry_of": attempt.retry_of,
        "created_at": utc(attempt.created_at),
        "finished_at": utc(attempt.finished_at) if attempt.finished_at else None,
    }


def ai_driver(attempt):
    """Whether Claude spoke for the driver in this call (each of its lines is marked)."""
    return any(entry.get("ai") for entry in attempt.transcript if entry["role"] == "driver")


async def custom_allowed(session, user):
    """Scenarios from the editor are for ТП operators and trainees; staff look at them too."""
    return user.role not in (Role.OPERATOR,) or await support_allowed(session, user)


async def catalog(session, user):
    await require_scope(session, user)
    custom = (
        [voice_scenarios.catalog_item(row) for row in await voice_scenarios.playable(session)]
        if await custom_allowed(session, user)
        else []
    )
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
                "languages": [{"key": key, "label": label} for key, label in LANGUAGES.items()],
                "revision": REVISION,
                "rules_source": RULES_SOURCE,
            },
            *custom,
        ],
        "attempts": [
            {
                "id": a.id,
                "scenario_key": a.scenario_key,
                "title": a.snapshot["title"],
                "persona": a.persona,
                "language": a.snapshot.get("language", "ru"),
                "state": a.state,
                "stage": a.stage,
                "turn": a.turn,
                "score": a.result["score"] if a.result else None,
                "created_at": utc(a.created_at),
                "finished_at": utc(a.finished_at) if a.finished_at else None,
                "review_status": a.result.get("review_status") if a.result else None,
                "channel": a.snapshot.get("channel", "page"),
                "ai_driver": ai_driver(a),
                "ai_grade": bool(a.result and (a.result.get("ai") or a.result.get("ai_review"))),
            }
            for a in attempts
        ],
        # Whether Claude takes part in calls right now (connected and within the month's budget).
        "ai_active": await voice_ai.available(session),
    }


async def start_custom(session, user, body):
    scenario = await session.get(
        voice_scenarios.VoiceScenario, voice_scenarios.scenario_id(body.scenario_key),
        populate_existing=True,
    )
    if scenario is None or not scenario.active or scenario.published is None:
        raise NotFoundError("Сценарий снят с публикации или не найден.")
    if not await custom_allowed(session, user):
        raise PermissionDeniedError("Сценарии звонков доступны операторам ТП и стажёрам.")
    snapshot = voice_scenarios.snapshot(scenario)
    attempt = VoiceTrainingAttempt(
        user_id=user.id,
        scenario_key=body.scenario_key,
        revision=scenario.revision,
        persona=body.persona,
        state="in_progress",
        stage=voice_scenarios.first_stage(snapshot["content"]),
        turn=0,
        snapshot=snapshot,
        transcript=[{
            "role": "driver", "text": snapshot["content"]["opening"], "turn": 0, "line": "opening",
        }],
        practice={"events": []},
        requests={},
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def start(session, user, body):
    await require_scope(session, user)
    await lock_learner(session, user.id)
    await session.refresh(user)
    await require_scope(session, user)
    if body.scenario_key != KEY:
        return await start_custom(session, user, body)
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
            "language": body.language,
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
        transcript=[{
            "role": "driver",
            "text": OPENING_V3[body.language][body.persona],
            "turn": 0,
            "line": "opening",
        }],
        practice={"events": []},
        requests={},
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def incoming(session, user, language, previous=None):
    """A driver calling the operator's Oktell: any published situation in the chosen language, any
    character, and not the same pair as the last call when there is another."""
    await require_scope(session, user)
    lines = []
    driver = dispatch.fold(await dispatch.history(session, user.id))["drivers"][DRIVER_KEY]
    # A changed training number would contradict the call; the other situations still ring.
    if phone_digits(driver["phone"]) != phone_digits(INCOMING_PHONE):
        park = dispatch.PARK_BY_ID[driver["park"]]["name"]
        lines.append({"scenario_key": KEY, "number": INCOMING_PHONE, "park": park})
    if await custom_allowed(session, user):
        lines.extend(
            {
                "scenario_key": f"{voice_scenarios.KEY_PREFIX}{row.id}",
                "number": row.published["driver"]["phone"],
                "park": row.published["driver"]["park"],
            }
            for row in await voice_scenarios.playable(session)
            if row.published["language"] == language
        )
    if not lines:
        raise ConflictError(
            "Учебных звонков сейчас нет: восстановите учебного водителя в Диспетчерской "
            "или выберите другой язык звонков."
        )
    calls = [{**line, "persona": persona} for line in lines for persona in PERSONAS]
    fresh = [c for c in calls if [c["scenario_key"], c["persona"]] != list(previous or [])]
    return {**random.choice(fresh or calls), "language": language}


async def retry_call(session, user, attempt_id, turn):
    """«Повторить момент» rings as the next call: the same driver from the chosen answer."""
    original = await own_attempt(session, user, attempt_id)
    if original.state != "completed":
        raise ConflictError("Повторить можно момент завершённого звонка.")
    if not any(e["role"] == "operator" and e["turn"] == turn for e in original.transcript):
        raise DomainError("В разговоре нет указанного ответа оператора.")
    return {
        "scenario_key": original.scenario_key,
        "persona": original.persona,
        "language": original.snapshot.get("language", "ru"),
        "number": original.snapshot["incoming_phone"],
        "park": original.snapshot["driver"]["park"],
        "retry_of": original.id,
        "turn": turn,
    }


async def answer_call(session, user, call):
    """The operator took the driver's call in Oktell: the attempt starts with its data on screen."""
    if call.get("retry_of"):
        attempt = await retry(session, user, call["retry_of"], VoiceRetry(turn=call["turn"]))
    else:
        attempt = await start(
            session,
            user,
            VoiceStart(
                scenario_key=call["scenario_key"],
                persona=call["persona"],
                language=call["language"],
            ),
        )
    attempt.snapshot = {**attempt.snapshot, "channel": "oktell"}
    events = attempt.practice.get("events", [])
    # The incoming number is in front of the operator: reading the call is done by answering it.
    if not attempt.snapshot.get("custom") and not any(e["system"] == "oktell" for e in events):
        attempt.practice = {
            "events": [
                *events,
                {
                    "system": "oktell",
                    "turn": attempt.turn,
                    "at": datetime.now(UTC).isoformat(),
                    "driver_id": attempt.snapshot["driver"]["id"],
                    "park_id": attempt.snapshot["driver"]["park_id"],
                    "registered_phone": attempt.snapshot["driver"]["phone"],
                    "incoming_phone": attempt.snapshot["incoming_phone"],
                },
            ]
        }
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
    # A scenario from the editor: Claude plays its driver when it is connected and in budget;
    # otherwise (or if it fails) the author's keyword steps answer.
    spoken = (
        await voice_ai.driver_reply(session, attempt, body.text)
        if attempt.snapshot.get("custom")
        else None
    )
    voiced = bool(spoken)
    if spoken:
        reply, step, resolved = spoken
        stage, line = ("resolved" if resolved else step), ["ai"]
    else:
        stage, reply, *line = dialogue_for(attempt.revision, attempt.snapshot)(
            attempt.persona, attempt.stage, attempt.transcript, body.text
        )
        # The built-in call: Claude understands the operator by meaning and decides when the
        # driver got his answer; the rules' line is its draft, and what is left when it is out.
        if not attempt.snapshot.get("custom") and attempt.revision == REVISION:
            led = await voice_ai.phone_reply(
                session, attempt, body.text, reply,
                rules_resolved=stage == "resolved", understood=line[0] != "ask_how",
                unsafe=line[0] in ("critical", "unsafe"),
            )
            if led:
                (reply, resolved), voiced = led, True
                if resolved:
                    stage = "resolved"
                elif stage == "resolved":
                    stage = "next_step"
    driver = {"role": "driver", "text": reply, "turn": body.turn + 1}
    if line:
        driver["line"] = line[0]
    if voiced:
        driver["ai"] = True
    attempt.transcript = [
        *attempt.transcript,
        {"role": "operator", "text": body.text, "turn": body.turn},
        driver,
    ]
    attempt.stage = stage
    attempt.turn += 1
    attempt.requests = {**attempt.requests, request_id: payload}
    await session.flush()
    return attempt


async def inspect(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    require_active(attempt)
    if attempt.snapshot.get("custom"):
        raise ConflictError("В этом сценарии учебные системы не проверяются.")
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


EXAMPLES = {
    "ru": {
        "solution": "Можно изменить номер в Такси Про или обратиться в WhatsApp. "
        "Предложите подходящий водителю способ; при утрате SIM не настаивайте на звонке "
        "со старого номера.",
        "clarity": "Вы звоните с номера, который не совпадает с регистрационным. "
        "По этому звонку изменить номер нельзя.",
        "app": "Откройте Такси Про и измените номер в приложении.",
        "whatsapp": "Напишите в WhatsApp, что хотите изменить номер телефона.",
    },
    "kk": {
        "solution": "Нөмірді Такси Про қосымшасында ауыстыруға немесе WhatsApp-қа жазуға болады. "
        "Ескі SIM-карта жоқ болса, тіркелген нөмірден қоңырау шалуды талап етпеңіз.",
        "clarity": "Сіз тіркелген нөмірден емес, басқа нөмірден хабарласып тұрсыз. "
        "Сондықтан бұл қоңырау арқылы нөмірді ауыстыру мүмкін емес.",
        "app": "Такси Про қосымшасын ашып, нөміріңізді сол жерде ауыстырыңыз.",
        "whatsapp": "WhatsApp-қа телефон нөмірін ауыстырғыңыз келетінін жазыңыз.",
    },
}


DEESCALATION_EXAMPLE = {
    "ru": "Понимаю, что ситуация неприятная, извините за неудобства. "
    "Давайте вместе решим вопрос с номером.",
    "kk": "Түсінемін, жағдай жағымсыз, кешіріңіз. Нөмір мәселесін бірге шешейік.",
}


def deescalation(attempt, language="ru"):
    """The aggressive driver's own criterion: was his frustration owned before the solution."""
    if getattr(attempt, "persona", None) != "aggressive":
        return None
    operators = operator_entries(attempt.transcript)
    owned = next((entry for entry in operators if empathic(entry["text"])), None)
    fallback = operators[0] if operators else attempt.transcript[0]
    return criterion(
        "deescalation",
        "Снятие напряжения",
        owned is not None,
        (
            "Недовольство водителя признано, разговор перешёл в спокойное русло."
            if owned is not None
            else "Недовольство водителя не признано: он оставался агрессивным весь разговор."
        ),
        owned or fallback,
        DEESCALATION_EXAMPLE[language],
    )


def evaluate_v2(attempt, language="ru"):
    """Revision 3 is judged by the same rules, reading the answers in the call's language."""
    state = dialogue_state_v2(attempt.transcript, ANALYZERS[language].advice)
    examples = EXAMPLES[language]
    operators = operator_entries(attempt.transcript)
    fallback = operators[-1] if operators else attempt.transcript[0]
    events = attempt.practice.get("events", [])
    practice_ok = all(
        any(event["system"] == key for event in events)
        for key in ("dispatch", "oktell", "compared")
    )
    critical_errors = [
        {
            "text": "Обещана прямая смена номера оператором по звонку с другого номера.",
            "quote": entry["text"],
            "turn": entry["turn"],
        }
        for entry in state["critical"]
    ]
    critical_errors.extend(
        {
            "text": "Вместо смены номера предложено удалить аккаунт.",
            "quote": entry["text"],
            "turn": entry["turn"],
        }
        for entry in state["unsafe"]
    )
    solution_ok = (
        state["channel"] in ("app", "whatsapp")
        and state["offer"] is not None
        and not critical_errors
    )
    next_ok = state["step"] is not None and attempt.stage == "resolved"
    criteria = [
        criterion(
            "verification",
            "Проверка данных",
            practice_ok,
            (
                "Правильный аккаунт и входящий номер сверены в учебных системах."
                if practice_ok
                else "Не зафиксированы открытие аккаунта водителя и явная сверка номеров."
            ),
            state["mismatch"] or fallback,
            "Во время звонка откройте аккаунт водителя в Диспетчерской и сверьте номер "
            "регистрации с номером звонка в окне Oktell.",
        ),
        criterion(
            "solution",
            "Правильность решения",
            solution_ok,
            (
                "Предложен доступный способ смены номера, подходящий к разговору."
                if solution_ok
                else (
                    "Зафиксировано недопустимое обещание или действие при смене номера."
                    if critical_errors
                    else "Не предложен доступный способ смены номера."
                )
            ),
            state["offer"] or fallback,
            examples["solution"],
        ),
        criterion(
            "clarity",
            "Понятность объяснения",
            state["mismatch"] is not None,
            (
                "Причина ограничения объяснена через несовпадение номеров."
                if state["mismatch"] is not None
                else "Не объяснено, что входящий номер отличается от регистрационного."
            ),
            state["mismatch"] or fallback,
            examples["clarity"],
        ),
        criterion(
            "next_step",
            "Конкретный следующий шаг",
            next_ok,
            (
                "Водитель подтвердил понятный шаг в предложенном канале."
                if next_ok
                else "Не зафиксированы конкретный доступный шаг и подтверждение понимания водителем."
            ),
            state["step"] or fallback,
            examples["app" if state["channel"] == "app" else "whatsapp"],
        ),
    ]
    extra = deescalation(attempt, language)
    if extra:
        criteria.append(extra)
    # Four criteria are 25 points each; the aggressive driver's fifth makes them 20.
    score = round(100 * sum(1 for item in criteria if item["passed"]) / len(criteria))
    return {
        "score": min(score, 50) if critical_errors else score,
        "criteria": criteria,
        "critical_errors": critical_errors,
        "rules_revision": attempt.revision,
        "assessment_note": (
            "Оценка содержания по учебным правилам и контексту разговора. "
            "Достаточно одного доступного способа с понятным следующим шагом. "
            "Интонация и темп не оцениваются."
        ),
        "review_status": None,
    }


def evaluate_custom(attempt):
    """What the trainer understood, step by step; the score is the mentor's."""
    content = attempt.snapshot["content"]
    operators = operator_entries(attempt.transcript)
    critical_errors = [
        {"text": content["forbidden"][index]["text"], "quote": entry["text"], "turn": entry["turn"]}
        for entry in operators
        for index, _ in voice_scenarios.forbidden_hits(content, entry["text"])
    ]
    # Each driver line keeps the reply it came from ("s2:0"): the answer before it passed.
    passed = {}
    for entry in attempt.transcript:
        key = entry.get("line", "")
        step, _, option = key.partition(":")
        if entry["role"] == "driver" and option.isdigit() and step not in passed:
            passed[step] = next(
                (item for item in operators if item["turn"] == entry["turn"] - 1), None
            )
    criteria = []
    for number, step in enumerate(content["steps"], 1):
        answer = passed.get(step["id"])
        criteria.append({
            "key": step["id"],
            "label": step["name"].strip() or f"Шаг {number}",
            "passed": answer is not None,
            "feedback": (
                "Тренажёр узнал ответ по ключевым словам шага."
                if answer is not None
                else "Ответ на этом шаге не узнан: водитель переспрашивал "
                "или звонок завершён раньше."
            ),
            "quote": answer["text"] if answer else None,
            "turn": answer["turn"] if answer else None,
            "role": "operator",
            "example": None,
        })
    extra = deescalation(attempt, content["language"])
    if extra:
        criteria.append(extra)
    return {
        "score": None,
        "manual": True,
        "criteria": criteria,
        "critical_errors": critical_errors,
        "rules_revision": attempt.revision,
        "solution": content["solution"],
        "reached_end": attempt.stage == "resolved",
        "assessment_note": (
            "Оценку ставит наставник: тренер, супервайзер, руководитель или администратор. "
            "Шаги показывают, что тренажёр узнал по ключевым словам."
        ),
        "review_status": "awaiting_grade",
    }


async def finish(session, user, attempt_id):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    if attempt.state == "completed":
        return attempt
    if attempt.snapshot.get("custom"):
        # Claude grades the call when it can; otherwise the call waits for a mentor's score.
        graded = await voice_ai.grade(session, attempt)
        if graded:
            attempt.result = graded
            attempt.state = "completed"
            attempt.finished_at = datetime.now(UTC)
            await session.flush()
            return attempt
        attempt.result = evaluate_custom(attempt)
        attempt.state = "completed"
        attempt.finished_at = datetime.now(UTC)
        # The call joins the mentors' queue: its score is theirs to give.
        attempt.review = {
            "kind": "grade", "comment": "", "created_at": attempt.finished_at.isoformat()
        }
        await session.flush()
        return attempt
    evaluators = {
        1: evaluate_v1,
        2: evaluate_v2,
        3: lambda attempt: evaluate_v2(attempt, attempt.snapshot.get("language", "ru")),
    }
    evaluator = evaluators.get(attempt.revision)
    if evaluator is None:
        raise ConflictError("Версия правил недоступна. Обратитесь к наставнику.")
    rules = evaluator(attempt)
    # The current call is graded by Claude by meaning; the rules grade it when it cannot.
    graded = (
        await voice_ai.grade_phone(session, attempt, rules, phone_solution(attempt))
        if attempt.revision == REVISION
        else None
    )
    attempt.result = graded or rules
    attempt.state = "completed"
    attempt.finished_at = datetime.now(UTC)
    await session.flush()
    return attempt


def phone_solution(attempt):
    return EXAMPLES[attempt.snapshot.get("language", "ru")]["solution"]


async def ai_review(session, user, attempt_id):
    """«Оценить с ИИ»: Claude grades a finished call the rules graded; both grades stay.
    Returns the attempt and, when Claude could not answer, why (the spend is still kept)."""
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    if attempt.state != "completed":
        raise ConflictError("Оценить с ИИ можно завершённый звонок.")
    if attempt.snapshot.get("custom") or attempt.revision != REVISION:
        raise ConflictError("С ИИ можно оценить звонок «Смена номера телефона» в Oktell.")
    if attempt.result.get("ai"):
        raise ConflictError("Этот звонок уже оценил ИИ.")
    if attempt.result.get("ai_review"):
        return attempt, None
    if not operator_entries(attempt.transcript):
        raise ConflictError("В звонке нет ваших ответов: ИИ нечего оценивать.")
    if not voice_ai.configured():
        raise ConflictError("ИИ не подключён: оценить звонок с ИИ пока нельзя.")
    if not await voice_ai.available(session):
        raise ConflictError("Лимит ИИ на этот месяц исчерпан: оценить звонок с ИИ пока нельзя.")
    graded = await voice_ai.grade_phone(session, attempt, attempt.result, phone_solution(attempt))
    if graded is None:
        return attempt, "ИИ не смог оценить звонок. Попробуйте ещё раз чуть позже."
    attempt.result = {**attempt.result, "ai_review": graded}
    await session.flush()
    return attempt, None


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
        stage = dialogue_for(original.revision, original.snapshot)(
            original.persona, stage, replay, entry["text"]
        )[0]
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
    # The operator answered at this turn in the original call, so the driver had not got his answer
    # yet; the rules alone may think otherwise of a call Claude led.
    if stage == "resolved":
        stage = "next_step"
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
    if attempt.result.get("manual"):
        raise ConflictError("Оценку этого звонка ставит наставник. Обсудите её с ним.")
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


async def ai_status(session, user):
    """For mentors: whether Claude plays the drivers and what it cost this month."""
    mentor_query(user)
    return await voice_ai.status(session)


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
                "manual": bool(attempt.result.get("manual")),
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
    grading = attempt.result["review_status"] == "awaiting_grade"
    if grading and body.score is None:
        raise DomainError("Поставьте оценку звонку от 0 до 100.")
    attempt.result = {
        **attempt.result,
        **({"score": body.score} if grading else {}),
        "review_status": "reviewed",
        "mentor_comment": body.comment,
        "reviewed_at": datetime.now(UTC).isoformat(),
        "mentor_name": user.full_name,
    }
    await session.flush()
    return mentor_data(attempt, learner)
