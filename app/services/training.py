"""Assignments and training-only analytics. Preview work never enters these queries."""

from collections import defaultdict
from datetime import UTC, datetime, time, timedelta
from statistics import mean, median

from sqlalchemy import select

from app.core.deps import visible_users_filter
from app.core.errors import DomainError, NotFoundError
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.learning import LearningAssignment, LearningAttempt, LearningContent
from app.models.user import User


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def assign(session, actor, content_id, payload):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    content = await session.get(LearningContent, content_id)
    if not content or content.status != "published":
        raise DomainError("Назначить можно только опубликованный материал")
    conditions = [
        User.role == Role.OPERATOR,
        User.is_active.is_(True),
        await visible_users_filter(session, actor),
    ]
    if not payload.all_operators:
        conditions.append(User.id.in_(payload.user_ids))
    ids = list(await session.scalars(select(User.id).where(*conditions).order_by(User.id)))
    if not payload.all_operators and set(ids) != set(payload.user_ids):
        raise NotFoundError("Один или несколько операторов недоступны")
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    created = 0
    for user_id in ids:
        result = await session.scalar(
            insert(LearningAssignment)
            .values(
                user_id=user_id,
                content_id=content.id,
                assigned_by_id=actor.id,
                deadline=payload.deadline,
            )
            .on_conflict_do_nothing(index_elements=["user_id", "content_id"])
            .returning(LearningAssignment.id)
        )
        created += result is not None
    await session.flush()
    return {"assigned": created, "already_assigned": len(ids) - created, "total": len(ids)}


async def analytics(
    session,
    actor,
    *,
    user_id=None,
    content_id=None,
    kind=None,
    state=None,
    date_from=None,
    date_to=None,
):
    if date_from and date_to and date_from > date_to:
        raise DomainError("Начало периода не может быть позже окончания")
    if date_to and date_to.year == 9999:
        raise DomainError("Выберите более раннюю дату окончания")
    visibility = [await visible_users_filter(session, actor), User.role == Role.OPERATOR]
    if user_id is not None:
        if not await session.scalar(select(User.id).where(*visibility, User.id == user_id)):
            raise NotFoundError("Оператор не найден")
        visibility.append(User.id == user_id)
    people = {u.id: u for u in await session.scalars(select(User).where(*visibility))}
    content_filters = []
    if content_id is not None:
        content_filters.append(LearningContent.id == content_id)
    if kind:
        content_filters.append(LearningContent.kind == kind)
    contents = {
        c.id: c for c in await session.scalars(select(LearningContent).where(*content_filters))
    }
    start = datetime.combine(date_from, time.min, UTC) if date_from else None
    end = datetime.combine(date_to + timedelta(days=1), time.min, UTC) if date_to else None

    def in_period(value):
        value = utc(value)
        return (start is None or value >= start) and (end is None or value < end)

    attempts = list(
        await session.scalars(
            select(LearningAttempt)
            .where(
                LearningAttempt.user_id.in_(people),
                LearningAttempt.content_id.in_(contents),
                LearningAttempt.is_preview.is_(False),
            )
            .order_by(LearningAttempt.id)
        )
    )
    shifts = list(
        await session.scalars(
            select(DriverShift)
            .where(
                DriverShift.user_id.in_(people),
                DriverShift.content_id.in_(contents),
                DriverShift.is_preview.is_(False),
            )
            .order_by(DriverShift.created_at)
        )
    )
    assignments = list(
        await session.scalars(
            select(LearningAssignment).where(
                LearningAssignment.user_id.in_(people),
                LearningAssignment.content_id.in_(contents),
            )
        )
    )
    groups = defaultdict(list)
    for item in attempts:
        if not in_period(item.created_at):
            continue
        groups[(item.user_id, item.content_id)].append(
            {
                "id": item.id,
                "state": item.state,
                "score": item.score,
                "created_at": item.created_at,
                "finished_at": item.finished_at,
                "seconds": max(0, (utc(item.finished_at) - utc(item.created_at)).total_seconds())
                if item.finished_at
                else None,
                "attempt": item,
            }
        )
    for item in shifts:
        if not in_period(item.created_at):
            continue
        score = (item.result or {}).get("score")
        status = (
            "in_progress"
            if not item.finished_at
            else "passed"
            if score is not None
            and score
            >= item.data.get("training_pass_percent", contents[item.content_id].pass_percent)
            else "failed"
        )
        groups[(item.user_id, item.content_id)].append(
            {
                "id": item.id,
                "state": status,
                "score": score,
                "created_at": item.created_at,
                "finished_at": item.finished_at,
                "seconds": (item.result or {}).get("seconds"),
                "errors": (item.result or {}).get("errors", 0),
                "checks": (item.result or {}).get("checks", []),
            }
        )
    assigned = {(a.user_id, a.content_id): a for a in assignments if in_period(a.created_at)}
    rows, selected_attempts = [], []
    for key in sorted(set(groups) | set(assigned)):
        user, material = people[key[0]], contents[key[1]]
        values = sorted(groups[key], key=lambda x: utc(x["created_at"]))
        status = (
            "passed"
            if any(x["state"] == "passed" for x in values)
            else values[-1]["state"]
            if values
            else "not_started"
        )
        if state and state != status:
            continue
        latest = values[-1] if values else None
        assignment = assigned.get(key)
        rows.append(
            {
                "user_id": user.id,
                "full_name": user.full_name,
                "login": user.login,
                "content_id": material.id,
                "title": material.title,
                "kind": material.kind,
                "assigned": assignment is not None,
                "deadline": assignment.deadline if assignment else None,
                "state": status,
                "attempts": len(values),
                "score": latest["score"] if latest else None,
                "finished_at": latest["finished_at"] if latest else None,
                "errors": sum(x.get("errors", 0) for x in values),
                "checks": latest.get("checks", []) if latest else [],
            }
        )
        selected_attempts.extend(values)
    scores = [x["score"] for x in selected_attempts if x["score"] is not None]
    finished = [x for x in selected_attempts if x["finished_at"]]
    durations = [x["seconds"] for x in finished if x["seconds"] is not None]
    passed = sum(x["state"] == "passed" for x in finished)
    questions = {}
    for value in selected_attempts:
        attempt = value.get("attempt")
        if not attempt:
            continue
        for i, step in enumerate(attempt.snapshot["steps"]):
            answer = attempt.answers.get(str(i))
            if answer is None:
                continue
            key = (attempt.content_id, attempt.snapshot.get("revision", 1), i)
            q = questions.setdefault(
                key,
                {
                    "content_id": attempt.content_id,
                    "title": attempt.snapshot["title"],
                    "revision": key[1],
                    "number": i + 1,
                    "question": step["text"],
                    "answers": 0,
                    "errors": 0,
                },
            )
            q["answers"] += 1
            q["errors"] += answer != step["correct"]
    for q in questions.values():
        q["error_percent"] = round(q["errors"] / q["answers"] * 100, 1)
    completed = sum(x["state"] in ("passed", "failed") for x in rows)
    return {
        "summary": {
            "operators": len({x["user_id"] for x in rows}),
            "total": len(rows),
            "assigned": sum(x["assigned"] for x in rows),
            "started": sum(x["attempts"] > 0 for x in rows),
            "completed": completed,
            "not_started": sum(x["state"] == "not_started" for x in rows),
            "in_progress": sum(x["state"] == "in_progress" for x in rows),
            "completion_percent": round(completed / len(rows) * 100, 1) if rows else 0,
            "attempts": len(selected_attempts),
            "repeat_attempts": sum(max(0, x["attempts"] - 1) for x in rows),
            "passed": passed,
            "failed": len(finished) - passed,
            "pass_percent": round(passed / len(finished) * 100, 1) if finished else 0,
            "fail_percent": round((len(finished) - passed) / len(finished) * 100, 1)
            if finished
            else 0,
            "average_score": round(mean(scores), 1) if scores else None,
            "median_score": median(scores) if scores else None,
            "min_score": min(scores) if scores else None,
            "max_score": max(scores) if scores else None,
            "average_seconds": round(mean(durations)) if durations else None,
        },
        "items": rows,
        "questions": sorted(
            questions.values(), key=lambda q: (-q["error_percent"], -q["errors"], q["number"])
        ),
    }
