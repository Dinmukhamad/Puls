"""What leaders see of the voice trainer: how their operators train calls with drivers.

A supervisor sees the operators and trainees of his own groups, a trainer, a head and an
administrator everyone they may identify on the site. They read any of these calls with its review,
answer the ones waiting for them and may send a call the rules graded to Claude; the drivers call
the operators, not the leaders.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.errors import DomainError, NotFoundError, PermissionDeniedError
from app.core.visibility import identity_filter
from app.models.enums import LEARNER_ROLES, Role
from app.models.user import Group, User
from app.models.voice_training import VoiceTrainingAttempt
from app.services import voice_ai, voice_scenarios, voice_training
from app.services.learning import lock_learner
from app.services.scenarios import utc

LEADERS = (Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN)
PERIODS = (7, 30, 90)
CALLS_LIMIT = 300
#: A score below this is a call worth reading with the operator.
LOW_SCORE = 50


def require_leader(user):
    if not user.is_active or user.role not in LEADERS:
        raise PermissionDeniedError("Обзор голосового тренажёра доступен руководителям.")


def members_query(user):
    """The operators and trainees a leader looks after."""
    query = select(User).where(
        User.is_active.is_(True), User.role.in_(LEARNER_ROLES), identity_filter(user, User)
    )
    if user.role == Role.SUPERVISOR:
        query = query.where(
            User.group_id.in_(
                select(Group.id).where(Group.supervisor_id == user.id, Group.is_active.is_(True))
            )
        )
    return query


def grader(attempt):
    """Who gave the score: «ai», «rules», «mentor»; «awaiting» while a mentor has not; None while
    the call goes on."""
    result = attempt.result
    if attempt.state != "completed" or not result:
        return None
    if result.get("ai"):
        return "ai"
    if result.get("manual"):
        return "mentor" if result.get("review_status") == "reviewed" else "awaiting"
    return "rules"


def needs_answer(attempt):
    """A call waiting for the mentor: the editor's call to grade, or a disputed score."""
    status = (attempt.result or {}).get("review_status")
    return bool(attempt.review) and status in ("awaiting_grade", "pending")


def average(values):
    return round(sum(values) / len(values)) if values else None


def call_row(attempt, learner, groups):
    result = attempt.result or {}
    return {
        "id": attempt.id,
        "user_id": learner.id,
        "user_name": learner.full_name,
        "group_name": groups.get(learner.group_id),
        "title": attempt.snapshot["title"],
        "custom": bool(attempt.snapshot.get("custom")),
        "persona": attempt.persona,
        "language": attempt.snapshot.get("language", "ru"),
        "state": attempt.state,
        "score": result.get("score"),
        "grader": grader(attempt),
        "review_status": result.get("review_status"),
        "critical": bool(result.get("critical_errors")),
        "ai_driver": voice_training.ai_driver(attempt),
        "ai_review": (result.get("ai_review") or {}).get("score"),
        "created_at": utc(attempt.created_at),
        "finished_at": utc(attempt.finished_at) if attempt.finished_at else None,
    }


async def overview(session, user, days=30, group_id=None):
    """The team over a period: totals against the period before, each operator, the weakest
    skills, the calls, and what waits for the leader (whenever it came)."""
    require_leader(user)
    if days not in PERIODS:
        raise DomainError("Период: 7, 30 или 90 дней.")
    everyone = list(await session.scalars(members_query(user).order_by(User.full_name)))
    groups = {
        group.id: group.name
        for group in await session.scalars(
            select(Group).where(Group.id.in_({m.group_id for m in everyone if m.group_id}))
        )
    }
    members = [m for m in everyone if group_id is None or m.group_id == group_id]
    learners = {m.id: m for m in members}
    now = datetime.now(UTC)
    since, before = now - timedelta(days=days), now - timedelta(days=2 * days)
    attempts = list(
        await session.scalars(
            select(VoiceTrainingAttempt)
            .where(
                VoiceTrainingAttempt.user_id.in_(list(learners)),
                (VoiceTrainingAttempt.created_at >= before)
                | VoiceTrainingAttempt.review.is_not(None),
            )
            .order_by(VoiceTrainingAttempt.id.desc())
        )
    ) if learners else []
    current = [a for a in attempts if utc(a.created_at) >= since]
    previous = [a for a in attempts if before <= utc(a.created_at) < since]
    done, done_before = voice_training.graded(current), voice_training.graded(previous)
    finished = [a for a in current if a.state == "completed"]
    waiting = [a for a in attempts if needs_answer(a)]
    by_user, before_by_user = defaultdict(list), defaultdict(list)
    for attempt in done:
        by_user[attempt.user_id].append(attempt)
    for attempt in done_before:
        before_by_user[attempt.user_id].append(attempt)
    calls_by_user = defaultdict(list)
    for attempt in finished:
        calls_by_user[attempt.user_id].append(attempt)
    operators = []
    for member in members:
        mine, calls = by_user[member.id], calls_by_user[member.id]
        score = average([a.result["score"] for a in mine])
        earlier = average([a.result["score"] for a in before_by_user[member.id]])
        operators.append({
            "id": member.id,
            "name": member.full_name,
            "role": member.role,
            "group_id": member.group_id,
            "group_name": groups.get(member.group_id),
            "calls": len(calls),
            "average": score,
            "change": score - earlier if score is not None and earlier is not None else None,
            "best": max((a.result["score"] for a in mine), default=None),
            "last": (
                {"id": calls[0].id, "score": (calls[0].result or {}).get("score"),
                 "at": utc(calls[0].created_at)}
                if calls else None
            ),
            "ai_calls": sum(1 for a in calls if grader(a) == "ai"),
            "waiting": sum(1 for a in waiting if a.user_id == member.id),
            "weak": [entry["label"] for entry in voice_training.skills(mine[:10], limit=2)],
        })
    scores = [a.result["score"] for a in done]
    scores_before = [a.result["score"] for a in done_before]
    practiced = {a.user_id for a in finished}
    return {
        "period": {"days": days, "since": since, "until": now},
        "groups": [{"id": key, "name": name} for key, name in sorted(groups.items(),
                                                                       key=lambda item: item[1])],
        "group_id": group_id,
        "summary": {
            "calls": len(finished),
            "calls_before": len([a for a in previous if a.state == "completed"]),
            "average": average(scores),
            "average_before": average(scores_before),
            "operators": len(members),
            "practiced": len(practiced),
            "ai_graded": sum(1 for a in finished if grader(a) == "ai"),
            "awaiting_grade": sum(1 for a in waiting if a.result["review_status"] ==
                                  "awaiting_grade"),
            "disputes": sum(1 for a in waiting if a.result["review_status"] == "pending"),
            "low": sum(1 for a in done if a.result["score"] < LOW_SCORE),
        },
        "operators": operators,
        "skills": voice_training.skills(done, limit=4),
        "calls": [call_row(a, learners[a.user_id], groups) for a in current[:CALLS_LIMIT]],
        "queue": [
            {
                **call_row(a, learners[a.user_id], groups),
                "comment": a.review.get("comment", ""),
                "requested_at": a.review.get("created_at"),
            }
            for a in waiting
        ],
        "ai": await voice_ai.status(session),
        "scenarios": len(await voice_scenarios.playable(session)),
    }


async def team_attempt(session, user, attempt_id, *, lock=False):
    """One call of an operator the leader looks after, with the operator."""
    require_leader(user)
    row = (
        await session.execute(
            select(VoiceTrainingAttempt, User)
            .join(User, User.id == VoiceTrainingAttempt.user_id)
            .where(
                VoiceTrainingAttempt.id == attempt_id,
                User.id.in_(members_query(user).with_only_columns(User.id)),
            )
            .execution_options(populate_existing=True)
        )
    ).first()
    if row is None:
        raise NotFoundError("Звонок не найден среди звонков ваших операторов.")
    if lock:
        await lock_learner(session, row[1].id)
        return await team_attempt(session, user, attempt_id)
    return row


def call_data(attempt, learner):
    group = learner.group
    return {
        **voice_training.attempt_data(attempt),
        "learner": {
            "id": learner.id, "name": learner.full_name, "group_id": learner.group_id,
            "group_name": group.name if group else None,
        },
        "review": attempt.review,
        "needs_answer": needs_answer(attempt),
    }


async def call(session, user, attempt_id):
    attempt, learner = await team_attempt(session, user, attempt_id)
    await session.refresh(learner, ["group"])
    return call_data(attempt, learner)


async def ai_review(session, user, attempt_id):
    """«Оценить с ИИ» by the leader for an operator's call; returns the call and any problem."""
    attempt, learner = await team_attempt(session, user, attempt_id, lock=True)
    attempt, problem = await voice_training.send_to_ai(session, attempt)
    await session.refresh(learner, ["group"])
    return call_data(attempt, learner), problem
