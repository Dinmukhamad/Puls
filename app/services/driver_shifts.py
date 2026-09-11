"""Связанное состояние всех разделов водительского тренажёра."""

from copy import deepcopy
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import uuid4

from sqlalchemy import select, update

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.db.base import utcnow
from app.models.driver import DriverOrder, DriverProfile, DriverSettings
from app.models.driver_shift import DriverShift, DriverSupportCase
from app.schemas.driver_shift import DriverScenario
from app.services import driver_auth

VIEWS = {
    "orders",
    "intercity",
    "money",
    "chats",
    "profile",
    "rating",
    "levels",
    "priority",
    "park",
    "tariffs",
    "payment",
    "cars",
    "diagnostics",
    "photo",
    "garage",
    "fuel",
    "benefits",
    "promo",
    "invite",
    "learning",
    "legal",
    "provider",
    "documents",
    "settings",
    "privacy",
    "license",
    "support",
    "balance",
    "warnings",
    "news",
    "bonuses",
    "answers",
    "transaction",
    "payments",
    "requisites",
    "earnings",
    "intercity-history",
    "intercity-alerts",
    "level-history",
    "rating-info",
    "shift-result",
    "offers",
    "work-modes",
}
CHECKS = [
    ("orders", 15, "Выполнить заказы", "Заказы → Маршрут → На месте → Поездка → Завершение"),
    (
        "route",
        5,
        "Изменить адрес по просьбе пассажира",
        "Заказы → Во время поездки → Изменить точку Б",
    ),
    ("park", 5, "Выбрать парк задания", "Профиль → Парк → Мои сервисы"),
    ("photo", 15, "Пройти фотоконтроль", "Профиль → Фотоконтроль"),
    ("wallet", 10, "Проверить операции", "Деньги → История транзакций → Детали операции"),
    (
        "support",
        20,
        "Разобрать обращение в Telegram",
        "Деньги → Детали операции → Чаты → Поддержка",
    ),
    ("rating", 10, "Проверить рейтинг", "Профиль → Рейтинг"),
    ("priority", 10, "Проверить приоритет", "Профиль → Приоритет"),
    (
        "documents",
        10,
        "Проверить и подписать документы",
        "Профиль → Юридические документы → Закрывающие документы",
    ),
]


def integer(value, low=0, high=1000000):
    if type(value) is not int or not low <= value <= high:
        raise DomainError(f"Введите целое число от {low} до {high}")
    return value


def text(value, limit=160, minimum=1):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= limit:
        raise DomainError("Проверьте заполнение поля")
    return value.strip()


def amount(value, percent):
    return int(
        (Decimal(value) * Decimal(str(percent)) / 100).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


async def configuration(session):
    settings = await session.get(DriverSettings, 1)
    return (
        DriverScenario.model_validate(settings.scenario or {}).model_dump()
        if settings
        else DriverScenario().model_dump()
    )


async def active(session, user_id, lock=False):
    query = select(DriverShift).where(DriverShift.user_id == user_id, DriverShift.active_slot == 1)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return await session.scalar(query)


async def require_shift(session, user_id, shift_id, device):
    await driver_auth.require_verified(session, user_id, device)
    await session.scalar(
        select(DriverProfile).where(DriverProfile.user_id == user_id).with_for_update()
    )
    shift = await session.scalar(
        select(DriverShift)
        .where(DriverShift.id == str(shift_id), DriverShift.user_id == user_id)
        .with_for_update()
    )
    if not shift:
        raise NotFoundError("Учебная смена не найдена")
    return shift


def ledger(data, title, value, kind, order_id=None, status="complete", note=""):
    entry = {
        "id": str(uuid4()),
        "title": title,
        "amount": value,
        "kind": kind,
        "order_id": order_id,
        "status": status,
        "at": utcnow().isoformat(),
        "note": note,
    }
    data["ledger"].append(entry)
    data["messages"].append(
        {
            "id": entry["id"],
            "channel": "balance",
            "title": title,
            "text": note,
            "amount": value,
            "at": entry["at"],
            "transaction_id": entry["id"],
        }
    )
    return entry


def balance(data):
    return sum(x["amount"] for x in data["ledger"] if x["status"] == "complete")


def reserved(data):
    return -sum(x["amount"] for x in data["ledger"] if x["status"] == "pending" and x["amount"] < 0)


def initial_data(config, mode):
    data = {
        "online": False,
        "completed": 0,
        "missed": 0,
        "cancelled": 0,
        "hints": 0,
        "priority": config["priority_base"],
        "points": config["initial_points"],
        "seen": [],
        "photo_steps": [],
        "photo_status": "required"
        if mode == "assessment" and config["require_photo"]
        else "passed",
        "settings": {
            "theme": "dark",
            "volume": 50,
            "vibration": True,
            "hide_income": False,
            "widgets": True,
            "auto_arrive": False,
            "auto_start": False,
            "destination_marker": True,
            "navigation": "internal",
            "location": "gps",
            "demand": True,
            "traffic": True,
            "bonus_zones": False,
            "special_zones": False,
        },
        "tariffs": [next(x["id"] for x in config["tariffs"] if x["available"])],
        "payment": "any",
        "cars": [
            {
                "id": "main",
                "brand": "Toyota",
                "model": "Camry",
                "year": 2021,
                "plate": "PULS 001",
                "status": "available",
            }
        ],
        "car_id": "main",
        "provider": None,
        "documents": [
            {
                "id": "act",
                "title": "Акт выполненных работ",
                "period": utcnow().strftime("%Y-%m"),
                "status": "unsigned",
                "signed_at": None,
            }
        ],
        "ledger": [],
        "messages": [],
        "bookings": [],
        "intercity_alerts": [],
        "rentals": [],
        "fuel": [],
        "promos": [],
        "lessons": [],
        "passenger_messages": [],
        "work_mode": "all",
        "mode_address": "",
        "support_completed": 0,
        "support_errors": 0,
        "support_checked_wallet": False,
        "payout_problem": False,
        "level_restored": False,
        "points_history": [],
        "rating_votes": config["ratings"],
    }
    if config["initial_balance"]:
        ledger(
            data,
            "Стартовый учебный баланс",
            config["initial_balance"],
            "initial",
            note="Начальное значение сценария",
        )
    data["messages"].append(
        {
            "id": str(uuid4()),
            "channel": "park",
            "title": "Добро пожаловать в учебную смену",
            "text": "Все операции относятся только к Driver Simulator.",
            "at": utcnow().isoformat(),
        }
    )
    return data


async def start(session, user_id, payload):
    old = await session.get(DriverShift, str(payload.id))
    if old:
        if old.user_id != user_id or old.mode != payload.mode:
            raise ConflictError("Этот запрос уже использован")
        return old
    running = await active(session, user_id, lock=True)
    if running:
        return running
    if await session.scalar(
        select(DriverOrder.id).where(DriverOrder.user_id == user_id, DriverOrder.active_slot == 1)
    ):
        raise ConflictError("Сначала завершите ранее начатый заказ")
    config = await configuration(session)
    shift = DriverShift(
        id=str(payload.id),
        user_id=user_id,
        active_slot=1,
        mode=payload.mode,
        config=config,
        data=initial_data(config, payload.mode),
        events=[],
        version=0,
    )
    session.add(shift)
    await session.flush()
    return shift


async def save(session, shift, data, action, request_id, details=None, result=None):
    if len(shift.events) >= 3000 and action != "finish":
        raise ConflictError("Достигнут объём учебной смены. Завершите её и начните новую.")
    values = {
        "data": data,
        "version": shift.version + 1,
        "events": [
            *shift.events,
            {
                "id": str(request_id),
                "action": action,
                "at": utcnow().isoformat(),
                "details": details or {},
            },
        ],
    }
    if result is not None:
        values.update(result=result, active_slot=None, finished_at=utcnow())
    changed = await session.execute(
        update(DriverShift)
        .where(DriverShift.id == shift.id, DriverShift.version == shift.version)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        raise ConflictError("Смена обновилась в другом окне. Обновите данные и повторите действие.")
    await session.refresh(shift)


def checked_result(shift, data):
    config = shift.config
    flags = {
        "orders": data["completed"] >= config["target_orders"],
        "route": not config["route_event"] or data.get("route_changed", False),
        "park": data.get("correct_park", False),
        "photo": not config["require_photo"] or data["photo_status"] == "passed",
        "wallet": "transaction" in data["seen"],
        "support": not config["require_support"]
        or (
            data["support_completed"] > 0
            and data["support_checked_wallet"]
            and data.get("support_return_checked", False)
        ),
        "rating": "rating" in data["seen"],
        "priority": "priority" in data["seen"],
        "documents": not config["require_documents"]
        or all(x["status"] == "signed" for x in data["documents"]),
    }
    checks = [
        {"key": key, "weight": weight, "title": title, "path": path, "done": flags[key]}
        for key, weight, title, path in CHECKS
    ]
    penalties = data.get("invalid_actions", 0) + (
        data["missed"] * 3 + data["cancelled"] * 2 + data["hints"] + data["support_errors"] * 2
    )
    return {
        "score": max(0, sum(x["weight"] for x in checks if x["done"]) - penalties)
        if shift.mode == "assessment" and not data.get("demo_used", False)
        else None,
        "checks": checks,
        "trips": data.get("order_results", []),
        "penalties": penalties if shift.mode == "assessment" else 0,
        "orders": data["completed"],
        "target": config["target_orders"],
        "seconds": int((utcnow() - shift.created_at.replace(tzinfo=UTC)).total_seconds()),
        "errors": data["missed"]
        + data["cancelled"]
        + data["support_errors"]
        + data.get("invalid_actions", 0),
        "hints": data["hints"],
    }


def public(shift):
    if not shift:
        return None
    config = DriverScenario.model_validate(shift.config).model_dump()
    config.pop("support_steps", None)
    data = deepcopy(shift.data)
    data.update(
        balance=balance(data), reserved=reserved(data), available=balance(data) - reserved(data)
    )
    return {
        "id": shift.id,
        "mode": shift.mode,
        "config": config,
        "data": data,
        "version": shift.version,
        "created_at": shift.created_at,
        "finished_at": shift.finished_at,
        "result": shift.result,
        "events": shift.events[-200:],
    }


async def state(session, user_id):
    latest = await session.scalar(
        select(DriverShift)
        .where(DriverShift.user_id == user_id)
        .order_by(DriverShift.created_at.desc())
        .limit(1)
    )
    results = list(
        await session.scalars(
            select(DriverShift)
            .where(DriverShift.user_id == user_id, DriverShift.finished_at.is_not(None))
            .order_by(DriverShift.finished_at.desc())
            .limit(30)
        )
    )
    all_results = await session.scalars(
        select(DriverShift.result).where(
            DriverShift.user_id == user_id, DriverShift.finished_at.is_not(None)
        )
    )
    scores = [x["score"] for x in all_results if x and x.get("score") is not None]
    cases = (
        list(
            await session.scalars(
                select(DriverSupportCase)
                .where(
                    DriverSupportCase.user_id == user_id, DriverSupportCase.shift_id == latest.id
                )
                .order_by(DriverSupportCase.created_at.desc())
            )
        )
        if latest
        else []
    )
    return {
        "shift": public(latest),
        "shift_history": [
            {"id": x.id, "mode": x.mode, "finished_at": x.finished_at, "result": x.result}
            for x in results
        ],
        "shift_best": max(scores) if scores else None,
        "support_cases": [
            {
                "id": x.id,
                "topic": x.topic,
                "status": x.status,
                "step": x.step,
                "total": len(x.config["steps"]),
                "created_at": x.created_at,
                "finished_at": x.finished_at,
                "order_id": x.order_id,
            }
            for x in cases
        ],
    }


async def act(session, user_id, shift_id, payload, device):
    await require_shift(session, user_id, shift_id, device)
    try:
        await perform_action(session, user_id, shift_id, payload, device)
    except DomainError as error:
        await session.rollback()
        shift = await require_shift(session, user_id, shift_id, device)
        duplicate = any(
            x.get("details", {}).get("request_id") == str(payload.request_id) for x in shift.events
        )
        if not shift.finished_at and not duplicate and len(shift.events) < 3000:
            data = deepcopy(shift.data)
            data["invalid_actions"] = data.get("invalid_actions", 0) + 1
            await save(
                session,
                shift,
                data,
                "error",
                uuid4(),
                {
                    "request_id": str(payload.request_id),
                    "action": payload.action,
                    "reason": error.message,
                },
            )
            await session.commit()
        raise


async def perform_action(session, user_id, shift_id, payload, device):
    shift = await require_shift(session, user_id, shift_id, device)
    existing = next((x for x in shift.events if x["id"] == str(payload.request_id)), None)
    if existing:
        if existing["action"] != payload.action or existing["details"] != payload.values:
            raise ConflictError("Запрос уже использован для другого действия")
        return
    if shift.finished_at:
        raise ConflictError("Эта смена завершена. Начните новую или откройте результат.")
    data, config, values = deepcopy(shift.data), shift.config, payload.values
    action = payload.action
    order = await session.scalar(
        select(DriverOrder)
        .where(DriverOrder.user_id == user_id, DriverOrder.active_slot == 1)
        .with_for_update()
    )
    if action == "visit":
        view = values.get("view")
        if view not in VIEWS:
            raise DomainError("Раздел не найден")
        if view == "transaction":
            entry = next((x for x in data["ledger"] if x["id"] == values.get("id")), None)
            if not entry:
                raise NotFoundError("Операция не найдена")
            if entry["kind"] == "withdraw" and data["payout_problem"]:
                data["problem_inspected"] = True
            if (
                data["support_completed"]
                and entry["kind"] == "withdraw"
                and entry["status"] == "complete"
            ):
                data["support_return_checked"] = True
        if view not in data["seen"]:
            data["seen"].append(view)
    elif action == "setting":
        key, value = values.get("key"), values.get("value")
        if key not in data["settings"]:
            raise DomainError("Настройка не найдена")
        before = data["settings"][key]
        if type(before) is bool and type(value) is not bool:
            raise DomainError("Выберите состояние переключателя")
        if key == "volume":
            integer(value, 0, 100)
        options = {
            "theme": ("dark", "light", "system"),
            "navigation": ("internal", "overview"),
            "location": ("gps",),
        }
        if key in options and value not in options[key]:
            raise DomainError("Выберите доступный вариант")
        data["settings"][key] = value
    elif action == "tariff":
        tariff = next((x for x in config["tariffs"] if x["id"] == values.get("id")), None)
        if not tariff or not tariff["available"]:
            raise ConflictError(tariff["reason"] if tariff else "Тариф не найден")
        if order:
            raise ConflictError("Тарифы меняются между заказами")
        if tariff["id"] in data["tariffs"]:
            if len(data["tariffs"]) == 1:
                raise ConflictError("Оставьте хотя бы один тариф")
            data["tariffs"].remove(tariff["id"])
        else:
            data["tariffs"].append(tariff["id"])
    elif action == "payment":
        if values.get("value") not in ("any", "cash", "card") or order:
            raise ConflictError("Выберите способ оплаты между заказами")
        data["payment"] = values["value"]
    elif action == "car_add":
        if order or len(data["cars"]) >= 10:
            raise ConflictError("Добавление транспорта сейчас недоступно")
        data["cars"].append(
            {
                "id": str(uuid4()),
                "brand": text(values.get("brand"), 50),
                "model": text(values.get("model"), 50),
                "year": integer(values.get("year"), 1990, utcnow().year + 1),
                "plate": text(values.get("plate"), 16),
                "status": "checking",
            }
        )
    elif action == "car_select":
        car = next((x for x in data["cars"] if x["id"] == values.get("id")), None)
        if order or not car:
            raise ConflictError("Выберите автомобиль между заказами")
        data["car_id"] = car["id"]
        if car["status"] != "available":
            data["photo_status"], data["photo_steps"] = "required", []
    elif action == "photo_restart":
        if order:
            raise ConflictError("Проверка запускается между заказами")
        data["photo_status"], data["photo_steps"] = "required", []
        data["online"] = False
    elif action == "photo_step":
        step = integer(values.get("step"), 0, 4)
        if step != len(data["photo_steps"]):
            raise ConflictError("Снимайте ракурсы по порядку")
        data["photo_steps"].append(step)
        data["photo_status"] = "in_progress"
    elif action == "photo_submit":
        if data["photo_steps"] != list(range(5)):
            raise ConflictError("Сначала пройдите пять ракурсов проверки")
        data["photo_status"] = "passed"
        for car in data["cars"]:
            if car["id"] == data["car_id"]:
                car["status"] = "available"
        data["messages"].append(
            {
                "id": str(uuid4()),
                "channel": "warnings",
                "title": "Фотоконтроль пройден",
                "text": "Учебный автомобиль допущен к заказам.",
                "at": utcnow().isoformat(),
            }
        )
    elif action == "provider":
        if values.get("value") not in ("Sapar", "ЦНТ", "Payda", "Бумажный документооборот"):
            raise DomainError("Выберите провайдера из списка")
        data["provider"] = values["value"]
    elif action == "doc_sign":
        document = next((x for x in data["documents"] if x["id"] == values.get("id")), None)
        if not document or not data["provider"]:
            raise ConflictError("Сначала выберите провайдера электронного документооборота")
        document.update(status="signed", signed_at=utcnow().isoformat())
    elif action == "wallet":
        value = integer(values.get("amount"), 100, 100000)
        kind = values.get("kind")
        if kind not in ("topup", "withdraw"):
            raise DomainError("Выберите операцию")
        insufficient = kind == "withdraw" and value > balance(data) - reserved(data)
        ledger(
            data,
            "Учебное пополнение" if kind == "topup" else "Учебная выплата",
            value if kind == "topup" else -value,
            kind,
            status="failed"
            if insufficient
            else "pending"
            if kind == "withdraw" and shift.mode == "assessment" and data["payout_problem"]
            else "complete",
            note="Недостаточно доступных средств. Учебная выплата не выполнена."
            if insufficient
            else "Операция в учебном кошельке. Настоящие деньги не переводятся.",
        )
    elif action == "promo":
        code = text(values.get("code"), 40).upper()
        if code != "PULS500" or code in data["promos"]:
            raise ConflictError("Промокод недействителен или уже использован")
        data["promos"].append(code)
        ledger(data, "Учебный промокод PULS500", 500, "bonus", note="Одно применение за смену")
    elif action == "intercity_create":
        origin, destination = text(values.get("origin")), text(values.get("destination"))
        if origin.casefold() == destination.casefold():
            raise DomainError("Выберите разные города")
        try:
            date = datetime.fromisoformat(text(values.get("date"), 10))
            start_at = datetime.fromisoformat(f"{date.date()}T{text(values.get('from_time'), 5)}")
            end_at = datetime.fromisoformat(f"{date.date()}T{text(values.get('to_time'), 5)}")
        except ValueError as exc:
            raise DomainError("Проверьте дату и время") from exc
        if (
            not 0 <= (date.date() - utcnow().date()).days <= 30
            or not 0 < (end_at - start_at).total_seconds() <= 10800
        ):
            raise DomainError("Дата — в ближайшие 30 дней, интервал — до 3 часов")
        if values.get("kind") not in ("seats", "whole"):
            raise DomainError("Выберите попутчиков или весь салон")
        data["bookings"].append(
            {
                "id": str(uuid4()),
                "origin": origin,
                "destination": destination,
                "date": str(date.date()),
                "from_time": values["from_time"],
                "to_time": values["to_time"],
                "kind": values["kind"],
                "seats": integer(values.get("seats"), 1, 4),
                "price": integer(values.get("price"), 100, 100000),
                "status": "published",
            }
        )
    elif action in ("intercity_book", "intercity_cancel"):
        if action == "intercity_cancel":
            item = next((x for x in data["bookings"] if x["id"] == values.get("id")), None)
            if not item:
                raise NotFoundError("Заявка не найдена")
            item["status"] = "cancelled"
        else:
            choices = {
                "korday": ("Кордай", 12000),
                "konaev": ("Конаев", 7500),
                "zharkent": ("Жаркент", 14400),
            }
            key = values.get("id")
            if key not in choices:
                raise NotFoundError("Предложение не найдено")
            if any(
                x.get("offer_id") == key and x["status"] != "cancelled" for x in data["bookings"]
            ):
                raise ConflictError("Вы уже выбрали это предложение")
            destination, price = choices[key]
            data["bookings"].append(
                {
                    "id": str(uuid4()),
                    "offer_id": key,
                    "origin": "Алматы",
                    "destination": destination,
                    "price": price,
                    "date": str(utcnow().date()),
                    "from_time": "18:00",
                    "to_time": "20:00",
                    "kind": "whole",
                    "seats": 4,
                    "status": "booked",
                }
            )
    elif action == "rental":
        car = values.get("id")
        if car not in ("elantra", "emgrand", "sonata"):
            raise NotFoundError("Автомобиль не найден")
        if any(x["car"] == car for x in data["rentals"]):
            raise ConflictError("Учебная заявка на этот автомобиль уже создана")
        data["rentals"].append(
            {
                "id": str(uuid4()),
                "car": car,
                "contact": text(values.get("contact"), 80),
                "status": "sent",
            }
        )
    elif action == "refuel":
        liters = integer(values.get("liters"), 1, 80)
        cost = liters * 245
        if cost > balance(data) - reserved(data):
            raise ConflictError("Пополните учебный баланс для заправки")
        entry = ledger(data, "Учебная заправка", -cost, "fuel", note=f"{liters} л × 245 ₸")
        data["fuel"].append(
            {
                "id": entry["id"],
                "station": "Учебная АЗС",
                "liters": liters,
                "cost": cost,
                "at": entry["at"],
            }
        )
    elif action == "learning":
        lesson = values.get("id")
        if lesson not in ("tariffs", "standards", "safety"):
            raise NotFoundError("Материал не найден")
        if lesson not in data["lessons"]:
            data["lessons"].append(lesson)
    elif action == "work_mode":
        if order or values.get("mode") not in ("all", "home", "area", "business"):
            raise ConflictError("Режим выбирается между заказами")
        data["work_mode"] = values["mode"]
        data["mode_address"] = text(values.get("address", ""), minimum=0)
    elif action in ("online", "offline"):
        if action == "offline" and order:
            raise ConflictError("Завершите активный заказ, чтобы уйти с линии")
        if action == "online":
            check_online(shift, data)
        data["online"] = action == "online"
    elif action == "passenger":
        if not order or order.stage not in ("pickup", "waiting", "trip"):
            raise ConflictError("Связь с пассажиром доступна в активном заказе")
        message = text(values.get("text"), 500)
        data["passenger_messages"].append(
            {
                "order_id": order.id,
                "text": message,
                "reply": "Учебный звонок: пассажир не ответил. Попробуйте написать."
                if values.get("call") and len(data["passenger_messages"]) % 2 == 0
                else "Сейчас выйду к точке А."
                if order.stage != "trip"
                else "Спасибо, едем к указанному адресу.",
                "at": utcnow().isoformat(),
            }
        )
    elif action == "route_change":
        if order and (order.details or {}).get("navigation"):
            raise ConflictError("Выберите новую точку Б и постройте маршрут в заказе")
        if not order or order.stage != "trip":
            raise ConflictError("Адрес можно изменить во время учебной поездки")
        destination = text(values.get("destination"), minimum=3)
        if destination.casefold() == order.origin.casefold():
            raise DomainError("Точка Б должна отличаться от точки А")
        order.destination = destination
        order.details = {**(order.details or {}), "route_changed": True}
        order.version += 1
        data["route_changed"] = True
    elif action == "level_restore":
        if not data["level_restored"]:
            data["level_restored"] = True
            data["points"] = max(data["points"], config["initial_points"])
    elif action == "hint":
        data["hints"] += 1
    elif action == "finish":
        if order:
            raise ConflictError("Сначала завершите или отмените активный заказ")
        data["online"] = False
        await save(
            session, shift, data, action, payload.request_id, values, checked_result(shift, data)
        )
        return
    await save(session, shift, data, action, payload.request_id, values)


def check_online(shift, data):
    if data["photo_status"] != "passed":
        raise ConflictError("Для выхода на линию пройдите Профиль → Фотоконтроль")
    car = next(x for x in data["cars"] if x["id"] == data["car_id"])
    if car["status"] != "available":
        raise ConflictError("Автомобиль требует учебной проверки")


async def record_order(session, order, action):
    if not order.shift_id:
        return
    shift = await session.scalar(
        select(DriverShift)
        .where(DriverShift.id == order.shift_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    data = deepcopy(shift.data)
    config = shift.config
    if action == "pay":
        if any(x.get("order_id") == order.id for x in data["ledger"]):
            return
        data["completed"] += 1
        data["points"] += 100
        data["points_history"].append(
            {"order_id": order.id, "points": 100, "at": utcnow().isoformat()}
        )
        data["priority"] = min(100, data["priority"] + config["priority_complete"])
        data["rating_votes"][4] += 1
        details = order.details or {}
        if details.get("navigation"):
            data.setdefault("order_results", []).append(
                {
                    "id": order.id,
                    "origin": order.origin,
                    "destination": order.destination,
                    "fare": order.fare,
                    "payment": order.payment,
                    "navigation": deepcopy(details["navigation"]),
                }
            )
        ledger(
            data,
            "Доход от заказа",
            order.fare,
            "order",
            order.id,
            note=f"{order.origin} → {order.destination}",
        )
        for key, title, value in [
            ("service", "Комиссия сервиса", details.get("service_fee", 0)),
            ("tax", "НДС с комиссии", details.get("service_tax", 0)),
            ("park", "Комиссия парка", order.commission),
        ]:
            if value:
                ledger(
                    data,
                    title,
                    -value,
                    key,
                    order.id,
                    note="Условия учебного сценария на момент принятия заказа",
                )
        if (
            shift.mode == "assessment"
            and config["require_support"]
            and data["completed"] == min(2, config["target_orders"])
        ):
            data["payout_problem"] = True
            available = balance(data) - reserved(data)
            if available >= 1000:
                ledger(
                    data,
                    "Учебная выплата · задержана",
                    -1000,
                    "withdraw",
                    status="pending",
                    note=(
                        "Событие сценария: выясните причину задержки, проверьте детали и "
                        "обратитесь в поддержку."
                    ),
                )
            data["messages"].append(
                {
                    "id": str(uuid4()),
                    "channel": "warnings",
                    "title": "Обращение по выплате",
                    "text": (
                        "Водитель не получил выплату. Проверьте учебные операции и "
                        "разберите обращение в Telegram."
                    ),
                    "at": utcnow().isoformat(),
                }
            )
    elif action in ("cancel", "missed"):
        key = "missed" if action == "missed" else "cancelled"
        data[key] += 1
        if shift.mode == "assessment":
            data["priority"] = max(0, data["priority"] - config[f"priority_{key}"])
    await save(session, shift, data, f"order_{action}", uuid4(), {"order_id": order.id})
