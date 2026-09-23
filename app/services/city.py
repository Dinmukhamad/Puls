"""Real CRM/driver evidence drives missions; the client never supplies completion."""

from copy import deepcopy

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.models.city import CityAward, CitySettings
from app.models.crm import CrmAppeal
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_shift import DriverShift
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount
from app.services.coins import post_transaction
from app.services.crm_catalog import default_categories
from app.services.learning import lock_learner
from app.services.rules import write_audit

DISTRICTS = [
    {"id": "academy", "name": "Академия", "subtitle": "Начало твоего пути", "soon": False},
    {"id": "driver", "name": "Driver Simulator", "subtitle": "Путь водителя", "soon": False},
    {"id": "crm", "name": "CRM-центр", "subtitle": "На стороне водителя", "soon": False},
    {"id": "dispatch", "name": "Диспетчерская", "subtitle": "Следующая глава", "soon": True},
    {"id": "opteo", "name": "Opteo", "subtitle": "Будущий район", "soon": True},
]
# Conditions and destinations are server-owned. Editors can tune the curriculum,
# but cannot inject arbitrary URLs or client-side completion rules.
TEMPLATES = {
    "welcome": ("academy", "welcome", "/training/city", "Знакомство с городом"),
    "driver_profile": ("driver", "profile", "/simulator", "Учебный профиль водителя готов"),
    "driver_first": ("driver", "orders", "/simulator", "Завершённые учебные заказы"),
    "driver_five": ("driver", "orders", "/simulator", "Завершённые учебные заказы"),
    "crm_first": ("crm", "appeals", "/training/work-sites?view=create", "Сохранённые обращения"),
    "crm_phone": ("crm", "phone", "/training/work-sites?view=create", "Обращения «Смена номера»"),
    "crm_closed": ("crm", "closed", "/training/work-sites", "Тикеты, закрытые сотрудником"),
}


def default_missions():
    rows = [
        (
            "welcome",
            "Твой город начинается здесь",
            "Познакомься с картой. Каждый район — рабочий инструмент, каждое задание — "
            "новый навык.",
            "Начни путь, затем выбери автопарк или CRM. Я буду рядом на каждом шаге.",
            1,
            25,
            0,
            None,
        ),
        (
            "driver_profile",
            "Готов к первой смене",
            "Открой Driver Simulator, выбери сервис и таксопарк и заверши вход в учебный профиль.",
            "Это учебный профиль. Выбери условия сотрудничества и пройди вход в симулятор.",
            1,
            75,
            20,
            "welcome",
        ),
        (
            "driver_first",
            "Первая поездка",
            "Прими заказ, доберись до пассажира и заверши учебную поездку до расчёта.",
            "Заказ засчитывается после завершения. Отмена и предварительный просмотр не считаются.",
            1,
            120,
            40,
            "driver_profile",
        ),
        (
            "driver_five",
            "Уверенно на линии",
            "Заверши пять учебных заказов. Первая поездка уже входит в этот маршрут.",
            "Следи за этапами поездки. На карте всегда видно, сколько заказов осталось.",
            5,
            250,
            120,
            "driver_first",
        ),
        (
            "crm_first",
            "Первое обращение",
            "Получив QR-допуск, заполни и сохрани своё первое обращение в учебной CRM.",
            "Выбери все уровни категории и заполни обязательные поля. Сохранённое "
            "обращение останется в общей истории.",
            1,
            100,
            30,
            "welcome",
        ),
        (
            "crm_phone",
            "На связи. На твоей стороне",
            "Создай обращение категории «Смена номера»: укажи старый и новый номера и "
            "приложи необходимый скриншот.",
            "Открой инструкцию «Смена номера» в CRM. Обращение засчитается после "
            "проверки обязательных полей и сохранения.",
            1,
            180,
            80,
            "crm_first",
        ),
        (
            "crm_closed",
            "Довести дело до конца",
            "Создай учебный тикет. После проверки тренер, руководитель или "
            "администратор должен закрыть его в CRM.",
            "Сохранить тикет — первый шаг. Эта миссия завершится, когда сотрудник "
            "переведёт его в статус «Закрыт».",
            1,
            200,
            100,
            "crm_phone",
        ),
    ]
    return {
        key: {
            "title": title,
            "description": description,
            "pulsar": pulsar,
            "target": target,
            "xp": xp,
            "coins": coins,
            "prerequisite": parent,
            "enabled": True,
        }
        for key, title, description, pulsar, target, xp, coins, parent in rows
    }


async def settings(session):
    row = await session.get(CitySettings, 1)
    return {
        "revision": row.revision if row else 0,
        "missions": deepcopy(row.missions if row else default_missions()),
    }


async def evidence(session, user_ids):
    result = {
        uid: {"welcome": 1, "profile": 0, "orders": 0, "appeals": 0, "phone": 0, "closed": 0}
        for uid in user_ids
    }
    if not result:
        return result
    profiles = await session.execute(
        select(DriverProfile.user_id, DriverProfile.stage).where(
            DriverProfile.user_id.in_(user_ids)
        )
    )
    for uid, stage in profiles:
        result[uid]["profile"] = int(stage == "offline")
    orders = await session.execute(
        select(DriverOrder.user_id, func.count())
        .outerjoin(DriverShift, DriverShift.id == DriverOrder.shift_id)
        .where(
            DriverOrder.user_id.in_(user_ids),
            DriverOrder.stage == "complete",
            DriverOrder.finished_at.is_not(None),
            or_(DriverOrder.shift_id.is_(None), DriverShift.is_preview.is_(False)),
        )
        .group_by(DriverOrder.user_id)
    )
    for uid, count in orders:
        result[uid]["orders"] = count
        result[uid]["profile"] = 1
    phone_ids = {n["id"] for n in default_categories() if "phone_change" in n["rules"]}
    appeals = await session.execute(
        select(
            CrmAppeal.author_id, CrmAppeal.category_ids, CrmAppeal.is_ticket, CrmAppeal.status
        ).where(CrmAppeal.author_id.in_(user_ids))
    )
    for uid, categories, ticket, status in appeals:
        result[uid]["appeals"] += 1
        result[uid]["phone"] += int(bool(phone_ids.intersection(categories)))
        result[uid]["closed"] += int(ticket and status == "closed")
    return result


def mission_rows(config, facts, awards):
    rows = []
    for key, (district, condition, path, objective) in TEMPLATES.items():
        definition = config["missions"][key]
        award = awards.get(key)
        shown = award.snapshot if award else definition
        parent = definition["prerequisite"]
        locked = bool(parent and config["missions"][parent]["enabled"] and parent not in awards)
        count = shown["target"] if award else min(facts[condition], shown["target"])
        state = (
            "completed"
            if award
            else "unavailable"
            if not definition["enabled"]
            else "locked"
            if locked
            else "ready"
            if count >= shown["target"]
            else "in_progress"
            if count
            else "available"
        )
        rows.append(
            dict(
                key=key,
                district=district,
                objective=objective,
                path=path,
                **shown,
                current=count,
                state=state,
                claimed_at=award.claimed_at if award else None,
            )
        )
    return rows


async def dashboard(session, user, *, inspecting=False):
    config = await settings(session)
    operator = user.role == Role.OPERATOR
    facts = (
        (await evidence(session, [user.id]))[user.id]
        if operator
        else {"welcome": 1, "profile": 0, "orders": 0, "appeals": 0, "phone": 0, "closed": 0}
    )
    awards = (
        {
            a.mission_key: a
            for a in await session.scalars(select(CityAward).where(CityAward.user_id == user.id))
        }
        if operator
        else {}
    )
    rows = mission_rows(config, facts, awards)
    xp = sum(a.xp for a in awards.values())
    balance = (
        await session.scalar(select(CoinAccount.balance).where(CoinAccount.user_id == user.id))
        if operator
        else None
    )
    return {
        "revision": config["revision"],
        "user_id": user.id,
        "full_name": user.full_name,
        "preview": not operator,
        "inspecting": inspecting,
        "can_claim": operator and not inspecting,
        "districts": DISTRICTS,
        "missions": rows,
        "xp": xp,
        "level": xp // 300 + 1,
        "level_progress": xp % 300,
        "level_target": 300,
        "balance": balance or 0,
    }


async def claim(session, user, key, revision):
    if user.role != Role.OPERATOR:
        raise PermissionDeniedError("В предварительном просмотре награды не начисляются")
    if key not in TEMPLATES:
        raise NotFoundError("Миссия не найдена")
    await lock_learner(session, user.id)
    existing = await session.get(CityAward, (user.id, key), populate_existing=True)
    if existing:
        return {
            "already_claimed": True,
            "title": existing.snapshot["title"],
            "xp": existing.xp,
            "coins": existing.coins,
        }
    config = await settings(session)
    if revision != config["revision"]:
        raise ConflictError("Тренер обновил миссии. Обновите город перед получением награды.")
    facts = (await evidence(session, [user.id]))[user.id]
    awards = {
        a.mission_key: a
        for a in await session.scalars(select(CityAward).where(CityAward.user_id == user.id))
    }
    mission = next(m for m in mission_rows(config, facts, awards) if m["key"] == key)
    if mission["state"] != "ready":
        raise ConflictError("Сначала выполните условия миссии и предыдущие задания маршрута.")
    definition = deepcopy(config["missions"][key])
    session.add(
        CityAward(
            user_id=user.id,
            mission_key=key,
            snapshot=definition,
            xp=definition["xp"],
            coins=definition["coins"],
        )
    )
    if definition["coins"]:
        await post_transaction(
            session,
            user_id=user.id,
            amount=definition["coins"],
            tx_type=TxType.LEARNING_REWARD,
            reason=f"Мой город: {definition['title']}",
            idempotency_key=f"city:{user.id}:{key}",
            meta={"mission": key},
        )
    session.add(
        Notification(
            user_id=user.id,
            title="Новый шаг в твоём городе",
            body=definition["title"],
            kind="learning",
            link="/training/city",
        )
    )
    await write_audit(
        session,
        actor_id=user.id,
        action="city.claim",
        entity_type="city_mission",
        entity_id=key,
        payload={"xp": definition["xp"], "coins": definition["coins"]},
    )
    await session.commit()
    return {
        "already_claimed": False,
        "title": definition["title"],
        "xp": definition["xp"],
        "coins": definition["coins"],
    }


async def save_settings(session, actor, body):
    values = {key: value.model_dump() for key, value in body.missions.items()}
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CitySettings(id=1, revision=revision, missions=values, updated_by_id=actor.id))
    else:
        result = await session.execute(
            update(CitySettings)
            .where(CitySettings.id == 1, CitySettings.revision == body.revision)
            .values(revision=revision, missions=values, updated_by_id=actor.id)
        )
        if result.rowcount != 1:
            raise ConflictError(
                "Миссии уже изменили. Обновите страницу и повторите редактирование."
            )
    try:
        await write_audit(
            session,
            actor_id=actor.id,
            action="city.configure",
            entity_type="city_settings",
            entity_id="1",
            payload={"revision": revision, "missions": values},
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Миссии уже изменили. Обновите страницу.") from None
    return {"revision": revision, "missions": values}
