"""Three ordinary CRM exercises checked against real, persisted appeals.

Every mutation leaves commit/rollback to its caller. ``start`` and ``check`` take
the learner lock; ``autograde`` assumes its appeal-saving caller already holds it.
Business status (new/recorded/closed) never determines an exercise's completion.
"""

import re
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select

from app.core.errors import ConflictError, NotFoundError
from app.models.city import CityAward
from app.models.crm import CrmAppeal, CrmAttachment
from app.models.crm_training import CrmTrainingAttempt, CrmTrainingCheck
from app.services import dispatch
from app.services.crm_catalog import category_id
from app.services.learning import lock_learner

REVISION = 1
TASK_KEYS = ("crm_first", "crm_phone", "crm_closed")
TITLES = {
    "crm_first": "Первое обращение",
    "crm_phone": "Смена номера",
    "crm_closed": "Запрос в таксопарк",
}
GOALS = {
    "crm_first": "Зафиксируй консультацию по тарифам: перенеси данные водителя, выбери категорию "
    "и коротко опиши итог в комментарии.",
    "crm_phone": "Создай тикет на смену номера: укажи в комментарии старый и новый номера, "
    "вставь ссылку на аккаунт и приложи скриншот учебной карточки.",
    "crm_closed": "Передай запрос в таксопарк: создай тикет, опиши просьбу водителя и вставь "
    "ссылку на его аккаунт.",
}
#: A comment is about the task when it names its topic in any of these words (stems).
TOPICS = {
    "crm_first": (
        "тариф",
        "эконом",
        "комфорт",
        "бизнес",
        "минивэн",
        "универсал",
        "доставк",
        "курьер",
    ),
    "crm_closed": ("лимит", "ограничен"),
}
#: A phone written in a comment: +7, 8 or nothing before ten digits, with spaces, brackets or
#: dashes between them; never a run of digits inside an id.
PHONE = re.compile(
    r"(?<![\w+])(?:\+?[78][\s(-]*)?\(?\d{3}\)?[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\w)"
)
FLEET_LINK = re.compile(r"(?:https?://)?fleet\.yandex\.kz/contractors/[^\s<>]+", re.IGNORECASE)


def _utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _iso(value):
    return _utc(value).isoformat() if value else None


def _digits(value):
    value = re.sub(r"\D", "", value or "")
    return "7" + value[1:] if len(value) == 11 and value.startswith("8") else value


def _phone_tail(value):
    """A phone's last ten digits however it is written (+7, 8 or nothing before them), as the
    CRM's hints compare it (frontend/src/pages/crm/accountData.ts); None when it is no phone."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if 10 <= len(digits) <= 12 else None


def _plain(value):
    return "".join((value or "").split()).casefold()


def _key(key):
    if key not in TASK_KEYS:
        raise NotFoundError("Учебное задание CRM не найдено")
    return key


async def _snapshots(session, user):
    fleet = await dispatch.state(session, user)
    source = next((d for d in fleet["drivers"] if d["id"] == fleet["test_driver"]), None)
    if source is None:
        raise ConflictError("Учебный водитель недоступен. Обновите рабочие сайты.")
    park = next((p for p in fleet["parks"] if p["id"] == source["park"]), None)
    if park is None:
        raise ConflictError("Таксопарк учебного водителя недоступен")
    phone = _digits(source["phone"])
    new_phone = "+" + phone[:-1] + str((int(phone[-1]) + 1) % 10)
    driver = {
        "id": source["id"],
        "name": " ".join(
            source[k] for k in ("last_name", "first_name", "middle_name") if source[k]
        ),
        "phone": source["phone"],
        "license": source["license"],
        "park": park["name"],
        "city": park["city"],
        "link": (
            f"https://fleet.yandex.kz/contractors/{source['id']}/details"
            f"?park_id={park['park_id']}&lang=ru"
        ),
    }
    driver_type = (
        "Обычный водитель" if source["employment"] == "Физическое лицо" else "Самозанятый водитель"
    )
    # The category starts with the driver's type: the task's data says which.
    driver["type"] = driver_type
    base = ["Водитель", driver_type]
    request = [*base, "Запрос", "Таксопарк", "Обработка запросов/ООЗ"]
    return {
        "crm_first": {
            "driver": driver,
            "category_path": [*base, "Консультация", "Консультация по Тарифам"],
            "speech": (
                f"Здравствуйте! Я {driver['name']}, работаю в {driver['park']}, "
                f"город {driver['city']}. Подскажите, где узнать доступные мне тарифы?"
            ),
        },
        "crm_phone": {
            "driver": {**driver, "new_phone": new_phone},
            "category_path": [*request, "Смена номера"],
            "speech": (
                f"Это {driver['name']}. Прошу заменить мой номер {driver['phone']} на {new_phone}."
            ),
        },
        "crm_closed": {
            "driver": driver,
            "category_path": [*request, "Снятие лимита"],
            "speech": (
                f"Здравствуйте, это {driver['name']}. На аккаунте стоит лимит, не могу нормально "
                "работать. Передайте, пожалуйста, в таксопарк, чтобы его сняли."
            ),
        },
    }


async def _records(session, user):
    attempts = {
        a.task_key: a
        for a in await session.scalars(
            select(CrmTrainingAttempt).where(CrmTrainingAttempt.user_id == user.id)
        )
    }
    awards = {
        a.mission_key: a
        for a in await session.scalars(
            select(CityAward).where(
                CityAward.user_id == user.id, CityAward.mission_key.in_(TASK_KEYS)
            )
        )
    }
    return attempts, awards


def _passed(key, attempts, awards):
    return key in awards or (key in attempts and attempts[key].phase == "passed")


def _steps(key, checks, passed):
    groups = [
        (
            "identity",
            "Перенеси данные водителя: телефон, В/У, ID, парк и город",
            ("phone", "phone_format", "license", "driver_id", "park", "city", "channel"),
        ),
        ("category", "Выбери полную категорию и тип записи", ("category", "ticket")),
        ("content", "Заполни комментарий по задаче", ("comment", "link", "numbers")),
    ]
    if key == "crm_phone":
        groups.append(("attachment", "Приложи скриншот учебного аккаунта", ("attachment",)))
    groups.append(
        (
            "save",
            "Сохрани обращение и получи проверку",
            ("author", "fresh", "binding", "unused", "current"),
        )
    )
    indexed = {c["key"]: c for c in checks}
    result = []
    for name, label, keys in groups:
        found = [indexed[k]["ok"] for k in keys if k in indexed]
        status = "passed" if passed or (found and all(found)) else "failed" if found else "pending"
        result.append({"key": name, "label": label, "status": status})
    return result


async def state(session, user):
    """Read-only projection. Available tasks do not start implicitly."""
    attempts, awards = await _records(session, user)
    snapshots = await _snapshots(session, user)
    tasks = []
    for index, key in enumerate(TASK_KEYS):
        attempt = attempts.get(key)
        passed = _passed(key, attempts, awards)
        unlocked = not index or _passed(TASK_KEYS[index - 1], attempts, awards)
        snapshot = attempt.snapshot if attempt else snapshots[key]
        # A task started before the driver's type was part of its data shows it from the fleet.
        driver = {**snapshots[key]["driver"], **snapshot["driver"]}
        checks = attempt.checks if attempt else []
        task_state = (
            "passed"
            if passed
            else "locked"
            if not unlocked
            else "in_progress"
            if attempt
            else "available"
        )
        tasks.append(
            {
                "key": key,
                "title": TITLES[key],
                "goal": GOALS[key],
                "speech": snapshot["speech"],
                "state": task_state,
                "driver": driver,
                "category_path": snapshot["category_path"],
                "steps": _steps(key, checks, passed),
                "checks": checks,
                "appeal_id": attempt.appeal_id if attempt else None,
                "started_at": _iso(attempt.started_at) if attempt else None,
                "passed_at": (
                    _iso(attempt.passed_at)
                    if attempt and attempt.phase == "passed"
                    else _iso(awards[key].claimed_at)
                    if key in awards
                    else None
                ),
            }
        )
    return {
        "revision": REVISION,
        "completed": sum(t["state"] == "passed" for t in tasks),
        "active_task": next((t["key"] for t in tasks if t["state"] == "in_progress"), None),
        "tasks": tasks,
    }


async def start(session, user, task_key, request_id=None):
    """Idempotent per user/task; no commit. A repeated start preserves its snapshot."""
    key = _key(task_key)
    await lock_learner(session, user.id)
    attempts, awards = await _records(session, user)
    index = TASK_KEYS.index(key)
    if index and not _passed(TASK_KEYS[index - 1], attempts, awards):
        raise ConflictError("Сначала пройдите предыдущее учебное задание CRM")
    if key not in attempts and key not in awards:
        snapshot = (await _snapshots(session, user))[key]
        snapshot["after_appeal_id"] = await session.scalar(
            select(func.coalesce(func.max(CrmAppeal.id), 0)).where(CrmAppeal.author_id == user.id)
        )
        session.add(
            CrmTrainingAttempt(
                user_id=user.id,
                task_key=key,
                revision=REVISION,
                snapshot=snapshot,
                phase="started",
                started_at=datetime.now(UTC),
                checks=[],
            )
        )
        await session.flush()
    return await state(session, user)


def _account_link(comment, driver):
    """Whether the comment links the driver's account in its park, and if not, why not.

    Any link to the account in its park counts, with or without https:// and «/details»: the same
    rule as the CRM's hint (frontend/src/pages/crm/accountData.ts linkMatch).
    """
    target = urlparse(driver["link"])
    park_id = parse_qs(target.query)["park_id"][0]
    account = driver["id"].casefold()
    other = no_park = False
    for raw in FLEET_LINK.findall(comment or ""):
        raw = raw.rstrip(".,;!)]}")
        try:
            parsed = urlparse(raw if "://" in raw else "https://" + raw)
        except ValueError:
            # A malformed pasted URL is feedback, not a failed save transaction.
            continue
        path = parsed.path.casefold().rstrip("/")
        if path not in (f"/contractors/{account}", f"/contractors/{account}/details"):
            other = True
        elif parse_qs(parsed.query).get("park_id") == [park_id]:
            return True, ""
        else:
            no_park = True
    if no_park:
        return False, (
            "В ссылке нет таксопарка водителя (park_id). Скопируй ссылку на аккаунт целиком — "
            "из данных задания или из адресной строки Диспетчерской."
        )
    if other:
        return False, f"Ссылка ведёт на другой аккаунт. Нужен аккаунт: {driver['name']}."
    if account in (comment or "").casefold():
        return False, (
            "В комментарии только ID. Вставь ссылку на аккаунт целиком: "
            "https://fleet.yandex.kz/contractors/…?park_id=…"
        )
    return False, (
        "Вставь в комментарий ссылку на аккаунт водителя — её можно скопировать из данных "
        "задания или из адресной строки Диспетчерской."
    )


def _has_image(attachments):
    for item in attachments:
        if isinstance(item, tuple):
            mime, size = item[1], len(item[2])
        elif isinstance(item, dict):
            mime, size = item.get("mime", ""), item.get("size", 0)
        else:
            mime, size = item.mime, item.size
        if mime in {"image/png", "image/jpeg", "image/webp"} and size > 0:
            return True
    return False


async def autograde(session, user, task_key, row, attachments=None):
    """Check a real appeal, retain failed saves. Caller holds learner lock; no commit.

    ``attachments`` may be validated upload tuples or persisted CrmAttachment rows;
    omitted attachments are read from storage. Passed proof is never replaced.
    """
    key = _key(task_key)
    attempts, awards = await _records(session, user)
    attempt = attempts.get(key)
    if _passed(key, attempts, awards):
        return await state(session, user)
    if not attempt:
        raise ConflictError("Сначала начните это учебное задание CRM")
    index = TASK_KEYS.index(key)
    if index and not _passed(TASK_KEYS[index - 1], attempts, awards):
        raise ConflictError("Сначала пройдите предыдущее учебное задание CRM")
    if attachments is None:
        attachments = list(
            await session.scalars(select(CrmAttachment).where(CrmAttachment.appeal_id == row.id))
        )
    other = await session.scalar(
        select(CrmTrainingAttempt.id).where(
            CrmTrainingAttempt.appeal_id == row.id,
            CrmTrainingAttempt.id != attempt.id,
        )
    )
    driver = attempt.snapshot["driver"]
    path = attempt.snapshot["category_path"]
    category_ids = [category_id(path[:i]) for i in range(1, len(path) + 1)]
    comment = row.comment or ""
    checks = []

    def add(name, label, ok, message):
        checks.append(
            {"key": name, "label": label, "ok": bool(ok), "message": "" if ok else message}
        )

    own = row.author_id == user.id
    add(
        "author", "Обращение сохранено тобой", own, "Сохрани собственное обращение для этой задачи."
    )
    # SQLite's server-default timestamp has second precision. The snapshotted
    # monotonic id boundary prevents older saves from passing in that same second.
    fresh = row.id > attempt.snapshot["after_appeal_id"] and _utc(row.created_at) >= _utc(
        attempt.started_at
    ).replace(microsecond=0)
    add(
        "fresh",
        "Обращение создано после начала задания",
        fresh,
        "Создай новое обращение после нажатия «Начать».",
    )
    binding = getattr(row, "training_task", None)
    current = attempt.appeal_id is None or row.id >= attempt.appeal_id
    add(
        "current",
        "Проверяется последнее сохранённое обращение задания",
        current,
        "Открой последнее сохранённое обращение этого задания для исправления.",
    )
    add(
        "binding",
        "Обращение относится к этому заданию",
        binding == key,
        "Это обращение создано вне задания или для другого задания.",
    )
    add(
        "unused",
        "У обращения отдельное учебное назначение",
        other is None,
        "Это обращение уже использовано в другом задании.",
    )
    phone = _phone_tail(row.phone)
    for name, label, ok, message in (
        (
            "phone",
            "Номер телефона водителя",
            phone is not None and phone == _phone_tail(driver["phone"]),
            f"Номер не совпадает с номером водителя {driver['phone']}. Скопируй его из данных "
            "задания или из карточки в Диспетчерской.",
        ),
        (
            "license",
            "Номер водительского удостоверения",
            _plain(row.license_number) == _plain(driver["license"]),
            f"Номер В/У не совпадает: у водителя {driver['license']}.",
        ),
        (
            "driver_id",
            "ID аккаунта водителя",
            _plain(row.driver_id) == _plain(driver["id"]),
            "Впиши ID аккаунта водителя — это часть ссылки на аккаунт после «contractors/».",
        ),
        (
            "park",
            "Таксопарк водителя",
            _plain(row.park) == _plain(driver["park"]),
            f"Выбери таксопарк водителя — «{driver['park']}».",
        ),
        (
            "city",
            "Город водителя",
            _plain(row.city) == _plain(driver["city"]),
            f"Выбери город водителя — «{driver['city']}».",
        ),
        (
            "channel",
            "Канал обращения — звонок",
            row.channel == "Звонок",
            "Водитель позвонил: в поле «Звонок/Чат» выбери «Звонок».",
        ),
    ):
        add(name, label, ok, message)
    add(
        "phone_format",
        "Номер телефона без посторонних символов",
        bool(re.fullmatch(r"[+\d\s()\-]+", row.phone)),
        "В номере телефона допустимы цифры, пробелы, скобки, плюс и дефис.",
    )
    add(
        "category",
        "Полная цепочка категории",
        row.category_ids == category_ids,
        "Выбери категорию: " + " → ".join(path) + ".",
    )
    ticket = key != "crm_first"
    add(
        "ticket",
        "Тип записи: " + ("тикет" if ticket else "консультация"),
        row.is_ticket == ticket,
        "Включи «Формировать тикет»."
        if ticket
        else "Сохрани консультацию без флажка «Формировать тикет».",
    )
    without_links = FLEET_LINK.sub("", re.sub(r"https?://\S+", "", comment))
    text = without_links.strip()
    meaningful = len(text) >= 12 and (
        key not in TOPICS or any(word in text.casefold() for word in TOPICS[key])
    )
    add(
        "comment",
        "Комментарий описывает обращение",
        meaningful,
        "Опиши итог консультации: что ты рассказал водителю о тарифах."
        if key == "crm_first"
        else "Опиши просьбу водителя одной-двумя фразами: снять лимит (ограничение) на аккаунте."
        if key == "crm_closed"
        else "Опиши просьбу водителя одной-двумя фразами.",
    )
    if ticket:
        linked, why = _account_link(comment, driver)
        add("link", "Ссылка на правильный аккаунт и таксопарк", linked, why)
    if key == "crm_phone":
        numbers = {_phone_tail(p) for p in PHONE.findall(without_links)}
        expected = {_phone_tail(driver["phone"]), _phone_tail(driver["new_phone"])}
        missing = [
            label
            for label, number in (("старый", driver["phone"]), ("новый", driver["new_phone"]))
            if _phone_tail(number) not in numbers
        ]
        add(
            "numbers",
            "Старый и новый номера из звонка",
            expected.issubset(numbers),
            "Укажи в комментарии "
            + (" и ".join(missing) if missing else "оба")
            + f" номер{'а' if len(missing) != 1 else ''}: старый {driver['phone']}, "
            f"новый {driver['new_phone']}.",
        )
        add(
            "attachment",
            "Приложен скриншот",
            _has_image(attachments),
            "Приложи изображение учебной карточки водителя.",
        )
    attempt.checks = checks
    # Never claim a different user's appeal, nor steal another exercise's reference.
    if own and other is None and binding == key and fresh and current:
        attempt.appeal_id = row.id
    if all(c["ok"] for c in checks):
        attempt.phase = "passed"
        attempt.passed_at = datetime.now(UTC)
    await session.flush()
    return await state(session, user)


async def check(session, user, task_key, appeal_id, request_id):
    """Explicit recheck with a persistent request-id result; caller commits."""
    key = _key(task_key)
    await lock_learner(session, user.id)
    existing = await session.scalar(
        select(CrmTrainingCheck).where(
            CrmTrainingCheck.user_id == user.id,
            CrmTrainingCheck.request_id == str(request_id),
        )
    )
    if existing:
        if existing.task_key != key or existing.appeal_id != appeal_id:
            raise ConflictError("Этот запрос проверки уже использован для другого обращения")
        return existing.result
    row = await session.get(CrmAppeal, appeal_id)
    if row is None:
        raise NotFoundError("Сохранённое обращение не найдено")
    result = await autograde(session, user, key, row)
    session.add(
        CrmTrainingCheck(
            user_id=user.id,
            request_id=str(request_id),
            task_key=key,
            appeal_id=appeal_id,
            result=result,
        )
    )
    await session.flush()
    return result
