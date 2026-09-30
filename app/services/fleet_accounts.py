"""CRM side of the shared training fleet: the same accounts the «Диспетчерская» shows.

CRM changes a driver's car, working conditions and employment, and keeps CRM-only switches
(the cash limit, sent codes, a photo check to pass). These events go into the same per-user
log as the cabinet's own, so both work sites always show one and the same driver.
Here are the pure parts: checks that turn the operator's input into an event payload, and
applying a stored event to the folded drivers together with a line of the driver's history.
"""

import re
from copy import deepcopy
from hashlib import md5

from app.core.errors import DomainError
from app.services.dispatch_data import PARKS, TARIFFS, WORK_RULES

PLATE = re.compile(r"^[0-9A-Z]{5,9}$")
IIN = re.compile(r"^\d{12}$")
PHONE = re.compile(r"^\+77\d{9}$")
LICENSE = re.compile(r"^[A-Z]{2}\d{6}$")
RULES = [name for name, _, _ in WORK_RULES]
DEFAULT_RULE = next(name for name, _, default in WORK_RULES if default)
COURIER_RULE = "Курьеры 1%"
INDIVIDUAL = "Физическое лицо"
SELF_EMPLOYED = "Парковый самозанятый"
CASH_LIMIT = 500_000
PARK_IDS = {p["id"] for p in PARKS}
CAR_TEXT = ("brand", "model", "color", "owner", "status", "transmission", "fuel")
CRM_KINDS = {
    "crm_car", "crm_smz", "crm_individual", "crm_limit", "crm_code", "crm_photo", "crm_rule",
    "crm_register",
}  # fmt: skip


def money(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def car_payload(d: dict, body) -> dict:
    """«Автомобиль» in CRM: a new car or corrected data of the current one."""
    car = body.car
    plate = car.plate.strip().upper()
    for field in CAR_TEXT[:3]:
        if not getattr(car, field).strip():
            raise DomainError("Заполните марку, модель и цвет автомобиля")
    if not 1980 <= car.year <= 2030:
        raise DomainError("Выберите год выпуска")
    if not PLATE.match(plate):
        raise DomainError("Госномер — латинские буквы и цифры, например 803ASD02")
    replaced = not d["car"] or plate != d["car"]["plate"]
    if replaced and car.callsign.strip() != plate:
        raise DomainError("Скопируйте госномер в поле «Позывной»")
    tariffs = list(dict.fromkeys(car.tariffs))
    if not tariffs:
        raise DomainError("Отметьте хотя бы один тариф")
    unknown = [t for t in tariffs if t not in TARIFFS]
    if unknown:
        raise DomainError(f"Нет такого тарифа: {unknown[0]}")
    fields = {field: getattr(car, field).strip() for field in CAR_TEXT}
    fields |= {
        "year": car.year, "plate": plate, "callsign": car.callsign.strip(), "vin": car.vin.strip(),
        "body": car.body.strip(), "sts": car.sts.strip(), "tariffs": tariffs, "wrap": car.wrap,
        "lightbox": car.lightbox,
    }  # fmt: skip
    title = f"{fields['brand']} {fields['model']}, {plate}"
    text = (
        f"Автомобиль изменён в CRM: {title}. Требуется фотоконтроль автомобиля и техпаспорта."
        if replaced
        else f"Данные автомобиля {plate} обновлены в CRM"
    )
    return {"driver": d["key"], "car": fields, "replaced": replaced, "history": text}


def smz_payload(d: dict, body) -> dict:
    if d["employment"] != INDIVIDUAL:
        raise DomainError("Водитель уже работает как самозанятый")
    if len(body.address.strip()) < 5:
        raise DomainError("Укажите адрес прописки водителя")
    if not IIN.match(body.iin.strip()):
        raise DomainError("ИИН состоит из 12 цифр")
    if not body.last_name.strip() or not body.first_name.strip():
        raise DomainError("Укажите фамилию и имя водителя")
    if body.rule not in RULES:
        raise DomainError("Выберите условия работы из списка")
    return {
        "driver": d["key"], "last_name": body.last_name.strip(),
        "first_name": body.first_name.strip(), "middle_name": body.middle_name.strip(),
        "address": body.address.strip(), "iin": body.iin.strip(), "rule": body.rule,
        "account_limit": body.account_limit,
        "history": "Переведён в СМЗ. Водителю нужно выйти из аккаунта и снова войти в Яндекс Про.",
    }  # fmt: skip


def individual_payload(d: dict) -> dict:
    if d["employment"] == INDIVIDUAL:
        raise DomainError("Водитель уже физлицо")
    return {"driver": d["key"], "history": "Возвращён в физлицо (учебный сброс)"}


def limit_payload(d: dict, enabled: bool) -> dict:
    text = (
        f"Лимит {money(CASH_LIMIT)} ₸ включён: наличные заказы не поступают"
        if enabled
        else "Лимит отключён: наличные заказы поступают в обычном режиме"
    )
    return {"driver": d["key"], "enabled": enabled, "history": text}


def code_payload(d: dict) -> dict:
    text = f"Код подтверждения для Такси Про отправлен на {d['phone']}"
    return {"driver": d["key"], "history": text}


def photo_payload(d: dict) -> dict:
    if not d.get("photo_required"):
        raise DomainError("Фотоконтроль не требуется")
    return {"driver": d["key"], "history": "Фотоконтроль пройден (учебная отметка)"}


def rule_payload(d: dict, body) -> dict:
    if body.rule not in RULES:
        raise DomainError("Нет таких условий работы")
    reason = body.reason.strip()
    text = f"Условия работы: «{body.rule}»" + (f" — {reason}" if reason else "")
    return {"driver": d["key"], "rule": body.rule, "history": text}


def phone_digits(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return "7" + digits[1:] if len(digits) == 11 and digits.startswith("8") else digits


def register_payload(drivers: dict, body, uid: int, request_id: str, now_iso: str) -> dict:
    """A driver registered in CRM joins the park in «Диспетчерская» at once."""
    phone = "+" + phone_digits(body.phone)
    if body.park not in PARK_IDS:
        raise DomainError("Выберите парк")
    if not PHONE.match(phone):
        raise DomainError("Номер телефона: +7 и 10 цифр")
    if not IIN.match(body.iin.strip()):
        raise DomainError("ИИН состоит из 12 цифр")
    if not body.last_name.strip() or not body.first_name.strip():
        raise DomainError("Укажите фамилию и имя")
    drives = body.car is not None
    license_no = body.license.strip().upper()
    if drives and not LICENSE.match(license_no):
        raise DomainError("Номер В/У — 2 латинские буквы и 6 цифр")
    same = next(
        (
            o
            for o in drivers.values()
            if phone_digits(o["phone"]) == phone[1:]
            or (o["iin"] and o["iin"] == body.iin.strip())
            or (drives and o["license"] == license_no)
        ),
        None,
    )
    if same:
        raise DomainError(
            f"Водитель уже есть: {same['last_name']} {same['first_name']}, аккаунт {same['id']}"
        )
    key = md5(f"puls-registered:{uid}:{request_id}".encode()).hexdigest()
    courier = body.profession.startswith("Курьер")
    smz = body.self_employed
    car = None
    if drives:
        plate = body.car.plate.strip().upper()
        if not PLATE.match(plate):
            raise DomainError("Госномер — латинские буквы и цифры, например 803ASD02")
        car = {
            "brand": body.car.brand, "model": body.car.model, "year": body.car.year,
            "color": body.car.color, "plate": plate, "callsign": plate, "vin": "", "body": "",
            "sts": "", "owner": "Водитель", "status": "Работает",
            "tariffs": ["Курьер", "Доставка"] if courier else ["Эконом"], "wrap": False,
            "wrap_checked": False, "lightbox": False, "transmission": "Автоматическая",
            "fuel": "Бензин",
        }  # fmt: skip
    account = {
        "key": key, "id": key, "park": body.park, "last_name": body.last_name.strip(),
        "first_name": body.first_name.strip(), "middle_name": body.middle_name.strip(),
        "phone": phone, "license": license_no if drives else "", "license_country": "Казахстан",
        "segment": "new", "works": True, "status": "offline", "gps": True,
        "employment": SELF_EMPLOYED if smz else INDIVIDUAL,
        "profession": "Курьер" if courier else "Водитель такси",
        "rule": COURIER_RULE if courier else DEFAULT_RULE, "provider": "Sapar", "balance": 0.0,
        "account_limit": -50, "rating": None, "car": car, "thermobox": None, "diagnostics": [],
        "acceptance": 0, "refuel": False, "bonus": None, "comment": "", "source": "CRM",
        "device": "—", "app_version": "—", "created_days": 0, "created_at": now_iso,
        "photo_days": [], "iin": body.iin.strip(), "address": body.address.strip() if smz else "",
        "orders": 0, "license_issued_days": 0, "experience_days": 0,
        "license_issued": body.license_issued if drives else "",
        "license_expires": body.license_expires if drives else "",
        "crm_id": 11_050_000 + sum(1 for o in drivers.values() if o["source"] == "CRM"),
        "driver_no": 1_600_000 + len(drivers), "stats": [0, 0, 0, 0], "cash_limit": False,
    }  # fmt: skip
    text = "Учётная запись создана через CRM"
    return {"account": account, "history": text, "result": {"driver": key}}


def apply(drivers: dict, event, history: dict) -> None:
    """Applies a stored CRM event to the folded drivers and notes it in the driver's history."""
    p = event.payload
    if event.kind == "crm_register":
        # Its first line of history, the creation, comes with every account.
        drivers[p["account"]["key"]] = deepcopy(p["account"])
        return
    d = drivers.get(p.get("driver"))
    if d is None:
        return
    if event.kind == "crm_car":
        if p["replaced"]:
            d["photo_required"] = True
        d["car"] = {**(d["car"] or {"wrap_checked": False}), **p["car"]}
        if p["replaced"]:
            d["car"]["wrap_checked"] = False
    elif event.kind == "crm_smz":
        for field in ("last_name", "first_name", "middle_name", "address", "iin", "rule"):
            d[field] = p[field]
        d["account_limit"] = p["account_limit"]
        d["employment"] = SELF_EMPLOYED
    elif event.kind == "crm_individual":
        d["employment"] = INDIVIDUAL
        d["rule"] = COURIER_RULE if d["profession"] == "Курьер" else DEFAULT_RULE
    elif event.kind == "crm_limit":
        d["cash_limit"] = p["enabled"]
    elif event.kind == "crm_code":
        d["codes"] = d.get("codes", 0) + 1
    elif event.kind == "crm_photo":
        d["photo_required"] = False
        d["photo_days"] = [0, *d["photo_days"]]
    elif event.kind == "crm_rule":
        d["rule"] = p["rule"]
    history.setdefault(d["key"], []).append((event.created_at, p["history"]))
