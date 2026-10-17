"""Real CRM/driver evidence drives missions; the client never supplies completion."""

from copy import deepcopy

from sqlalchemy import case, func, literal, or_, select, union_all, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.models.city import CityAward, CityBuild, CitySettings
from app.models.crm_training import CrmTrainingAttempt
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_shift import DriverShift
from app.models.enums import LEARNER_ROLES, Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount, Group
from app.services.coins import post_transaction
from app.services.dispatch import mission_facts, solved_calls
from app.services.dispatch_data import MISSION_CALLS
from app.services.learning import lock_learner
from app.services.rules import write_audit

DISTRICTS = [
    {"id": "academy", "name": "Академия", "subtitle": "Начало твоего пути", "soon": False},
    {"id": "driver", "name": "Driver Simulator", "subtitle": "Путь водителя", "soon": False},
    {"id": "crm", "name": "CRM-центр", "subtitle": "На стороне водителя", "soon": False},
    {"id": "dispatch", "name": "Диспетчерская", "subtitle": "Кабинет таксопарка", "soon": False},
    {"id": "scenarios", "name": "Сценарии ТП", "subtitle": "Диалог и практика", "soon": False},
    {"id": "oktell", "name": "Oktell", "subtitle": "Телефония и сообщения", "soon": False},
]
# Conditions and destinations are server-owned. Editors can tune the curriculum,
# but cannot inject arbitrary URLs or client-side completion rules.
DISPATCH = "/training/work-sites?site=dispatch"
CRM_TASK_KEYS = ("crm_first", "crm_phone", "crm_closed")
# Keep legacy award keys identifiable while the Oktell curriculum is deferred. They are
# excluded from all effective settings, prerequisites and claims; persisted awards stay intact.
DEFERRED_OKTELL_MISSIONS = frozenset(
    ("oktell_ready", "oktell_call", "oktell_message", "oktell_shift")
)
TEMPLATES = {
    "welcome": ("academy", "welcome", "/training/city", "Знакомство с городом"),
    "driver_profile": ("driver", "profile", "/simulator", "Учебный профиль водителя готов"),
    "driver_first": ("driver", "orders", "/simulator", "Завершённые учебные заказы"),
    "driver_five": ("driver", "orders", "/simulator", "Завершённые учебные заказы"),
    "crm_first": (
        "crm",
        "appeals",
        "/training/work-sites?task=crm_first",
        "Знакомство с CRM пройдено",
    ),
    "crm_phone": ("crm", "phone", "/training/work-sites?task=crm_phone", "Смена номера проверена"),
    "crm_closed": (
        "crm",
        "closed",
        "/training/work-sites?task=crm_closed",
        "Запрос в таксопарк проверен",
    ),
    # Dispatch missions count the mascot's calls the operator solved (app/services/dispatch.py).
    "dispatch_driver": ("dispatch", "dispatch_driver", DISPATCH, "Решённые звонки водителей"),
    "dispatch_car": ("dispatch", "dispatch_car", DISPATCH, "Тарифы и оклейка сохранены"),
    "dispatch_inventory": ("dispatch", "dispatch_inventory", DISPATCH, "Выданный термокороб"),
    "dispatch_support": ("dispatch", "dispatch_support", DISPATCH, "Обращение в поддержку Яндекса"),
    "dispatch_limit": ("dispatch", "dispatch_limit", DISPATCH, "Разобранные лимиты на вывод"),
    "scenario_business_park": (
        "scenarios",
        "scenario_business_park",
        "/training/scenarios/business_park",
        "Консультация по тарифу «Бизнес» через парк завершена",
    ),
}
# A mission cannot ask for more server-owned cases than its engine has.
TARGET_LIMITS = {
    **{key: len(MISSION_CALLS[key]) for key in MISSION_CALLS},
    "scenario_business_park": 1,
}

# Plots of the operator's own district: four on the green belt behind every open district island.
# A district's plots open once its first mission reward is claimed (the Academy's with the welcome).
PLOT_DISTRICTS = ("academy", "driver", "crm", "dispatch")
PLOTS = [{"key": f"{d}-{i}", "district": d} for d in PLOT_DISTRICTS for i in range(4)]
# Server-owned prices: the client sends only the plot and the building, never the amount.
BUILDINGS = {
    key: {"key": key, "name": name, "description": text, "icon": icon, "price": price}
    for key, name, text, icon, price in [
        ("garden", "Сквер", "Газон, деревья и лавочки для прогулок.", "🌳", 40),
        ("gazebo", "Беседка в саду", "Беседка среди кустов и клумб.", "🌷", 50),
        ("playground", "Детская площадка", "Горка, качели и песочница.", "🎠", 60),
        ("sports", "Спортплощадка", "Баскетбольный корт с двумя кольцами.", "🏀", 70),
        ("fountain", "Площадь с фонтаном", "Мощёная площадь, фонтан и скамейки.", "⛲", 90),
        ("cottage", "Коттедж", "Дом с садом и дорожкой к улице.", "🏡", 120),
        ("house", "Жилой дом", "Четырёхэтажный дом с цветниками.", "🏠", 200),
        ("tower", "Стеклянная башня", "Бизнес-башня — гордость района.", "🏙️", 350),
    ]
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
            "Знакомство с CRM",
            "Познакомься с обращениями и открой связанный тикет по его номеру.",
            "Открой учебное обращение. В его карточке нажми на номер тикета.",
            1,
            100,
            30,
            "welcome",
        ),
        (
            "crm_phone",
            "На связи. На твоей стороне",
            "Сверь номера в диспетчерской и OKTEL, сделай один снимок двух окон "
            "и оформи обращение на смену номера.",
            "В поле телефона — текущий номер; в комментарии — новый номер и ссылка на аккаунт.",
            1,
            180,
            80,
            "crm_first",
        ),
        (
            "crm_closed",
            "Доработка после ООЗ",
            "Открой тикет по номеру и дополни обращение на снятие лимита по замечанию ООЗ.",
            "Модерация → Вернуть на доработку → Добавить комментарий → Отправить.",
            1,
            200,
            100,
            "crm_phone",
        ),
        (
            "dispatch_driver",
            "Первые звонки в Диспетчерскую",
            "Реши два звонка водителей: найди активный аккаунт и поставь провайдера Sapar, "
            "затем узнай в «Диагностике», что мешает выйти на линию.",
            "Открой вкладку «Диспетчерская» в рабочих сайтах. Звонки ждут в моей панели, "
            "а кнопка «Покажи, как» проведёт по экрану.",
            2,
            120,
            40,
            "welcome",
        ),
        (
            "dispatch_car",
            "Тарифы и оклейка",
            "Подключи водителю тариф «Комфорт» и включи оклейку во вкладке «Автомобиль». "
            "Без «Сохранить» изменения не применятся.",
            "Крестик рядом с «Оклейкой» значит, что фотоконтроль брендинга ещё не пройден.",
            1,
            120,
            40,
            "dispatch_driver",
        ),
        (
            "dispatch_inventory",
            "Выдать термокороб",
            "Выбери парк курьера, выдай жёлтый термокороб Яндекс Еды по коду из Яндекс Про "
            "и впиши номер с короба.",
            "Код курьера живёт две минуты — его продиктую я. Не успел — попроси новый.",
            1,
            150,
            60,
            "dispatch_car",
        ),
        (
            "dispatch_support",
            "Письмо в поддержку",
            "Создай обращение в техподдержку Яндекса: «Вопросы об исполнителе» → «Ограничение "
            "доступа к сервису», номер ВУ и текст «ДД! Прошу проверить…».",
            "«Доступ: мне и моей роли» оставь выключенным, чтобы обращение видели коллеги.",
            1,
            180,
            80,
            "dispatch_inventory",
        ),
        (
            "dispatch_limit",
            "Лимит на вывод",
            "Разбери три звонка про серую сумму на балансе: найди правило в «Антифроде», "
            "проверь тариф заказа и дай водителю верный ответ.",
            "Закрывающие документы проверяет только Яндекс. Короткая или дорогая поездка не по "
            "«Межгороду» — запрос в CRM, лимит снимет ООЗ.",
            3,
            250,
            120,
            "dispatch_support",
        ),
        (
            "scenario_business_park",
            "Подключение тарифа Бизнес",
            "Проведи обращение водителя: самостоятельно выбирай реплики и действия "
            "в учебной Диспетчерской и CRM.",
            "Решения и выполненные действия проверяются вместе; "
            "коины начисляются один раз после успешного прохождения.",
            1,
            0,
            100,
            None,
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
    # Missions added after a trainer saved the curriculum start with their defaults.
    missions = {**default_missions(), **(row.missions if row else {})}
    missions = deepcopy({key: missions[key] for key in TEMPLATES})
    # Each fixed CRM exercise has one accepted proof. Old count-based goals must
    # not make the new three-step curriculum impossible; award snapshots stay as-is.
    for key in CRM_TASK_KEYS:
        missions[key]["target"] = 1
    # Older saved curricula carry the shipped wording. Refresh those exact
    # defaults only; trainer-authored instructions and historical awards stay intact.
    legacy = {
        "crm_first": {
            "description": "Получив QR-допуск, заполни и сохрани своё первое обращение "
            "в учебной CRM.",
            "pulsar": "Выбери все уровни категории и заполни обязательные поля. "
            "Сохранённое обращение останется в общей истории.",
        },
        "crm_phone": {
            "description": "Создай обращение категории «Смена номера»: укажи старый и новый "
            "номера и приложи необходимый скриншот.",
            "pulsar": "Открой инструкцию «Смена номера» в CRM. Обращение засчитается после "
            "проверки обязательных полей и сохранения.",
        },
        "crm_closed": {
            "description": "Создай учебный тикет. После проверки тренер, руководитель или "
            "администратор должен закрыть его в CRM.",
            "pulsar": "Сохранить тикет — первый шаг. Эта миссия завершится, когда сотрудник "
            "переведёт его в статус «Закрыт».",
        },
    }
    defaults = default_missions()
    previous_program = {
        "crm_first": {
            "title": "Первое обращение",
            "description": "Начни первое задание CRM и самостоятельно сохрани "
            "консультацию по тарифам. Система проверит сохранённое обращение "
            "по данным учебного водителя.",
            "pulsar": "Галочки в памятке не подтверждают выполнение. Заполни обращение сам: "
            "проверка покажет ошибки, а сохранённую работу можно исправить.",
        },
        "crm_phone": {
            "description": "Пройди задание «Смена номера»: укажи данные водителя, старый и новый "
            "номера, ссылку на аккаунт и приложи скриншот.",
            "pulsar": "Система проверит настоящую сохранённую запись и вложение. Исправления "
            "сохраняются в том же учебном обращении.",
        },
        "crm_closed": {
            "title": "Довести дело до конца",
            "description": "Создай запрос в таксопарк на снятие лимита и пройди серверную проверку "
            "данных, категории и комментария.",
            "pulsar": "Учебное задание завершится после проверки сохранённого тикета. "
            "Закрытие сотрудником не требуется; рабочий статус тикета не меняется.",
        },
    }
    for key, fields in previous_program.items():
        for field, text in fields.items():
            if missions[key][field] == text:
                missions[key][field] = defaults[key][field]
    for key, fields in legacy.items():
        for field, text in fields.items():
            if missions[key][field] == text:
                missions[key][field] = defaults[key][field]
    # A previous editor could make an unrelated mission depend on an Oktell exercise.
    # Removing the deferred prerequisite keeps the surviving route usable without touching
    # the saved curriculum or any historic reward snapshot.
    for mission in missions.values():
        if mission["prerequisite"] in DEFERRED_OKTELL_MISSIONS:
            mission["prerequisite"] = None
    return {
        "revision": row.revision if row else 0,
        "missions": missions,
    }


def empty_facts():
    return {
        "welcome": 1,
        "profile": 0,
        "orders": 0,
        "appeals": 0,
        "phone": 0,
        "closed": 0,
        "scenario_business_park": 0,
        **mission_facts(set()),
    }


async def evidence(session, user_ids):
    result = {uid: empty_facts() for uid in user_ids}
    if not result:
        return result
    for uid, calls in (await solved_calls(session, user_ids)).items():
        result[uid].update(mission_facts(calls))
    from app.models.scenario import ScenarioAttempt

    # Independent profile and scenario aggregates share one round trip; a scenario never
    # requires a DriverProfile row. UNION ALL keeps the two sources from multiplying counts.
    passed_scenarios = (
        select(ScenarioAttempt.user_id, literal(None), func.count())
        .where(
            ScenarioAttempt.user_id.in_(user_ids),
            ScenarioAttempt.scenario_key == "business_park",
            ScenarioAttempt.state == "passed",
            ScenarioAttempt.is_preview.is_(False),
        )
        .group_by(ScenarioAttempt.user_id)
    )
    profiles = await session.execute(
        union_all(
            select(DriverProfile.user_id, DriverProfile.stage, literal(0)).where(
                DriverProfile.user_id.in_(user_ids)
            ),
            passed_scenarios,
        )
    )
    for uid, stage, scenario_count in profiles:
        if stage is None:
            result[uid]["scenario_business_park"] = scenario_count
        else:
            result[uid]["profile"] = int(stage == "offline")
            result[uid]["profile_started"] = int(stage != "services")
    orders = await session.execute(
        select(
            DriverOrder.user_id,
            func.sum(
                case(
                    ((DriverOrder.stage == "complete") & DriverOrder.finished_at.is_not(None), 1),
                    else_=0,
                )
            ),
            func.sum(case((DriverOrder.stage.not_in(["complete", "cancelled"]), 1), else_=0)),
        )
        .outerjoin(DriverShift, DriverShift.id == DriverOrder.shift_id)
        .where(
            DriverOrder.user_id.in_(user_ids),
            or_(DriverOrder.shift_id.is_(None), DriverShift.is_preview.is_(False)),
        )
        .group_by(DriverOrder.user_id)
    )
    for uid, count, active in orders:
        result[uid]["orders"] = count
        result[uid]["active_orders"] = active
        if count or active:
            result[uid]["profile"] = 1
    # Ordinary saves remain in shared history but are not proof of a particular
    # training task. Historical CityAward rows remain authoritative in mission_rows.
    attempts = await session.scalars(
        select(CrmTrainingAttempt).where(CrmTrainingAttempt.user_id.in_(user_ids))
    )
    conditions = {
        "crm_first": "appeals",
        "crm_phone": "phone",
        "crm_closed": "closed",
        "crm_intro_v2": "appeals",
        "crm_phone_v2": "phone",
        "crm_rework_v2": "closed",
    }
    for attempt in attempts:
        condition = conditions.get(attempt.task_key)
        if condition and attempt.phase == "passed":
            result[attempt.user_id][condition] = 1
        if attempt.task_key in ("crm_closed", "crm_rework_v2"):
            result[attempt.user_id]["tickets"] = 1
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
        activity_key = {
            "orders": "active_orders",
            "profile": "profile_started",
            "closed": "tickets",
        }.get(condition, "")
        started = count or facts.get(activity_key, 0)
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
            if started
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
    # Daily situations and districts build on this module: imported here.
    from app.services.city_economy import economy
    from app.services.city_estate import construction_open, district_index
    from app.services.city_quests import quests
    from app.services.city_world import settings as department_settings
    from app.services.scenarios import support_group_ids

    config = await settings(session)
    operator = user.role in LEARNER_ROLES
    trainee = user.role == Role.TRAINEE
    # The operator's active group decides whether the scenarios show (app/services/scenarios.py).
    group = (
        await session.get(Group, user.group_id) if operator and user.group_id is not None else None
    )
    # Resolve department ownership once for both scenario visibility and construction.
    department_config = await department_settings(session) if operator else None
    facts = (await evidence(session, [user.id]))[user.id] if operator else empty_facts()
    awards = (
        {
            a.mission_key: a
            for a in await session.scalars(select(CityAward).where(CityAward.user_id == user.id))
        }
        if operator
        else {}
    )
    rows = mission_rows(config, facts, awards)
    # A staff preview includes the curriculum. An inspected operator keeps their own
    # assignment boundary, so sales and unassigned operators never see a TP scenario.
    scenarios_visible = (
        trainee
        or not operator
        or bool(
            user.is_active
            and group
            and group.is_active
            and user.group_id in await support_group_ids(session, config=department_config)
        )
    )
    if not scenarios_visible:
        rows = [row for row in rows if row["district"] != "scenarios"]
    xp = sum(a.xp for a in awards.values())
    account = (
        await session.scalar(select(CoinAccount).where(CoinAccount.user_id == user.id))
        if operator
        else None
    )
    balance = account.balance if account else 0
    builds = (
        {
            b.plot_key: b
            for b in await session.scalars(select(CityBuild).where(CityBuild.user_id == user.id))
        }
        if operator
        else {}
    )
    values = await economy(session)
    prices = values["prices"]
    # Once the team district opens for building, new buildings go there; the old plots keep theirs.
    moved = operator and await construction_open(
        session,
        user,
        districts=district_index(department_config),
    )
    return {
        "revision": config["revision"],
        "user_id": user.id,
        "full_name": user.full_name,
        "gender": user.gender,
        "guide_name": user.guide_name,
        "preview": not operator,
        "inspecting": inspecting,
        "can_claim": operator and not inspecting,
        # Stages already seen grow, on any device: the city celebrates only the rest, once.
        "levels_seen": user.city_levels_seen if operator and not inspecting else None,
        "districts": [
            {
                **district,
                # Deferred teaching is absent from the curriculum, but its earned building
                # stages remain visible. Only persisted awards count, never workspace events.
                **(
                    {"completed_missions": len(DEFERRED_OKTELL_MISSIONS.intersection(awards))}
                    if district["id"] == "oktell"
                    else {}
                ),
            }
            for district in DISTRICTS
            if scenarios_visible or district["id"] != "scenarios"
        ],
        "missions": [{**m, "coins": 0, "xp": 0} for m in rows] if trainee else rows,
        "xp": xp,
        "level": xp // 300 + 1,
        "level_progress": xp % 300,
        "level_target": 300,
        "balance": 0 if trainee else balance,
        # Coins reserved for shop requests cannot pay for a building.
        "available": account.available if account and not trainee else 0,
        "plots": [] if trainee else plot_rows(rows, builds),
        "buildings": []
        if trainee
        else [{**item, "price": prices[key]} for key, item in BUILDINGS.items()],
        "can_build": user.role == Role.OPERATOR and not inspecting and not moved,
        "plots_moved": moved,
        "quests": None if trainee else await quests(session, user, inspecting=inspecting),
    }


def plot_rows(missions, builds):
    open_districts = {m["district"] for m in missions if m["state"] == "completed"}
    return [
        {
            **plot,
            "unlocked": plot["district"] in open_districts or plot["key"] in builds,
            "item": builds[plot["key"]].item_key if plot["key"] in builds else None,
        }
        for plot in PLOTS
    ]


async def build(session, user, plot_key, item_key):
    """Pays for a building on one of the operator's own open plots, once per plot."""
    if user.role != Role.OPERATOR:
        raise PermissionDeniedError("В предварительном просмотре строить нельзя")
    from app.services.city_economy import economy
    from app.services.city_estate import construction_open

    if await construction_open(session, user):
        raise ConflictError(
            "Новые постройки теперь появляются в районе твоей команды. Прежние остаются на месте."
        )

    plot = next((p for p in PLOTS if p["key"] == plot_key), None)
    item = BUILDINGS.get(item_key)
    if not plot or not item:
        raise NotFoundError("Участок или постройка не найдены")
    # The price the head set; the building keeps the price paid.
    item = {**item, "price": (await economy(session))["prices"][item_key]}
    await lock_learner(session, user.id)
    existing = await session.get(CityBuild, (user.id, plot_key), populate_existing=True)
    if existing:
        raise ConflictError("Этот участок уже застроен")
    config = await settings(session)
    facts = (await evidence(session, [user.id]))[user.id]
    awards = {
        a.mission_key: a
        for a in await session.scalars(select(CityAward).where(CityAward.user_id == user.id))
    }
    rows = plot_rows(mission_rows(config, facts, awards), {})
    if not next(p for p in rows if p["key"] == plot_key)["unlocked"]:
        raise ConflictError("Участок откроется после первой миссии района")
    transaction = await post_transaction(
        session,
        user_id=user.id,
        amount=-item["price"],
        tx_type=TxType.CITY_BUILD,
        reason=f"Мой город: {item['name']}",
        idempotency_key=f"city-build:{user.id}:{plot_key}",
        meta={"plot": plot_key, "item": item_key},
    )
    if transaction is None:
        raise ConflictError("Этот участок уже оплачен")
    session.add(
        CityBuild(user_id=user.id, plot_key=plot_key, item_key=item_key, price=item["price"])
    )
    await write_audit(
        session,
        actor_id=user.id,
        action="city.build",
        entity_type="city_plot",
        entity_id=plot_key,
        payload={"item": item_key, "price": item["price"]},
    )
    await session.commit()
    return {
        "plot": plot_key,
        "item": item_key,
        "name": item["name"],
        "price": item["price"],
        "balance": transaction.balance_after,
    }


async def see_levels(session, user, levels):
    """
    Remembers the district building stages the operator's city showed, so a district that levelled
    up is celebrated once per account, not once per browser. Stages only go up: an older tab cannot
    bring back a celebration already seen.
    """
    if user.role != Role.OPERATOR:
        raise PermissionDeniedError("В предварительном просмотре город не запоминает увиденное")
    known = {district["id"] for district in DISTRICTS}
    seen = dict(user.city_levels_seen or {})
    for key, level in levels.items():
        if key in known and level > seen.get(key, 0):
            seen[key] = level
    # Even an empty record is kept: a city without learning districts is not asked again.
    if seen != user.city_levels_seen:
        user.city_levels_seen = seen
        await session.commit()
    return {"levels_seen": seen}


async def claim(session, user, key, revision):
    if user.role not in LEARNER_ROLES:
        raise PermissionDeniedError("В предварительном просмотре награды не начисляются")
    if key not in TEMPLATES:
        raise NotFoundError("Миссия не найдена")
    if key == "scenario_business_park":
        from app.services.scenarios import support_allowed

        if not await support_allowed(session, user):
            raise PermissionDeniedError("Сценарий доступен только операторам города ТП")
    await lock_learner(session, user.id)
    existing = await session.get(CityAward, (user.id, key), populate_existing=True)
    if existing:
        return {
            "already_claimed": True,
            "title": existing.snapshot["title"],
            "xp": existing.xp,
            "coins": existing.coins,
        }
    if key == "scenario_business_park":
        # Only the scenario engine may finish the combined dialogue/CRM/dispatch
        # attempt and create its reward using the amount snapshotted at the start.
        raise ConflictError(
            "Пройдите диалог и практику в сценарии: награда начисляется автоматически."
        )
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
    if user.role == Role.TRAINEE:
        definition.update(xp=0, coins=0)
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
