from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Mission, MissionStep
from app.modules.missions.photo_seed import ensure_photo_control_mission
from app.modules.missions.sapar_seed import ensure_learning_worlds_and_sapar

MISSION_CODE = "login_first_time"

LOGIN_MISSION_STEPS = (
    {
        "step_key": "intro",
        "step_order": 0,
        "step_type": "dialog",
        "screen_key": "intro",
        "action_key": "begin",
        "content_json": {
            "title": "Вход в приложение",
            "message": (
                "Привет, {first_name}! Я Пульсар — твой помощник в Pulse. Сейчас мы вместе "
                "поможем водителю войти в приложение. Я буду подсказывать каждый шаг. "
                "Ошибиться здесь не страшно — это учебная миссия."
            ),
            "goal": "Познакомься с заданием и начни безопасную тренировку.",
        },
        "hint_text": "Нажми «Начать обучение», чтобы открыть первый экран телефона.",
    },
    {
        "step_key": "choose_login",
        "step_order": 1,
        "step_type": "choice",
        "screen_key": "login_choice",
        "action_key": "choose_phone_login",
        "content_json": {
            "message": "Выбери вход по номеру телефона — так мы продолжим учебный сценарий.",
            "goal": "Найди и нажми кнопку «Войти по телефону».",
        },
        "hint_text": "Нужная кнопка находится над жёлтой кнопкой входа по профилю.",
    },
    {
        "step_key": "enter_phone",
        "step_order": 2,
        "step_type": "input_phone",
        "screen_key": "phone_input",
        "action_key": "submit_phone",
        "content_json": {
            "message": (
                "Введи любой вымышленный номер Казахстана в формате +7. "
                "Мы не будем отправлять настоящий код."
            ),
            "goal": "Введи вымышленный номер и продолжи.",
        },
        "hint_text": "После +7 должно быть ещё 10 цифр. Настоящий номер использовать не нужно.",
    },
    {
        "step_key": "enter_code",
        "step_order": 3,
        "step_type": "input_code",
        "screen_key": "code_input",
        "action_key": "submit_code",
        "content_json": {
            "message": "Учебный код: {demo_code}. Введи его в поле и нажми «Далее».",
            "goal": "Введи шестизначный учебный код из подсказки Пульсара.",
        },
        "hint_text": "Код показан в сообщении Пульсара над учебным телефоном.",
    },
    {
        "step_key": "inspect_profile",
        "step_order": 4,
        "step_type": "inspect_profile",
        "screen_key": "driver_profile",
        "action_key": "inspect_profile",
        "content_json": {
            "message": "Готово! Водитель вошёл в приложение. Проверь имя, статус, парк и рейтинг.",
            "goal": "Последовательно отметь четыре подсвеченные контрольные точки.",
            "targets": ["name", "status", "park", "rating"],
        },
        "hint_text": "Начни с имени водителя, затем проверь статус, парк iTaxi и рейтинг 5.00.",
    },
    {
        "step_key": "completion",
        "step_order": 5,
        "step_type": "completion",
        "screen_key": "completion",
        "action_key": "complete",
        "content_json": {
            "message": "Первая миссия выполнена! Ты помог водителю войти в приложение.",
            "goal": "Заверши миссию и вернись к карте.",
        },
        "hint_text": "Нажми «Завершить миссию» — подтверждённый результат уже сохранён.",
    },
)


def ensure_default_missions(db: Session) -> Mission:
    """Idempotently create or refresh the first versioned tutorial mission."""
    mission = db.scalar(select(Mission).where(Mission.code == MISSION_CODE))
    if mission is None:
        mission = Mission(code=MISSION_CODE)
        db.add(mission)

    mission.title = "Вход в приложение"
    mission.description = "Научись безопасно проводить водителя через вход и проверку профиля."
    mission.mission_type = "tutorial"
    mission.sort_order = 1
    mission.reward_coins = 100
    mission.estimated_minutes = 5
    mission.is_active = True
    mission.version = 1
    mission.prerequisites_json = {}
    db.flush()

    existing = {
        step.step_key: step
        for step in db.scalars(
            select(MissionStep).where(
                MissionStep.mission_id == mission.id,
                MissionStep.mission_version == mission.version,
            )
        ).all()
    }
    expected_keys: set[str] = set()
    for payload in LOGIN_MISSION_STEPS:
        expected_keys.add(payload["step_key"])
        step = existing.get(payload["step_key"])
        if step is None:
            step = MissionStep(
                mission_id=mission.id,
                mission_version=mission.version,
                step_key=payload["step_key"],
            )
            db.add(step)
        for key, value in payload.items():
            setattr(step, key, value)
        step.is_required = True

    for step_key, step in existing.items():
        if step_key not in expected_keys:
            db.delete(step)

    db.flush()
    ensure_photo_control_mission(db)
    ensure_learning_worlds_and_sapar(db)
    return mission
