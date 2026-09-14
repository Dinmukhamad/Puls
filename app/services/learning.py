"""Серверная проверка обучения. Ответы и награды не доверяются клиенту."""

from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.enums import TxType
from app.models.learning import LearningAttempt, LearningAward, LearningContent
from app.models.progress import Notification
from app.models.user import User
from app.services.badges import award_achievements
from app.services.coins import post_transaction


async def lock_learner(session: AsyncSession, user_id: int):
    # Serialize starts/submissions/rewards, including SQLite which has no FOR UPDATE.
    if session.get_bind().dialect.name == "sqlite":
        await session.execute(text("UPDATE users SET id = id WHERE id = :id"), {"id": user_id})
    else:
        await session.execute(select(User.id).where(User.id == user_id).with_for_update())


def content_data(content: LearningContent, *, editor: bool = False) -> dict:
    fields = (
        "id",
        "kind",
        "title",
        "description",
        "world",
        "difficulty",
        "minutes",
        "status",
        "is_required",
        "deadline",
        "allow_back",
        "pass_percent",
        "coins_reward",
        "revision",
    )
    result = {key: getattr(content, key) for key in fields}
    result["step_count"] = len(content.steps)
    if editor:
        result["steps"] = deepcopy(content.steps)
    return result


def attempt_data(attempt: LearningAttempt) -> dict:
    snapshot = deepcopy(attempt.snapshot)
    snapshot.pop("xp_reward", None)
    if attempt.state == "in_progress":
        for step in snapshot["steps"]:
            step.pop("correct", None)
            step.pop("explanation", None)
    return {
        "id": attempt.id,
        "content_id": attempt.content_id,
        "content": snapshot,
        "answers": attempt.answers,
        "state": attempt.state,
        "sim_stage": attempt.sim_stage,
        "score": attempt.score,
        "correct": attempt.correct,
        "awarded_coins": attempt.awarded_coins,
        "finished_at": attempt.finished_at,
    }


async def own_attempt(session: AsyncSession, user_id: int, attempt_id: int) -> LearningAttempt:
    attempt = await session.scalar(
        select(LearningAttempt)
        .where(LearningAttempt.id == attempt_id, LearningAttempt.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    if attempt is None:
        raise NotFoundError("Попытка не найдена")
    return attempt


async def start_attempt(session: AsyncSession, user_id: int, content_id: int):
    await lock_learner(session, user_id)
    content = await session.get(LearningContent, content_id)
    if content is None or content.status != "published":
        raise NotFoundError("Учебный материал недоступен")
    active = await session.scalar(
        select(LearningAttempt)
        .where(
            LearningAttempt.user_id == user_id,
            LearningAttempt.content_id == content_id,
            LearningAttempt.state == "in_progress",
        )
        .order_by(LearningAttempt.id.desc())
        .limit(1)
    )
    if active:
        return active
    snapshot = content_data(content, editor=True)
    snapshot["deadline"] = content.deadline.isoformat() if content.deadline else None
    attempt = LearningAttempt(user_id=user_id, content_id=content.id, snapshot=snapshot)
    session.add(attempt)
    await session.flush()
    return attempt


async def save_answer(session, user_id: int, attempt_id: int, step: int, answer: int):
    await lock_learner(session, user_id)
    attempt = await own_attempt(session, user_id, attempt_id)
    if attempt.state != "in_progress":
        raise ConflictError("Попытка уже завершена")
    steps = attempt.snapshot["steps"]
    if step >= len(steps) or answer >= len(steps[step]["options"]):
        raise DomainError("Такого вопроса или ответа нет")
    if step > len(attempt.answers):
        raise DomainError("Сначала ответьте на предыдущие вопросы")
    if (
        not attempt.snapshot["allow_back"]
        and str(step) in attempt.answers
        and attempt.answers[str(step)] != answer
    ):
        raise ConflictError("Возврат к сохранённому ответу отключён правилами")
    if attempt.snapshot["kind"] == "simulator" and attempt.sim_stage != "event":
        raise ConflictError("Дождитесь учебного события в поездке")
    attempt.answers = {**attempt.answers, str(step): answer}
    await session.flush()
    return attempt


async def finish_attempt(session, user_id: int, attempt_id: int):
    await lock_learner(session, user_id)
    attempt = await own_attempt(session, user_id, attempt_id)
    if attempt.state != "in_progress":
        return attempt
    steps = attempt.snapshot["steps"]
    if len(attempt.answers) != len(steps):
        raise DomainError("Ответьте на все вопросы перед завершением")
    if attempt.snapshot["kind"] == "simulator" and attempt.sim_stage != "complete":
        raise ConflictError("Сначала завершите поездку")
    attempt.correct = sum(
        attempt.answers[str(i)] == item["correct"] for i, item in enumerate(steps)
    )
    attempt.score = round(attempt.correct * 100 / len(steps))
    passed = attempt.correct * 100 >= attempt.snapshot["pass_percent"] * len(steps)
    attempt.state = "passed" if passed else "failed"
    attempt.finished_at = datetime.now(UTC)
    awarded = await session.scalar(
        select(LearningAward.id).where(
            LearningAward.user_id == user_id, LearningAward.content_id == attempt.content_id
        )
    )
    if passed and awarded is None:
        session.add(
            LearningAward(user_id=user_id, content_id=attempt.content_id, attempt_id=attempt.id)
        )
        title = attempt.snapshot["title"]
        key = f"learning:{user_id}:{attempt.content_id}"
        if coins := attempt.snapshot["coins_reward"]:
            await post_transaction(
                session,
                user_id=user_id,
                amount=coins,
                tx_type=TxType.LEARNING_REWARD,
                reason=f"Обучение: {title}",
                idempotency_key=key,
            )
            attempt.awarded_coins = coins
        await session.flush()
        await award_achievements(session, user_id)
        session.add(
            Notification(
                user_id=user_id,
                title="Обучение пройдено",
                body=title,
                kind="learning",
                link=f"/training/attempts/{attempt.id}",
            )
        )
    await session.flush()
    return attempt


SIM_TRANSITIONS = {
    ("registration", "register"): "otp",
    ("otp", "verify"): "photo",
    ("photo", "photo"): "mode",
    ("mode", "mode"): "route",
    ("route", "route"): "ready",
    ("ready", "online"): "offer",
    ("offer", "accept"): "accepted",
    ("offer", "skip"): "ready",
    ("accepted", "arrive"): "waiting",
    ("waiting", "start_trip"): "event",
    ("event", "resolve"): "in_trip",
    ("in_trip", "finish_trip"): "complete",
}


async def simulator_action(session, user_id: int, attempt_id: int, action: str):
    await lock_learner(session, user_id)
    attempt = await own_attempt(session, user_id, attempt_id)
    if attempt.snapshot["kind"] != "simulator" or attempt.state != "in_progress":
        raise ConflictError("Симуляция недоступна")
    following = SIM_TRANSITIONS.get((attempt.sim_stage, action))
    if following is None:
        raise ConflictError("Это действие недоступно на текущем этапе")
    if action == "resolve" and len(attempt.answers) != len(attempt.snapshot["steps"]):
        raise DomainError("Сначала разберите все учебные события")
    attempt.sim_stage = following
    await session.flush()
    return attempt
