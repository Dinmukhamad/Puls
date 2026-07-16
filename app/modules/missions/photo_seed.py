from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Mission, MissionStep

MISSION_CODE = "photo_control_basics"

CAR_REQUIREMENTS = [
    {"slot_key": "front", "label": "Машина спереди", "asset_id": "car-front-v1", "asset": "/img/missions/photo-control/car/front.webp", "criterion": "Автомобиль целиком, не обрезаны колёса, крыша и бампер."},
    {"slot_key": "left", "label": "Машина слева", "asset_id": "car-left-v1", "asset": "/img/missions/photo-control/car/left.webp", "criterion": "Виден весь левый бок, камера на уровне середины кузова."},
    {"slot_key": "rear", "label": "Машина сзади", "asset_id": "car-rear-v1", "asset": "/img/missions/photo-control/car/rear.webp", "criterion": "Автомобиль целиком сзади, багажная зона закрыта."},
    {"slot_key": "right", "label": "Машина справа", "asset_id": "car-right-v1", "asset": "/img/missions/photo-control/car/right.webp", "criterion": "Виден весь правый бок без сильного перспективного искажения."},
    {"slot_key": "front_seats", "label": "Передний ряд сидений", "asset_id": "car-front-seats-v1", "asset": "/img/missions/photo-control/car/front-seats.webp", "criterion": "Видны водительское и пассажирское места и передняя панель."},
    {"slot_key": "rear_seats", "label": "Задний ряд сидений", "asset_id": "car-rear-seats-v1", "asset": "/img/missions/photo-control/car/rear-seats.webp", "criterion": "Весь задний ряд виден и хорошо освещён."},
    {"slot_key": "trunk", "label": "Открытый багажник", "asset_id": "car-trunk-v1", "asset": "/img/missions/photo-control/car/trunk-open.webp", "criterion": "Открытое багажное отделение полностью находится в кадре."},
]


def _step(step_key: str, order: int, screen: str, action: str, message: str, goal: str, **extra):
    content = {"message": message, "goal": goal, **extra}
    return {
        "step_key": step_key,
        "step_order": order,
        "step_type": screen,
        "screen_key": screen,
        "action_key": action,
        "content_json": content,
        "hint_text": extra.pop("hint", "Следуй подсвеченному действию на учебном телефоне."),
    }


PHOTO_CONTROL_STEPS = [
    _step("intro", 0, "photo_intro", "begin", "У водителя может не быть доступа к заказам, пока обязательный фотоконтроль не пройден. Давай проверим, что именно ему нужно отправить.", "Начни вторую учебную миссию."),
    _step("profile", 1, "photo_profile", "open_photo_control", "Открой раздел «Фотоконтроль» в профиле водителя.", "Найди и открой фотоконтроль."),
    _step("checks_car", 2, "photo_checks", "select_check", "Красный крест означает, что проверка не пройдена и может блокировать работу. Начнём с автомобиля.", "Выбери фотоконтроль машины.", check_type="car"),
    _step("car_instruction", 3, "car_instruction", "view_instruction", "На снимке должен быть весь автомобиль или нужная часть салона. Кадр должен быть чётким и сделан с указанной стороны.", "Изучи семь обязательных ракурсов.", requirements=CAR_REQUIREMENTS),
    *[
        _step(
            f"car_slot_{item['slot_key']}",
            4 + index,
            "car_grid",
            "confirm_car_slot",
            "Заполняй слоты по порядку. Открой кадр, проверь критерий и используй фото.",
            f"Подтверди: {item['label']}.",
            slot_key=item["slot_key"],
            requirements=CAR_REQUIREMENTS,
        )
        for index, item in enumerate(CAR_REQUIREMENTS)
    ],
    _step("car_submit", 11, "car_grid", "submit_car_check", "Все семь кадров готовы. Отправь учебную проверку автомобиля.", "Отправь фотоконтроль машины.", requirements=CAR_REQUIREMENTS),
    _step("checks_license", 12, "photo_checks", "select_check", "Автомобиль принят. Теперь открой фотоконтроль водительского удостоверения.", "Выбери водительское удостоверение.", check_type="driver_license"),
    _step("license_front", 13, "license_grid", "confirm_license_side", "Нужны две стороны учебного удостоверения. Все края должны помещаться в кадре.", "Добавь лицевую сторону.", side="front"),
    _step("license_back", 14, "license_grid", "confirm_license_side", "Лицевая сторона готова. Добавь безопасный учебный образец обратной стороны.", "Добавь обратную сторону.", side="back"),
    _step("license_submit", 15, "license_grid", "submit_license_check", "Обе стороны готовы. Отправь проверку удостоверения.", "Отправь фотоконтроль удостоверения."),
    _step("checks_complete", 16, "photo_checks", "confirm_final_statuses", "Обе обязательные проверки пройдены. Убедись, что рядом с ними зелёные галочки.", "Подтверди два успешных статуса."),
    _step("completion", 17, "photo_result", "complete", "Готово! В реальном приложении после отправки остаётся дождаться результата проверки.", "Заверши миссию и сохрани балл."),
]


def ensure_photo_control_mission(db: Session) -> Mission:
    mission = db.scalar(select(Mission).where(Mission.code == MISSION_CODE))
    if mission is None:
        mission = Mission(code=MISSION_CODE)
        db.add(mission)
    mission.title = "Прохождение фотоконтроля"
    mission.description = "Научись находить непройденные проверки и заполнять семь кадров машины и две стороны учебного удостоверения."
    mission.mission_type = "assessment_tutorial"
    mission.sort_order = 2
    mission.reward_coins = 75
    mission.estimated_minutes = 10
    mission.is_active = True
    mission.version = 1
    mission.prerequisites_json = {
        "completed_mission_codes": ["login_first_time"],
        "passing_score": 80,
        "check_type": ["car", "driver_license"],
    }
    db.flush()

    existing = {
        row.step_key: row
        for row in db.scalars(
            select(MissionStep).where(
                MissionStep.mission_id == mission.id,
                MissionStep.mission_version == mission.version,
            )
        ).all()
    }
    expected = set()
    for payload in PHOTO_CONTROL_STEPS:
        expected.add(payload["step_key"])
        row = existing.get(payload["step_key"])
        if row is None:
            row = MissionStep(
                mission_id=mission.id,
                mission_version=mission.version,
                step_key=payload["step_key"],
            )
            db.add(row)
        for key, value in payload.items():
            setattr(row, key, value)
        row.is_required = True
    for key, row in existing.items():
        if key not in expected:
            db.delete(row)
    db.flush()
    return mission
