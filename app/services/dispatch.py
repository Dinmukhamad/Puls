"""Training fleet cabinet «Диспетчерская»: the shipped seed plus the operator's accepted events.

The client sends only what the operator typed or chose. Every change is validated here, and
whether it solves one of the mascot's calls is decided here too, never by the client.
Each operator has an own copy: events are per user, and «Сбросить» starts the cabinet over
without taking away solved calls.
"""

import re
import secrets
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from functools import cache
from random import Random
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.errors import DomainError, NotFoundError
from app.models.crm import CrmAppeal
from app.models.dispatch import DispatchEvent
from app.services.crm_catalog import default_categories
from app.services.dispatch_data import (
    ADDRESSES,
    ANTIFRAUD,
    ANTIFRAUD_RULES,
    BLOCKED,
    CALL_IDS,
    CALLS,
    DRIVER_KEYS,
    DRIVERS,
    INVENTORY,
    INVENTORY_LOG,
    MISSION_CALLS,
    PARK_IDS,
    PARKS,
    PROVIDERS,
    SCENARIO_ORDERS,
    STOCK,
    TARIFFS,
    THEMES,
    TICKETS,
    TRAINING_DOMAIN,
    WORK_RULES,
)
from app.services.learning import lock_learner

# The courier's code in Яндекс Про lives two minutes and is good for one operation.
CODE_TTL = 120
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
# Documents and hiring dates do not move; orders and holds are counted back from «now».
SEED_DAY = date(2026, 9, 29)
# The training support answers a new ticket after two minutes.
REPLY_AFTER = 120
LICENSE = re.compile(r"^[A-Z]{2}\d{6}$")
BOX_NUMBER = re.compile(r"^[A-ZА-ЯЁ0-9-]{3,12}$")
# «ДД» — «Добрый день»: the support expects every text to open like this.
GREETING = re.compile(r"^\s*дд\s*!\s*прошу\s+проверить", re.IGNORECASE)
PARK_BY_ID = {p["id"]: p for p in PARKS}
KEY_BY_ID = {d["id"]: d["key"] for d in DRIVERS}
COURIER_THEME = "Вопросы об исполнителе"
SUPPORT_SUBTHEME = "Ограничение доступа к сервису"


def local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.TIMEZONE)).replace(tzinfo=None, microsecond=0)


def aware(moment: datetime) -> datetime:
    # SQLite hands back naive UTC timestamps, PostgreSQL aware ones.
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def local(moment: datetime) -> datetime:
    return aware(moment).astimezone(ZoneInfo(settings.TIMEZONE)).replace(tzinfo=None)


def iso(moment: datetime | date) -> str:
    if isinstance(moment, datetime):
        return moment.replace(microsecond=0).isoformat()
    return moment.isoformat()


def full_name(d: dict) -> str:
    return " ".join(part for part in (d["last_name"], d["first_name"], d["middle_name"]) if part)


def plain(value: str) -> str:
    return re.sub(r"\s+", "", value or "").upper()


def login_of(user) -> str:
    return user.email or f"{user.login}@{TRAINING_DOMAIN}"


@cache
def limit_categories() -> frozenset[str]:
    return frozenset(n["id"] for n in default_categories() if n["label"] == "Снятие лимита")


def fold(events: list[DispatchEvent]) -> dict:
    """The seed with the events since the last reset applied, still keyed by seed keys."""
    drivers = {d["key"]: deepcopy(d) for d in DRIVERS}
    stock = dict(STOCK)
    moves, tickets = [], []
    start = max((i + 1 for i, e in enumerate(events) if e.kind == "reset"), default=0)
    for event in events[start:]:
        p = event.payload
        if event.kind == "details":
            drivers[p["driver"]]["provider"] = p["provider"]
        elif event.kind == "car":
            car = drivers[p["driver"]]["car"]
            # Branding switched on again needs a fresh photo check of the wrap.
            if not p["wrap"] or not car["wrap"]:
                car["wrap_checked"] = False
            car.update(tariffs=p["tariffs"], wrap=p["wrap"], lightbox=p["lightbox"])
        elif event.kind == "issue":
            drivers[p["driver"]]["thermobox"] = {"type": p["type"], "number": p["number"]}
            stock[p["type"]] -= 1
            moves.append(event)
        elif event.kind == "return":
            drivers[p["driver"]]["thermobox"] = None
            stock[p["type"]] += 1
            moves.append(event)
        elif event.kind == "ticket":
            tickets.append(event)
    return {"drivers": drivers, "stock": stock, "moves": moves, "tickets": tickets}


def code_status(events: list[DispatchEvent], code: str, now: datetime):
    """The latest code event with this value and whether it can still be used."""
    used = {e.payload.get("code_event") for e in events if e.kind in ("issue", "return")}
    codes = (e for e in reversed(events) if e.kind == "code" and e.payload["code"] == code)
    match = next(codes, None)
    if not match:
        return None, "unknown"
    if match.id in used:
        return match, "used"
    if datetime.fromisoformat(match.payload["expires"]) <= now:
        return match, "expired"
    return match, "ok"


def active_code(events: list[DispatchEvent], driver_key: str, now: datetime):
    codes = (e for e in reversed(events) if e.kind == "code" and e.payload["driver"] == driver_key)
    latest = next(codes, None)
    if not latest:
        return None
    event, status = code_status(events, latest.payload["code"], now)
    return event if status == "ok" else None


def priority(d: dict) -> dict:
    car, items = d["car"], []

    def add(label, value, top, hint=""):
        items.append({"label": label, "points": value, "max": top, "hint": hint})

    add("Принятые заказы", d["acceptance"], 30)
    self_employed = d["employment"] in ("Парковый самозанятый", "Самозанятый", "ИП")
    add("Тип сотрудничества", 15 if self_employed else 0, 15)
    add("Рейтинг выше 4,95", 9 if (d["rating"] or 0) > 4.95 else 0, 9)
    if car:
        add("Год выпуска автомобиля", max(0, min(15, round((car["year"] - 2010) * 1.25))), 15)
        waiting = car["wrap"] and not car["wrap_checked"]
        add(
            "Брендинг машины",
            18 if car["wrap"] and car["wrap_checked"] else 0,
            18,
            "Оклейка включена — осталось пройти фотоконтроль брендинга" if waiting else "",
        )
        add("Заправка через Про", 6 if d["refuel"] else 0, 6)
    else:
        add(
            "Фотоконтроль термокороба",
            0,
            10,
            "Термокороб выдан — осталось пройти его фотоконтроль в Яндекс Про"
            if d["thermobox"]
            else "Выдайте термокороб в «Инвентаре»",
        )
    value, top = sum(i["points"] for i in items), sum(i["max"] for i in items)
    label = (
        "Выдающийся приоритет"
        if value >= 50
        else "Высокий приоритет"
        if value >= 35
        else "Средний приоритет"
        if value >= 20
        else "Низкий приоритет"
    )
    return {
        "value": value,
        "max": top,
        "label": label,
        "got": [i for i in items if i["points"]],
        "can": [{**i, "points": i["max"]} for i in items if not i["points"]],
    }


def diagnostics(d: dict) -> dict:
    reasons = list(d["diagnostics"])
    if not d["works"]:
        reasons.insert(0, "Исполнитель не работает в парке: статус «Не работает»")
    title = (
        "Всё в порядке"
        if not reasons
        else "Нет доступа к заказам"
        if not d["works"]
        else "Доступ ограничен"
        if BLOCKED in reasons
        else "Доступ временно приостановлен"
    )
    return {"ok": not reasons, "title": title, "reasons": reasons}


def orders(d: dict, index: int, now: datetime) -> list[dict]:
    rng = Random(f"{d['key']}:orders")
    pool = ADDRESSES[PARK_BY_ID[d["park"]]["city"]]
    car = d["car"]
    if d["profession"] == "Курьер":
        tariffs = ["Курьер", "Доставка"]
    else:
        tariffs = [
            t for t in (car or {}).get("tariffs", []) if t not in ("Межгород", "Курьер", "Доставка")
        ] or ["Эконом"]
    rows, end = [], now - timedelta(minutes=rng.randrange(15, 80))
    for i in range(d["orders"]):
        minutes = rng.randrange(5, 24)
        start = end - timedelta(minutes=minutes)
        created = start - timedelta(minutes=rng.randrange(2, 7))
        cancelled = i > 0 and rng.random() < 0.15
        origin, target = rng.sample(pool, 2)
        distance = round(minutes * rng.uniform(0.3, 0.65), 2)
        rows.append(
            {
                "id": str(86_000_000 + index * 10_000 + i * 37 + rng.randrange(30)),
                "status": "cancelled" if cancelled else "complete",
                "cancel_reason": rng.choice(
                    ["Заказ отменён клиентом", "Не смогли назначить заказ на водителя"]
                )
                if cancelled
                else "",
                "created_at": iso(created),
                "finished_at": iso(end),
                "from": origin,
                "to": target,
                "tariff": rng.choice(tariffs),
                "distance": 0 if cancelled else distance,
                "duration": 0 if cancelled else minutes * 60,
                "price": 0 if cancelled else int(round((300 + distance * 120) / 10) * 10),
                "payment": rng.choice(["cash", "card"]),
                "tips": 0 if cancelled else rng.choice([0, 0, 0, 100, 200]),
            }
        )
        end = created - timedelta(minutes=rng.randrange(6, 60))
    for s in SCENARIO_ORDERS.get(d["key"], []):
        finished = now - timedelta(minutes=s["minutes_ago"])
        rows.append(
            {
                "id": s["id"],
                "status": "complete",
                "cancel_reason": "",
                "created_at": iso(finished - timedelta(seconds=s["duration"] + 240)),
                "finished_at": iso(finished),
                "from": s["from"],
                "to": s["to"],
                "tariff": s["tariff"],
                "distance": s["distance"],
                "duration": s["duration"],
                "price": s["price"],
                "payment": s["payment"],
                "tips": 0,
            }
        )
    rows.sort(key=lambda o: o["created_at"], reverse=True)
    return rows


def build(events: list[DispatchEvent], *, user, now: datetime, utc_now: datetime, crm=frozenset()):
    """The cabinet as the client shows it. `crm` holds the drivers with a limit request in CRM."""
    cabinet = fold(events)
    drivers, login = cabinet["drivers"], login_of(user)
    solved = {e.solved for e in events if e.solved}
    tickets = []
    for event in cabinet["tickets"]:
        p, created = event.payload, local(event.created_at)
        replied = (utc_now - aware(event.created_at)).total_seconds() >= REPLY_AFTER
        # Support lifts the restriction the ticket was about once it replies.
        if replied and event.solved == "support":
            drivers[CALL_IDS["support"]["driver"]]["diagnostics"] = []
        tickets.append(
            {
                "id": f"M-{event.id}",
                "question": p["text"],
                "theme": p["theme"],
                "subtheme": p["subtheme"],
                "status": "Выполнен" if replied else "В работе",
                "reply": (
                    "Здравствуйте! Проверили обращение и приняли решение. Подробности — в "
                    "карточке исполнителя."
                )
                if replied
                else "",
                "author": login,
                "created_at": iso(created),
                "updated_at": iso(created + timedelta(seconds=REPLY_AFTER) if replied else created),
                "private": p["private"],
                "kind": p["kind"],
                "license": p["license"],
                "files": p["files"],
                "park": p["park"],
                "mine": True,
            }
        )
    tickets.reverse()
    for n, (text, theme, subtheme, status, author, updated, created) in enumerate(TICKETS):
        tickets.append(
            {
                "id": f"S-{n + 1}",
                "question": text,
                "theme": theme,
                "subtheme": subtheme,
                "status": status,
                "reply": "",
                "author": f"{author}@{TRAINING_DOMAIN}",
                "created_at": iso(now - timedelta(minutes=created)),
                "updated_at": iso(now - timedelta(minutes=updated)),
                "private": False,
                "kind": "text",
                "license": "",
                "files": [],
                "park": "itaxi-krg",
                "mine": False,
            }
        )
    log = [
        {
            "employee": login,
            "driver": drivers[e.payload["driver"]]["id"],
            "driver_name": full_name(drivers[e.payload["driver"]]),
            "operation": "Выдача" if e.kind == "issue" else "Возврат",
            "type": e.payload["type"],
            "number": e.payload["number"],
            "qty": 1,
            "at": iso(local(e.created_at)),
            "park": e.payload["park"],
        }
        for e in reversed(cabinet["moves"])
    ]
    log += [
        {
            "employee": f"{employee}@{TRAINING_DOMAIN}",
            "driver": None,
            "driver_name": name,
            "operation": "Выдача" if operation == "issue" else "Возврат",
            "type": kind,
            "number": "",
            "qty": 1,
            "at": iso(now - timedelta(days=days, hours=3)),
            "park": None,
        }
        for employee, name, operation, kind, days in INVENTORY_LOG
    ]
    held = {}
    for row in ANTIFRAUD:
        held[row["driver"]] = held.get(row["driver"], 0) + row["amount"]
    all_orders = {}
    out = []
    today = now.date()
    monday = today - timedelta(days=today.weekday() + 7)
    for index, d in enumerate(drivers.values()):
        rows = orders(d, index, now)
        all_orders.update({o["id"]: o for o in rows})
        bonus = d["bonus"] and {
            **d["bonus"],
            "from": iso(monday),
            "to": iso(monday + timedelta(days=6)),
            "place": PARK_BY_ID[d["park"]]["city"],
            "tariffs": "Эконом, Комфорт, Доставка, Курьер или Межгород",
        }
        issued = SEED_DAY - timedelta(days=d["license_issued_days"])
        out.append(
            {
                "id": d["id"],
                "park": d["park"],
                "last_name": d["last_name"],
                "first_name": d["first_name"],
                "middle_name": d["middle_name"],
                "phone": d["phone"],
                "license": d["license"],
                "license_country": d["license_country"] if d["license"] else "",
                "license_issued": iso(issued) if d["license"] else "",
                "license_expires": iso(issued + timedelta(days=3652)) if d["license"] else "",
                "experience_since": iso(SEED_DAY - timedelta(days=d["experience_days"]))
                if d["license"]
                else "",
                "iin": d["iin"],
                "address": d["address"],
                "segment": d["segment"],
                "works": d["works"],
                "status": d["status"],
                "gps": d["gps"],
                "employment": d["employment"],
                "profession": d["profession"],
                "rule": d["rule"],
                "provider": d["provider"],
                "balance": d["balance"],
                "account_limit": d["account_limit"],
                "withdraw_limit": round(held.get(d["key"], 0), 2),
                "rating": d["rating"],
                "car": d["car"],
                "thermobox": d["thermobox"],
                "diagnostics": diagnostics(d),
                "priority": priority(d),
                "bonus": bonus or None,
                "comment": d["comment"],
                "source": d["source"],
                "device": d["device"],
                "app_version": d["app_version"],
                "created": iso(SEED_DAY - timedelta(days=d["created_days"])),
                "photo_checks": [iso(today - timedelta(days=n)) for n in d["photo_days"]],
                "orders": rows,
            }
        )
    antifraud = []
    for row in ANTIFRAUD:
        d = drivers[row["driver"]]
        order = all_orders.get(row["order"] or "")
        antifraud.append(
            {
                "driver": d["id"],
                "driver_name": full_name(d),
                "park": d["park"],
                "amount": row["amount"],
                "rule": row["rule"],
                "value": row["value"],
                "limit": row["limit"],
                "at": iso(now - timedelta(minutes=row["minutes_ago"])),
                "order": row["order"],
                "from": order["from"] if order else "",
                "to": order["to"] if order else "",
            }
        )
    calls = []
    for call in CALLS:
        d = drivers[call["driver"]]
        state = "solved" if call["id"] in solved else "new"
        if state == "solved" and call.get("crm") and call["driver"] not in crm:
            state = "crm"
        code = active_code(events, call["driver"], utc_now) if call.get("code") else None
        calls.append(
            {
                "id": call["id"],
                "mission": call["mission"],
                "title": call["title"],
                "speech": call["speech"],
                "goal": call["goal"],
                "steps": call["steps"],
                "kind": call["kind"],
                "question": call.get("question", ""),
                "options": call.get("options", []),
                "code": bool(call.get("code")),
                "crm": bool(call.get("crm")),
                "driver": d["id"],
                "driver_name": full_name(d),
                "park": d["park"],
                "state": state,
                # The explanation gives the answer away, so it comes only after the call is solved.
                "done": call["done"] if state != "new" else "",
                "attempts": sum(
                    1 for e in events if e.kind == "answer" and e.payload["call"] == call["id"]
                ),
                "active_code": {
                    "value": code.payload["code"],
                    "expires_in": max(
                        0,
                        int(
                            (
                                datetime.fromisoformat(code.payload["expires"]) - utc_now
                            ).total_seconds()
                        ),
                    ),
                }
                if code
                else None,
            }
        )
    return {
        "now": iso(now),
        "login": login,
        "parks": PARKS,
        "drivers": out,
        "rules": [{"name": n, "count": c, "default": default} for n, c, default in WORK_RULES],
        "antifraud": antifraud,
        "antifraud_rules": ANTIFRAUD_RULES,
        "inventory": {"stock": cabinet["stock"], "log": log},
        "tickets": tickets,
        "calls": calls,
        "catalog": {
            "tariffs": TARIFFS,
            "providers": PROVIDERS,
            "inventory": INVENTORY,
            "themes": THEMES,
        },
        "revision": len(events),
    }


async def history(session, user_id: int) -> list[DispatchEvent]:
    return list(
        await session.scalars(
            select(DispatchEvent).where(DispatchEvent.user_id == user_id).order_by(DispatchEvent.id)
        )
    )


async def crm_limit_requests(session, user_ids) -> dict[int, set[str]]:
    """Drivers of the limit calls each operator asked ООЗ about with a CRM «Снятие лимита»."""
    result = {uid: set() for uid in user_ids}
    if not result:
        return result
    wanted = [DRIVER_KEYS[c["driver"]] for c in CALLS if c.get("crm")]
    rows = await session.execute(
        select(
            CrmAppeal.author_id,
            CrmAppeal.category_ids,
            CrmAppeal.comment,
            CrmAppeal.license_number,
        ).where(CrmAppeal.author_id.in_(user_ids))
    )
    for uid, categories, comment, license_number in rows:
        if not limit_categories().intersection(categories):
            continue
        for d in wanted:
            if d["id"] in (comment or "").lower() or plain(license_number) == d["license"]:
                result[uid].add(d["key"])
    return result


async def solved_calls(session, user_ids) -> dict[int, set[str]]:
    """Calls each operator solved; a call that needs a CRM request counts once it is made."""
    result = {uid: set() for uid in user_ids}
    if not result:
        return result
    rows = await session.execute(
        select(DispatchEvent.user_id, DispatchEvent.solved).where(
            DispatchEvent.user_id.in_(user_ids), DispatchEvent.solved.is_not(None)
        )
    )
    for uid, call in rows:
        result[uid].add(call)
    crm = await crm_limit_requests(session, user_ids)
    for uid, calls in result.items():
        for call in CALLS:
            if call.get("crm") and call["driver"] not in crm[uid]:
                calls.discard(call["id"])
    return result


def mission_facts(calls: set[str]) -> dict[str, int]:
    return {mission: len(calls.intersection(ids)) for mission, ids in MISSION_CALLS.items()}


async def state(session, user) -> dict:
    events = await history(session, user.id)
    crm = (await crm_limit_requests(session, [user.id]))[user.id]
    return build(events, user=user, now=local_now(), utc_now=datetime.now(UTC), crm=crm)


def driver_key(driver_id: str) -> str:
    key = KEY_BY_ID.get(driver_id)
    if not key:
        raise NotFoundError("Исполнитель не найден")
    return key


async def record(session, user, request_id, kind, validate):
    """Runs `validate(events)` → (payload, solved) under the operator's lock and keeps the event.

    A repeated request id returns the stored outcome instead of acting twice.
    """
    request_id = str(request_id)
    await lock_learner(session, user.id)
    events = await history(session, user.id)
    existing = next((e for e in events if e.request_id == request_id), None)
    if existing is None:
        payload, solved = validate(events)
        existing = DispatchEvent(
            user_id=user.id, request_id=request_id, kind=kind, payload=payload, solved=solved
        )
        session.add(existing)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            existing = await session.scalar(
                select(DispatchEvent).where(
                    DispatchEvent.user_id == user.id, DispatchEvent.request_id == request_id
                )
            )
    return {"state": await state(session, user), "result": existing.payload.get("result", {})}


def same_person_active(key: str, drivers: dict) -> dict | None:
    d = drivers[key]
    if d["works"] or not d["license"]:
        return None
    return next(
        (o for o in drivers.values() if o["license"] == d["license"] and o["works"]), None
    )


async def save_details(session, user, driver_id: str, body):
    key = driver_key(driver_id)

    def validate(events):
        if body.provider not in PROVIDERS:
            raise DomainError("Выберите провайдера ЭДО из списка")
        drivers = fold(events)["drivers"]
        call = CALL_IDS["provider"]
        solved = "provider" if key == call["driver"] and body.provider == "Sapar" else None
        note = ""
        if same_person_active(key, drivers):
            note = (
                "Это архивный аккаунт: водитель работает с другого. Найди аккаунт со статусом "
                "«Работает» и измени провайдера там."
            )
        return {"driver": key, "provider": body.provider, "result": {"note": note}}, solved

    return await record(session, user, body.request_id, "details", validate)


async def save_car(session, user, driver_id: str, body):
    key = driver_key(driver_id)

    def validate(events):
        d = fold(events)["drivers"][key]
        if not d["car"]:
            raise DomainError("У исполнителя нет автомобиля")
        tariffs = list(dict.fromkeys(body.tariffs))
        if not tariffs:
            raise DomainError("Оставьте хотя бы один тариф")
        unknown = [t for t in tariffs if t not in TARIFFS]
        if unknown:
            raise DomainError(f"Нет такого тарифа: {unknown[0]}")
        call, note, solved = CALL_IDS["car"], "", None
        if key == call["driver"]:
            kept = [t for t in DRIVER_KEYS[key]["car"]["tariffs"] if t not in tariffs]
            if "Комфорт" not in tariffs:
                note = "Водитель просил подключить тариф «Комфорт»."
            elif kept:
                note = (
                    "Водитель просил только добавить «Комфорт». Верни тарифы: "
                    f"{', '.join(kept)}."
                )
            elif not body.wrap:
                note = "Водитель оклеил машину — отметь «Оклейка» и сохрани ещё раз."
            else:
                solved = "car"
        payload = {
            "driver": key,
            "tariffs": tariffs,
            "wrap": body.wrap,
            "lightbox": body.lightbox,
            "result": {"note": note},
        }
        return payload, solved

    return await record(session, user, body.request_id, "car", validate)


async def request_code(session, user, body):
    """The courier opens Профиль → Инвентарь → Получить код; the mascot reads it out."""
    key = driver_key(body.driver)
    await lock_learner(session, user.id)
    events = await history(session, user.id)
    now = datetime.now(UTC)
    current = active_code(events, key, now)
    if current is None:
        taken = {e.payload["code"] for e in events if e.kind == "code"}
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        while code in taken:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        current = DispatchEvent(
            user_id=user.id,
            request_id=str(body.request_id),
            kind="code",
            payload={
                "driver": key,
                "code": code,
                "expires": (now + timedelta(seconds=CODE_TTL)).isoformat(),
            },
        )
        session.add(current)
        try:
            await session.commit()
        except IntegrityError:
            # The same request came twice: the first one already made the code.
            await session.rollback()
            current = await session.scalar(
                select(DispatchEvent).where(
                    DispatchEvent.user_id == user.id,
                    DispatchEvent.request_id == str(body.request_id),
                )
            )
    remaining = datetime.fromisoformat(current.payload["expires"]) - datetime.now(UTC)
    return {
        "state": await state(session, user),
        "result": {
            "code": current.payload["code"],
            "expires_in": max(0, int(remaining.total_seconds())),
        },
    }


def courier_by_code(events, body, now):
    if body.park not in PARK_IDS:
        raise DomainError("Выберите парк в правом верхнем углу")
    if body.type not in INVENTORY:
        raise DomainError("Выберите тип инвентаря")
    code = plain(body.code)
    if not re.fullmatch(r"[A-Z0-9]{5}", code):
        raise DomainError("Код для получения — 5 латинских букв и цифр")
    event, status = code_status(events, code, now)
    if status == "unknown":
        raise DomainError(
            "Код не найден. Исполнитель берёт его в Яндекс Про: Профиль → Инвентарь → Получить код"
        )
    if status == "used":
        raise DomainError("Этот код уже использован. Попросите исполнителя получить новый")
    if status == "expired":
        raise DomainError("Код устарел: он обновляется каждые 2 минуты. Попросите новый код")
    key = event.payload["driver"]
    if DRIVER_KEYS[key]["park"] != body.park:
        park = PARK_BY_ID[body.park]
        raise DomainError(
            f"В парке «{park['name']}, {park['city']}» нет исполнителя с этим кодом. "
            "Проверьте парк и город в правом верхнем углу"
        )
    return key, event


async def issue_inventory(session, user, body):
    def validate(events):
        key, code_event = courier_by_code(events, body, datetime.now(UTC))
        cabinet = fold(events)
        d = cabinet["drivers"][key]
        number = plain(body.number)
        if not BOX_NUMBER.fullmatch(number):
            raise DomainError("Номер инвентаря — от 3 до 12 букв и цифр, как на термокоробе")
        if d["thermobox"]:
            raise DomainError(
                "У исполнителя уже есть термокороб. Сначала примите его кнопкой «Вернуть»"
            )
        if any((o["thermobox"] or {}).get("number") == number for o in cabinet["drivers"].values()):
            raise DomainError(f"Термокороб с номером {number} уже выдан другому исполнителю")
        if cabinet["stock"][body.type] <= 0:
            raise DomainError("На складе не осталось термокоробов этого типа")
        call, note, solved = CALL_IDS["thermobox"], "", None
        if key == call["driver"]:
            if body.type == "eda":
                solved = "thermobox"
            else:
                note = (
                    "Курьер просил жёлтый короб Яндекс Еды, а выдан чёрный — Яндекс Доставки. "
                    "Прими его кнопкой «Вернуть» и выдай нужный."
                )
        payload = {
            "driver": key,
            "type": body.type,
            "number": number,
            "park": body.park,
            "code_event": code_event.id,
            "result": {"note": note, "driver": d["id"], "name": full_name(d)},
        }
        return payload, solved

    return await record(session, user, body.request_id, "issue", validate)


async def return_inventory(session, user, body):
    def validate(events):
        key, code_event = courier_by_code(events, body, datetime.now(UTC))
        d = fold(events)["drivers"][key]
        number = plain(body.number)
        box = d["thermobox"]
        if not box or box["number"] != number or box["type"] != body.type:
            raise DomainError(
                f"У исполнителя нет термокороба «{INVENTORY[body.type]}» с номером {number}"
            )
        payload = {
            "driver": key,
            "type": body.type,
            "number": number,
            "park": body.park,
            "code_event": code_event.id,
            "result": {"note": "", "driver": d["id"], "name": full_name(d)},
        }
        return payload, None

    return await record(session, user, body.request_id, "return", validate)


async def create_ticket(session, user, body):
    def validate(events):
        if body.park not in PARK_IDS:
            raise DomainError("Выберите парк в правом верхнем углу")
        if body.theme not in THEMES or body.subtheme not in THEMES[body.theme]:
            raise DomainError("Выберите тему и подтему обращения")
        license_number = plain(body.license)
        if body.theme == COURIER_THEME and not LICENSE.fullmatch(license_number):
            raise DomainError("Номер в/у — две латинские буквы и шесть цифр, например KA482915")
        text = body.text.strip()
        if len(text) < 10:
            raise DomainError("Опишите вопрос: хотя бы 10 символов")
        drivers = fold(events)["drivers"]
        checks = [
            {
                "label": "«Доступ: мне и моей роли» выключен — обращение видят коллеги",
                "ok": not body.private,
            },
            {
                "label": "Текст начинается с «ДД! Прошу проверить…»",
                "ok": bool(GREETING.match(text)),
            },
        ]
        call = CALL_IDS["support"]
        target = drivers[call["driver"]]
        solved = None
        if license_number and license_number == target["license"]:
            park = PARK_BY_ID[target["park"]]
            checks += [
                {
                    "label": f"Выбран парк водителя: {park['name']}, {park['city']}",
                    "ok": body.park == target["park"],
                },
                {"label": f"Тема «{COURIER_THEME}»", "ok": body.theme == COURIER_THEME},
                {"label": f"Подтема «{SUPPORT_SUBTHEME}»", "ok": body.subtheme == SUPPORT_SUBTHEME},
            ]
            if all(c["ok"] for c in checks):
                solved = "support"
        elif license_number:
            known = any(
                d["license"] == license_number and d["park"] == body.park
                for d in drivers.values()
            )
            checks.append({"label": "Номер в/у есть у исполнителя этого парка", "ok": known})
        payload = {
            "park": body.park,
            "kind": body.kind,
            "private": body.private,
            "theme": body.theme,
            "subtheme": body.subtheme,
            "license": license_number,
            "text": text,
            "files": body.files,
            "result": {"checks": checks, "solved": bool(solved)},
        }
        return payload, solved

    return await record(session, user, body.request_id, "ticket", validate)


async def answer_call(session, user, call_id: str, body):
    call = CALL_IDS.get(call_id)
    if not call or call["kind"] != "answer":
        raise NotFoundError("Звонок не найден")

    def validate(events):
        if body.option not in {option for option, _ in call["options"]}:
            raise DomainError("Выберите один из ответов")
        correct = body.option == call["correct"]
        payload = {
            "call": call_id,
            "option": body.option,
            "correct": correct,
            "result": {"correct": correct, "text": call["done"] if correct else call["hint"]},
        }
        return payload, call_id if correct else None

    return await record(session, user, body.request_id, "answer", validate)


async def reset(session, user, body):
    return await record(session, user, body.request_id, "reset", lambda events: ({}, None))
