from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.models.entities import Mission, MissionSetting, MissionStep

DOCUMENT_SIGNING_MISSION_CODE = "smz_sign_previous_month_acts"
DOCUMENT_SIGNING_SETTING_KEY = "document_signing_window"
SAPAR_MISSION_CODE = "smz_sapar_provider_transfer"


def _step(key: str, order: int, screen: str, action: str, message: str, goal: str):
    return {
        "step_key": key,
        "step_order": order,
        "step_type": screen,
        "screen_key": screen,
        "action_key": action,
        "content_json": {"message": message, "goal": goal},
        "hint_text": "Следуй выделенному действию. Все данные и подписи в этой миссии учебные.",
        "is_required": True,
    }


DOCUMENT_SIGNING_STEPS = (
    _step(
        "intro",
        0,
        "signing_intro",
        "begin",
        "В этой миссии мы подпишем документы СМЗ-водителя за предыдущий месяц. Подписание выполняется в два этапа: сначала вход, затем сами АВР.",
        "Начни безопасный учебный сценарий.",
    ),
    _step(
        "date_check",
        1,
        "signing_date_check",
        "answer_date_eligibility",
        "Обычно документы подписываются с 5-го по 15-е число включительно. Руководитель может временно продлить срок, например до 25-го.",
        "Определи, доступно ли подписание в показанную дату.",
    ),
    _step(
        "period_check",
        2,
        "signing_period_check",
        "answer_target_period",
        "Сейчас {current_month}. Значит, водитель подписывает документы за {previous_month}.",
        "Выбери предыдущий календарный месяц.",
    ),
    _step(
        "sapar_login",
        3,
        "signing_sapar_login",
        "start_egov_signature",
        "Первая подпись в eGov Mobile подтверждает вход на сайт SAPAR.",
        "Нажми «Подписать в eGov Mobile».",
    ),
    _step(
        "egov_auth_code",
        4,
        "signing_egov_code_auth",
        "submit_training_code",
        "Учебный код для авторизации: {training_code}.",
        "Введи четырёхзначный учебный код.",
    ),
    _step(
        "egov_auth_sign",
        5,
        "signing_egov_sign_auth",
        "approve_signature",
        "Это первая подпись — она подтверждает только авторизацию на SAPAR.",
        "Подтверди учебную подпись для входа.",
    ),
    _step(
        "sapar_auth_return",
        6,
        "signing_egov_return_auth",
        "return_to_sapar",
        "Подпись принята. Теперь явно вернись на учебный сайт SAPAR.",
        "Нажми «Вернуться на SAPAR».",
    ),
    _step(
        "sapar_enter",
        7,
        "signing_sapar_authorized",
        "enter_sapar",
        "Авторизация подтверждена: на SAPAR появились ФИО и зелёная отметка.",
        "Нажми «Войти».",
    ),
    _step(
        "driver_profile",
        8,
        "signing_driver_profile",
        "open_target_avr",
        "Открой акт выполненных работ за предыдущий месяц.",
        "Открой АВР за {previous_month}.",
    ),
    _step(
        "avr_details",
        9,
        "signing_avr_details",
        "open_avr_package",
        "На следующем экране ты увидишь три учебных файла АВР.",
        "Нажми «Подписать» у нужного периода.",
    ),
    _step(
        "avr_package",
        10,
        "signing_avr_package",
        "start_egov_signature",
        "Проверь, что в комплекте есть АВР 1, АВР 2 и АВР 3.",
        "Запусти вторую подпись в eGov Mobile.",
    ),
    _step(
        "egov_docs_code",
        11,
        "signing_egov_code_documents",
        "submit_training_code",
        "Новая eGov-сессия для документов. Учебный код: {training_code}.",
        "Повторно введи учебный код.",
    ),
    _step(
        "egov_docs_sign",
        12,
        "signing_egov_sign_documents",
        "approve_signature",
        "Теперь подписывается комплект АВР, а не вход на сайт.",
        "Подтверди подпись документов.",
    ),
    _step(
        "sapar_docs_return",
        13,
        "signing_egov_return_documents",
        "return_to_sapar",
        "Подпись получена, но процесс ещё не завершён. Вернись на SAPAR.",
        "Вернись на сайт и найди кнопку «Сохранить».",
    ),
    _step(
        "save_documents",
        14,
        "signing_save_documents",
        "save_signed_documents",
        "Подпись получена, но документы станут подписанными только после сохранения.",
        "Нажми «Сохранить».",
    ),
    _step(
        "result",
        15,
        "signing_result",
        "complete",
        "Готово! Документы за {previous_month} успешно подписаны и сохранены.",
        "Проверь результат и заверши миссию.",
    ),
)


def ensure_document_signing_mission(db: Session, world_id: int) -> Mission:
    mission = db.scalar(
        select(Mission).where(Mission.code == DOCUMENT_SIGNING_MISSION_CODE)
    )
    if mission is None:
        mission = Mission(code=DOCUMENT_SIGNING_MISSION_CODE)
        db.add(mission)
    mission.title = "Подписание документов СМЗ"
    mission.description = (
        "Пройди две учебные подписи eGov Mobile, открой три АВР за предыдущий месяц "
        "и обязательно сохрани результат на SAPAR."
    )
    mission.mission_type = "assessment_tutorial"
    mission.sort_order = 4
    mission.world_id = world_id
    mission.world_sort_order = 2
    mission.reward_coins = 120
    mission.estimated_minutes = 9
    mission.is_active = True
    mission.version = 1
    mission.prerequisites_json = {
        "passing_score": 80,
        "completed_mission_codes": [SAPAR_MISSION_CODE],
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
    for payload in DOCUMENT_SIGNING_STEPS:
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
    for key, row in existing.items():
        if key not in expected:
            db.delete(row)

    setting = db.scalar(
        select(MissionSetting).where(
            MissionSetting.mission_id == mission.id,
            MissionSetting.key == DOCUMENT_SIGNING_SETTING_KEY,
            MissionSetting.version == 1,
        )
    )
    if setting is None:
        setting = MissionSetting(
            mission_id=mission.id,
            key=DOCUMENT_SIGNING_SETTING_KEY,
            version=1,
            value_json={
                "start_day": 5,
                "end_day": 15,
                "timezone": "Asia/Almaty",
                "exception_end_day": None,
                "exception_year_month": None,
                "operator_message": "Документы подписываются с 5-го по 15-е число включительно.",
            },
            effective_from=now_utc(),
            is_active=True,
        )
        db.add(setting)
    db.flush()
    return mission
