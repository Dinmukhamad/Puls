"""Server-authoritative consultation dialogue, verified practice and atomic city reward."""

import json
import re
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.models.city import CityAward
from app.models.crm import CrmAppeal
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.scenario import ScenarioAttempt
from app.models.user import Group
from app.services import city_world, dispatch
from app.services.coins import post_transaction
from app.services.crm_catalog import default_categories
from app.services.learning import lock_learner
from app.services.rules import write_audit
from app.services.scenario_catalog import (
    DRIVER_KEY,
    KEY,
    MISSION_KEY,
    definition,
)


async def support_group_ids(session, *, config=None) -> set[int]:
    # Preserve world.home_city's last-match behavior for legacy assignments too.
    assignments = {}
    for city in (config if config is not None else await city_world.settings(session))["cities"]:
        for district in city["districts"]:
            for group_id in district["group_ids"]:
                assignments[group_id] = city["id"]
    return {group_id for group_id, city_id in assignments.items() if city_id == "support"}


async def support_allowed(session, user) -> bool:
    if not user.is_active or user.role != Role.OPERATOR or user.group_id is None:
        return False
    active = await session.scalar(select(Group.is_active).where(Group.id == user.group_id))
    return bool(active and user.group_id in await support_group_ids(session))


async def require_scope(session, user):
    if not user.is_active:
        raise PermissionDeniedError("Учётная запись отключена")
    if user.role == Role.OPERATOR and not await support_allowed(session, user):
        raise PermissionDeniedError(
            (
                "Сценарии доступны только операторам ТП, чья группа назначена району "
                "города Техподдержка."
            ),
            code="scenario_city_required",
        )
    if user.role not in (Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Предварительный просмотр недоступен")


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def normalized(value):
    return re.sub(r"\s+", " ", str(value)).strip().casefold().replace("ё", "е")


def phone_digits(value):
    return re.sub(r"\D", "", value or "")


def attempt_data(attempt):
    snapshot = deepcopy(attempt.snapshot)
    steps = snapshot["steps"]
    feedback = None
    for index, item in enumerate(steps):
        answer = attempt.answers.get(str(index))
        if answer is not None:
            item["answered_correctly"] = answer == item["correct"]
            feedback = {"correct": item["answered_correctly"], "explanation": item["explanation"]}
        else:
            item.pop("explanation", None)
        # Correct option numbers never ship as a reusable answer key.
        item.pop("correct", None)
    return {
        "id": attempt.id,
        "scenario_key": attempt.scenario_key,
        "revision": attempt.revision,
        "title": snapshot["title"],
        "description": snapshot["description"],
        "state": attempt.state,
        "phase": attempt.phase,
        "current_step": attempt.current_step,
        "steps": steps,
        "answers": attempt.answers,
        "feedback": feedback,
        "practice": {
            "dispatch": bool(attempt.practice.get("dispatch")),
            "crm": bool(attempt.practice.get("crm")),
            "crm_appeal_id": attempt.practice.get("crm", {}).get("appeal_id"),
        },
        "driver": snapshot["driver"],
        "classifier": snapshot["classifier"],
        "crm_requirements": snapshot["crm_requirements"],
        "coins_reward": snapshot["reward"]["coins"],
        "awarded_coins": attempt.awarded_coins,
        "reward_already_claimed": attempt.reward_already_claimed,
        "score": attempt.score,
        "pass_percent": snapshot["pass_percent"],
        "is_preview": attempt.is_preview,
        "finished_at": utc(attempt.finished_at) if attempt.finished_at else None,
    }


async def catalog(session, user):
    await require_scope(session, user)
    from app.services.city import settings

    data = definition()
    latest = await session.scalar(
        select(ScenarioAttempt)
        .where(
            ScenarioAttempt.user_id == user.id,
            ScenarioAttempt.scenario_key == KEY,
            ScenarioAttempt.is_preview == (user.role != Role.OPERATOR),
        )
        .order_by(ScenarioAttempt.id.desc())
        .limit(1)
    )
    completed = (
        bool(await session.get(CityAward, (user.id, MISSION_KEY)))
        if user.role == Role.OPERATOR
        else bool(
            await session.scalar(
                select(ScenarioAttempt.id)
                .where(
                    ScenarioAttempt.user_id == user.id,
                    ScenarioAttempt.scenario_key == KEY,
                    ScenarioAttempt.is_preview.is_(True),
                    ScenarioAttempt.state == "passed",
                )
                .limit(1)
            )
        )
    )
    mission = (await settings(session))["missions"][MISSION_KEY]
    return {
        "city": "support",
        "is_preview": user.role != Role.OPERATOR,
        "items": [
            {
                **{
                    key: data[key]
                    for key in (
                        "key",
                        "title",
                        "description",
                        "minutes",
                        "revision",
                        "pass_percent",
                        "critical_required",
                    )
                },
                "coins_reward": mission["coins"],
                "enabled": mission["enabled"],
                "completed": completed,
                "attempt_id": latest.id if latest else None,
                "state": latest.state if latest else "new",
            }
        ],
    }


async def start(session, user, key):
    await require_scope(session, user)
    if key != KEY:
        raise NotFoundError("Сценарий не найден")
    await lock_learner(session, user.id)
    await session.refresh(user)
    await require_scope(session, user)
    preview = user.role != Role.OPERATOR
    attempt = await session.scalar(
        select(ScenarioAttempt)
        .where(
            ScenarioAttempt.user_id == user.id,
            ScenarioAttempt.scenario_key == key,
            ScenarioAttempt.is_preview == preview,
            ScenarioAttempt.state == "in_progress",
        )
        .order_by(ScenarioAttempt.id.desc())
    )
    if attempt:
        if not preview and await session.get(CityAward, (user.id, MISSION_KEY)):
            attempt.reward_already_claimed = True
        return attempt
    from app.services.city import settings

    mission = (await settings(session))["missions"][MISSION_KEY]
    if not preview and not mission["enabled"]:
        raise ConflictError(
            "Сценарий временно на паузе. Новые попытки откроются после включения руководителем."
        )
    driver = dispatch.fold(await dispatch.history(session, user.id))["drivers"][DRIVER_KEY]
    park = dispatch.PARK_BY_ID[driver["park"]]
    car = driver["car"]
    if not car:
        raise ConflictError(
            "В учебном аккаунте нет автомобиля. Восстановите учебную диспетчерскую перед началом."
        )
    snapshot = definition()
    snapshot["reward"] = deepcopy(mission)
    snapshot["driver"] = {
        "id": driver["id"],
        "name": dispatch.full_name(driver),
        "phone": driver["phone"],
        "license_number": driver["license"],
        "park_id": park["id"],
        "park": park["name"],
        "city": park["city"],
    }
    snapshot["observations"] = {
        "driver_id": driver["id"],
        "license_number": driver["license"],
        **{key: car[key] for key in ("brand", "model", "year", "color")},
        "employment": driver["employment"],
        "park": park["name"],
        "city": park["city"],
        "classification_result": "not_confirmed",
    }
    # Timestamp precision varies by database. The append-only CRM identifier also
    # rejects an older record created within the same timestamp tick as this run.
    snapshot["crm_after_id"] = int(
        await session.scalar(
            select(func.coalesce(func.max(CrmAppeal.id), 0)).where(CrmAppeal.author_id == user.id)
        )
        or 0
    )
    attempt = ScenarioAttempt(
        user_id=user.id,
        scenario_key=key,
        revision=snapshot["revision"],
        snapshot=snapshot,
        answers={},
        practice={},
        current_step=0,
        phase="dialogue",
        state="in_progress",
        is_preview=preview,
        reward_already_claimed=(
            not preview and bool(await session.get(CityAward, (user.id, MISSION_KEY)))
        ),
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def own_attempt(session, user, attempt_id, *, lock=False):
    await require_scope(session, user)
    if lock:
        await lock_learner(session, user.id)
        await session.refresh(user)
        await require_scope(session, user)
    attempt = await session.scalar(
        select(ScenarioAttempt)
        .where(
            ScenarioAttempt.id == attempt_id,
            ScenarioAttempt.user_id == user.id,
        )
        .execution_options(populate_existing=True)
    )
    if attempt is None:
        raise NotFoundError("Попытка сценария не найдена")
    if attempt.is_preview != (user.role != Role.OPERATOR):
        raise PermissionDeniedError("Роль изменилась. Начните новую попытку для текущей роли.")
    return attempt


async def answer(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    stored = attempt.answers.get(str(body.step))
    if stored is not None:
        if stored == body.answer:
            return attempt
        raise ConflictError(
            "Ответ уже принят. Повторить тренировку можно после завершения сценария."
        )
    if (
        attempt.state != "in_progress"
        or attempt.phase != "dialogue"
        or body.step != attempt.current_step
    ):
        raise ConflictError("Выполните текущий шаг сценария")
    step = attempt.snapshot["steps"][body.step]
    if body.answer >= len(step["options"]):
        raise DomainError("Выберите один из вариантов ответа")
    attempt.answers = {**attempt.answers, str(body.step): body.answer}
    attempt.current_step += 1
    if attempt.current_step == attempt.snapshot["dispatch_after"]:
        attempt.phase = "dispatch"
    elif attempt.current_step == len(attempt.snapshot["steps"]):
        attempt.phase = "crm"
    return attempt


async def dispatch_check(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    observations = body.model_dump()
    accepted = attempt.practice.get("dispatch")
    if accepted:
        if accepted["observations"] == observations:
            return attempt
        raise ConflictError("Проверка диспетчерской уже сохранена для этой попытки")
    if attempt.state != "in_progress" or attempt.phase != "dispatch":
        raise ConflictError("Сначала дойдите до проверки профиля в диалоге")
    driver = next(
        (
            item
            for item in dispatch.fold(await dispatch.history(session, user.id))["drivers"].values()
            if item["id"] == attempt.snapshot["driver"]["id"]
        ),
        None,
    )
    expected = attempt.snapshot["observations"]
    if (
        not driver
        or not driver.get("car")
        or any(
            normalized(driver["car"][key]) != normalized(expected[key])
            for key in ("brand", "model", "year", "color")
        )
        or driver["employment"] != expected["employment"]
    ):
        raise ConflictError(
            "Учебный профиль изменён после начала сценария. Восстановите исходные "
            "данные в диспетчерской."
        )
    mismatched = [
        key for key, value in expected.items() if normalized(observations[key]) != normalized(value)
    ]
    if mismatched:
        raise DomainError(
            "Данные не совпадают с учебным профилем. Проверьте действующий аккаунт, "
            "автомобиль, парк, город и предварительный вывод ещё раз."
        )
    attempt.practice = {
        **attempt.practice,
        "dispatch": {"observations": observations, "verified_at": datetime.now(UTC).isoformat()},
    }
    attempt.phase = "dialogue"
    return attempt


async def validate_crm(session, user, attempt, appeal_id):
    appeal = await session.get(CrmAppeal, appeal_id)
    driver = attempt.snapshot["driver"]
    if not appeal or appeal.author_id != user.id:
        raise DomainError("Выберите обращение, которое вы сохранили в CRM для этой консультации")
    if appeal.id <= attempt.snapshot["crm_after_id"] or utc(appeal.created_at) < utc(
        attempt.created_at
    ):
        raise DomainError("Обращение должно быть создано после начала этой попытки")
    if (
        appeal.driver_id != driver["id"]
        or phone_digits(appeal.phone) != phone_digits(driver["phone"])
        or normalized(appeal.license_number) != normalized(driver["license_number"])
        or normalized(appeal.park) != normalized(driver["park"])
        or normalized(appeal.city) != normalized(driver["city"])
    ):
        raise DomainError("Обращение относится к другому водителю, парку или городу")
    allowed = {
        item["id"] for item in default_categories() if item["label"] == "Консультация по Тарифам"
    }
    if not allowed.intersection(appeal.category_ids) or appeal.is_ticket:
        raise DomainError("Сохраните консультацию по тарифам, а не заявку или другую категорию")
    details = appeal.details or {}
    try:
        checks = json.loads(details.get("scenario_checks", "[]"))
    except (TypeError, ValueError):
        checks = []
    if (
        details.get("scenario_attempt") != str(attempt.id)
        or not isinstance(checks, list)
        or set(map(str, checks)) != {item["key"] for item in attempt.snapshot["crm_requirements"]}
        or details.get("scenario_outcome") != "not_confirmed"
        or details.get("scenario_next_action") != "check_pro_diagnostics"
        or len(appeal.comment.strip()) < 40
    ):
        raise DomainError(
            "Заполните в CRM все пункты консультации, предварительный итог и "
            "следующее действие по сценарию"
        )
    return appeal


async def crm_check(session, user, attempt_id, body):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    accepted = attempt.practice.get("crm")
    if accepted:
        if accepted["appeal_id"] == body.appeal_id:
            return attempt
        raise ConflictError("Для этой попытки уже подтверждено другое обращение")
    if attempt.state != "in_progress" or attempt.phase != "crm":
        raise ConflictError("Сначала завершите диалог и проверку диспетчерской")
    await validate_crm(session, user, attempt, body.appeal_id)
    attempt.practice = {
        **attempt.practice,
        "crm": {"appeal_id": body.appeal_id, "verified_at": datetime.now(UTC).isoformat()},
    }
    return attempt


async def finish(session, user, attempt_id):
    attempt = await own_attempt(session, user, attempt_id, lock=True)
    if attempt.state != "in_progress":
        return attempt
    steps = attempt.snapshot["steps"]
    if (
        attempt.current_step != len(steps)
        or len(attempt.answers) != len(steps)
        or not attempt.practice.get("dispatch")
        or not attempt.practice.get("crm")
    ):
        raise ConflictError("Завершите диалог и практику в диспетчерской и CRM")
    await validate_crm(session, user, attempt, attempt.practice["crm"]["appeal_id"])
    correct = sum(attempt.answers.get(str(i)) == step["correct"] for i, step in enumerate(steps))
    attempt.score = round(correct * 100 / len(steps))
    critical = all(
        not step["critical"] or attempt.answers.get(str(i)) == step["correct"]
        for i, step in enumerate(steps)
    )
    passed = correct * 100 >= attempt.snapshot["pass_percent"] * len(steps) and critical
    attempt.state = "passed" if passed else "failed"
    attempt.phase = "complete"
    attempt.finished_at = datetime.now(UTC)
    if not passed or attempt.is_preview:
        return attempt
    # Uses the city's existing once-per-operator key: no independent LearningAward payout.
    award = await session.get(CityAward, (user.id, MISSION_KEY), populate_existing=True)
    if award:
        attempt.reward_already_claimed = True
        return attempt
    reward = deepcopy(attempt.snapshot["reward"])
    # XP is deliberately zero for consultation training: reward is configurable coins only.
    reward["xp"] = 0
    session.add(
        CityAward(
            user_id=user.id, mission_key=MISSION_KEY, snapshot=reward, xp=0, coins=reward["coins"]
        )
    )
    if reward["coins"]:
        transaction = await post_transaction(
            session,
            user_id=user.id,
            amount=reward["coins"],
            tx_type=TxType.LEARNING_REWARD,
            reason=f"Сценарий: {reward['title']}",
            idempotency_key=f"city:{user.id}:{MISSION_KEY}",
            meta={
                "mission": MISSION_KEY,
                "scenario": KEY,
                "attempt_id": attempt.id,
                "revision": attempt.revision,
            },
        )
        if transaction is None:
            raise ConflictError("Награда уже есть в журнале. Обновите результат сценария.")
    attempt.awarded_coins = reward["coins"]
    session.add(
        Notification(
            user_id=user.id,
            title="Сценарий пройден",
            body=reward["title"],
            kind="learning",
            link=f"/training/scenarios/attempts/{attempt.id}",
        )
    )
    await write_audit(
        session,
        actor_id=user.id,
        action="scenario.reward",
        entity_type="scenario_attempt",
        entity_id=str(attempt.id),
        payload={
            "scenario": KEY,
            "revision": attempt.revision,
            "coins": reward["coins"],
            "score": attempt.score,
        },
    )
    return attempt
