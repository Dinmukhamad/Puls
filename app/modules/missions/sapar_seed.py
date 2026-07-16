from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.models.entities import LearningWorld, Mission, MissionSetting, MissionStep

SAPAR_MISSION_CODE = "smz_sapar_provider_transfer"
WINDOW_SETTING_KEY = "provider_transfer_window"

WORLD_SEEDS = (
    ("yandex_pro", "Яндекс Про", "Вход, профиль, заказы и фотоконтроль приложения водителя.", "phone-route", "mobile_city", "#24C7E8", 1, "available"),
    ("taxi_pro", "Такси Про", "Баланс, выплаты, документы и сервисы таксопарка.", "car-wallet", "finance_quarter", "#7C3AED", 2, "coming_soon"),
    ("crm_requests", "CRM и запросы", "Типы обращений, обязательные поля, вложения и отправка.", "request-form", "operations_center", "#F5A524", 3, "coming_soon"),
    ("self_employment_docs", "Самозанятость и документы", "СМЗ, ЭДО, провайдеры, налоги и юридические процессы.", "document-sign", "document_quarter", "#18A66A", 4, "available"),
)


def _step(key: str, order: int, screen: str, action: str, message: str, goal: str, **content):
    return {
        "step_key": key,
        "step_order": order,
        "step_type": screen,
        "screen_key": screen,
        "action_key": action,
        "content_json": {"message": message, "goal": goal, **content},
        "hint_text": content.pop("hint", "Следуй подсвеченному действию на учебном телефоне."),
        "is_required": True,
    }


SAPAR_STEPS = (
    _step("intro", 0, "sapar_intro", "begin", "Сегодня разберём перевод самозанятого водителя на провайдера SAPAR. Сначала убедимся, что процесс подходит водителю и доступен по срокам.", "Начни безопасный учебный сценарий."),
    _step("driver_status", 1, "driver_status", "answer_driver_status", "Перед навигацией проверь статус водителя: путь SAPAR применяется только для самозанятых.", "Определи, является ли водитель самозанятым."),
    _step("date_eligibility", 2, "date_eligibility", "answer_date_rule", "Сменить провайдера можно с 16-го числа включительно по 1-е число следующего месяца включительно. Период может обновляться руководителем.", "Определи, разрешена ли смена в показанную дату."),
    _step("profile", 3, "sapar_profile", "open_legal_docs", "Открой профиль водителя и найди раздел «Юридическая документация».", "Открой юридическую документацию."),
    _step("legal_docs", 4, "legal_docs", "open_edo", "Теперь открой «Электронный документооборот».", "Перейди в раздел ЭДО."),
    _step("edo_home", 5, "edo_home", "open_provider_list", "Текущий провайдер показан сверху. Открой список доступных провайдеров.", "Перейди к выбору провайдера."),
    _step("provider_list", 6, "provider_list", "select_provider", "Выбери SAPAR. Другие варианты показаны для осмысленного выбора.", "Выбери провайдера SAPAR.", providers=["cnt", "payda", "sapar", "partners_pay", "vezunchik", "paper"]),
    _step("sapar_details", 7, "sapar_details", "view_terms", "Перед сменой провайдера водитель должен ознакомиться с условиями передачи данных.", "Прочитай условия SAPAR и продолжи."),
    _step("consent", 8, "sapar_consent", "confirm_consent", "Подтверди учебное согласие. Оно не создаёт реального согласия и никуда не отправляется.", "Подтверди ознакомление с учебными условиями.", legal_text="Учебное согласие на передачу демонстрационных данных провайдеру SAPAR для последующего заключения договора ЭДО. Не является юридическим документом и не передаётся во внешние системы."),
    _step("processing", 9, "sapar_processing", "finish_processing", "Имитируем обработку без внешнего запроса.", "Дождись завершения учебной обработки."),
    _step("success", 10, "sapar_success", "confirm_outcomes", "Провайдер изменён. Документы через нового провайдера можно будет подписывать со следующего месяца; тариф и договор оформляются на стороне провайдера.", "Отметь два последствия успешной смены."),
    _step("result", 11, "sapar_result", "complete", "Сценарий завершён. Итоговый балл рассчитан сервером.", "Заверши миссию и сохрани результат."),
)


def ensure_learning_worlds_and_sapar(db: Session) -> Mission:
    worlds: dict[str, LearningWorld] = {}
    for code, title, description, icon, illustration, accent, order, availability in WORLD_SEEDS:
        world = db.scalar(select(LearningWorld).where(LearningWorld.code == code))
        if world is None:
            world = LearningWorld(code=code)
            db.add(world)
        world.title = title
        world.description = description
        world.icon = icon
        world.illustration_key = illustration
        world.accent_color = accent
        world.sort_order = order
        world.is_active = True
        world.availability = availability
        worlds[code] = world
    db.flush()

    for code, order in (("login_first_time", 1), ("photo_control_basics", 2)):
        mission = db.scalar(select(Mission).where(Mission.code == code))
        if mission:
            mission.world_id = worlds["yandex_pro"].id
            mission.world_sort_order = order

    mission = db.scalar(select(Mission).where(Mission.code == SAPAR_MISSION_CODE))
    if mission is None:
        mission = Mission(code=SAPAR_MISSION_CODE)
        db.add(mission)
    mission.title = "Перевод на провайдера SAPAR"
    mission.description = "Научись проверять статус СМЗ, разрешённый период и безопасно проводить смену ЭДО-провайдера."
    mission.mission_type = "assessment_tutorial"
    mission.sort_order = 3
    mission.world_id = worlds["self_employment_docs"].id
    mission.world_sort_order = 1
    mission.reward_coins = 100
    mission.estimated_minutes = 7
    mission.is_active = True
    mission.version = 1
    mission.prerequisites_json = {"passing_score": 80}
    db.flush()

    existing = {row.step_key: row for row in db.scalars(select(MissionStep).where(MissionStep.mission_id == mission.id, MissionStep.mission_version == mission.version)).all()}
    expected = set()
    for payload in SAPAR_STEPS:
        expected.add(payload["step_key"])
        row = existing.get(payload["step_key"])
        if row is None:
            row = MissionStep(mission_id=mission.id, mission_version=mission.version, step_key=payload["step_key"])
            db.add(row)
        for key, value in payload.items():
            setattr(row, key, value)
    for key, row in existing.items():
        if key not in expected:
            db.delete(row)

    setting = db.scalar(select(MissionSetting).where(MissionSetting.mission_id == mission.id, MissionSetting.key == WINDOW_SETTING_KEY, MissionSetting.version == 1))
    if setting is None:
        setting = MissionSetting(
            mission_id=mission.id,
            key=WINDOW_SETTING_KEY,
            version=1,
            value_json={
                "start_day": 16,
                "end_day": 1,
                "timezone": "Asia/Almaty",
                "is_active": True,
                "operator_message": "Сменить провайдера можно с 16-го числа включительно по 1-е число следующего месяца включительно.",
            },
            effective_from=now_utc(),
            is_active=True,
        )
        db.add(setting)
    db.flush()
    return mission
