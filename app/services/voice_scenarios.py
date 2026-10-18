"""Voice call scenarios that staff write in the editor: keyword dialogue, draft and publication.

A scenario is a chain of steps. On each step the driver waits for the operator's answer: the first
reply whose keywords are heard leads to its driver line and the next step (or ends the call);
nothing heard means the step's fallback line. Forbidden phrases are critical errors and may
make the driver react.
The operator's calls are graded by a mentor (app/services/voice_training.py, the review queue).
"""

import re
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.models.enums import Role
from app.models.user import User
from app.models.voice_scenario import VoiceScenario

EDITORS = (Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN)
END = "end"
RESOLVED = "resolved"
KEY_PREFIX = "custom:"
# Words that turn a phrase into its opposite: «не меняем номер», «нөмір ауыстыру мүмкін емес».
NEGATIONS_BEFORE = frozenset(("не", "нельзя", "нет", "ни", "никак", "без", "невозможно"))
NEGATIONS_AFTER = frozenset(("емес", "жоқ", "болмайды"))
# «не» negates the next word, or the verb after a helper: «не могу сменить», «не будем удалять».
HELPERS = ("мог", "може", "смог", "сможе", "получ", "удаст", "буд", "стоит", "нужн", "надо",
           "следует", "имее", "имею", "хоч", "хот", "стан", "собира")
WORD = re.compile(r"[0-9a-zа-яәғқңөұүһі]+\*?")


def empty_content():
    return {
        "title": "",
        "description": "",
        "language": "ru",
        "minutes": 5,
        "driver": {"name": "", "phone": "", "park": ""},
        "notes": "",
        "solution": "",
        "opening": "",
        "steps": [{
            "id": "s1", "name": "", "fallback": "",
            "replies": [{"keywords": [], "driver": "", "next": "end"}],
        }],
        "forbidden": [],
    }


def words(text):
    return WORD.findall(text.lower().replace("ё", "е"))


def _pattern(word):
    """A keyword ignores its ending: «приложение» finds «приложении», «нөмір» — «нөміріңізді»."""
    if word.endswith("*"):
        return word[:-1], True
    cut = 2 if len(word) >= 7 else 1 if len(word) >= 5 else 0
    return word[: len(word) - cut], cut > 0


def _fits(token, pattern):
    stem, prefix = pattern
    return token.startswith(stem) if prefix else token == stem


def heard(phrase, tokens):
    """Whether the phrase is said, not negated: its words in order, at most two words between."""
    said = words(phrase)
    if not said:
        return False
    patterns = [_pattern(word) for word in said]
    # A phrase that is itself a negation («не может», «нельзя») is looked for as it is.
    negated_phrase = said[0].rstrip("*") in NEGATIONS_BEFORE
    for start, token in enumerate(tokens):
        if not _fits(token, patterns[0]):
            continue
        end, ok = start, True
        for pattern in patterns[1:]:
            following = next(
                (i for i in range(end + 1, min(end + 4, len(tokens))) if _fits(tokens[i], pattern)),
                None,
            )
            if following is None:
                ok = False
                break
            end = following
        if not ok:
            continue
        before = tokens[max(0, start - 2):start]
        negated = bool(before) and (
            before[-1] in NEGATIONS_BEFORE
            or (len(before) == 2 and before[0] in NEGATIONS_BEFORE
                and before[1].startswith(HELPERS))
        )
        if not negated_phrase and (
            negated or NEGATIONS_AFTER.intersection(tokens[end + 1:end + 3])
        ):
            continue
        return True
    return False


def match(keywords, text):
    """The first keyword heard in the text, or None."""
    tokens = words(text)
    return next((k for k in keywords if k.strip() and heard(k, tokens)), None)


def step_by_id(content, step_id):
    return next((step for step in content["steps"] if step["id"] == step_id), None)


def first_stage(content):
    return content["steps"][0]["id"]


def reply(content, stage, text):
    """The driver's answer to one operator line: (next stage, driver text, line key, details)."""
    for index, item in enumerate(content.get("forbidden", [])):
        keyword = match(item["keywords"], text)
        if keyword and item.get("driver", "").strip():
            details = {"forbidden": index, "keyword": keyword}
            return stage, item["driver"], f"forbidden:{index}", details
    step = step_by_id(content, stage)
    if step is None:
        raise ConflictError("Шаг сценария не найден. Начните звонок заново.")
    for index, option in enumerate(step["replies"]):
        keyword = match(option["keywords"], text)
        if keyword:
            following = RESOLVED if option["next"] == END else option["next"]
            return following, option["driver"], f"{step['id']}:{index}", {"keyword": keyword}
    return stage, step["fallback"], f"{step['id']}:fallback", {}


def forbidden_hits(content, text):
    return [
        (index, keyword)
        for index, item in enumerate(content.get("forbidden", []))
        if (keyword := match(item["keywords"], text))
    ]


def problems(content):
    """What keeps a draft from being published, in the editor's words."""
    issues = []
    if len(content["title"].strip()) < 3:
        issues.append("Укажите название сценария.")
    if len(content["description"].strip()) < 5:
        issues.append("Опишите ситуацию для оператора.")
    if not content["driver"]["name"].strip():
        issues.append("Укажите имя водителя.")
    if not content["opening"].strip():
        issues.append("Напишите первую реплику водителя.")
    if not content["solution"].strip():
        issues.append("Опишите правильное решение: его увидят оператор и наставник после звонка.")
    ids = {step["id"] for step in content["steps"]}
    if not content["steps"]:
        issues.append("Добавьте хотя бы один шаг разговора.")
    ends = False
    for number, step in enumerate(content["steps"], 1):
        name = f"Шаг {number}" + (f" «{step['name'].strip()}»" if step["name"].strip() else "")
        if not step["replies"]:
            issues.append(f"{name}: добавьте хотя бы один ответ водителя.")
        if not step["fallback"].strip():
            issues.append(f"{name}: напишите, что скажет водитель, если не поймёт оператора.")
        for index, option in enumerate(step["replies"], 1):
            if not any(words(keyword) for keyword in option["keywords"]):
                issues.append(f"{name}, ответ {index}: добавьте ключевые слова оператора.")
            if not option["driver"].strip():
                issues.append(f"{name}, ответ {index}: напишите реплику водителя.")
            if option["next"] == END:
                ends = True
            elif option["next"] not in ids:
                issues.append(f"{name}, ответ {index}: выберите, куда ведёт ответ.")
    if content["steps"] and not ends:
        issues.append("Хотя бы один ответ должен завершать звонок.")
    for index, item in enumerate(content.get("forbidden", []), 1):
        if not any(words(keyword) for keyword in item["keywords"]):
            issues.append(f"Запрещённая фраза {index}: добавьте ключевые слова.")
        if not item["text"].strip():
            issues.append(f"Запрещённая фраза {index}: опишите ошибку для разбора.")
    return issues


def unreachable(content):
    """Steps no answer leads to: allowed, but the editor warns about them."""
    if not content["steps"]:
        return []
    seen, queue = {content["steps"][0]["id"]}, [content["steps"][0]["id"]]
    while queue:
        step = step_by_id(content, queue.pop())
        for option in step["replies"] if step else []:
            if option["next"] not in seen and option["next"] != END:
                seen.add(option["next"])
                queue.append(option["next"])
    return [step["id"] for step in content["steps"] if step["id"] not in seen]


def simulate(content, answers):
    """Plays a call for the editor: every operator line, the driver's answer and why."""
    turns = [{"role": "driver", "text": content["opening"]}]
    if not content["steps"]:
        return {"turns": turns, "stage": None, "resolved": False}
    stage = first_stage(content)
    for text in answers:
        if stage == RESOLVED:
            break
        hits = forbidden_hits(content, text)
        before = step_by_id(content, stage)
        if before is None:
            # An unfinished draft: the answer leads to a step that is not chosen yet.
            break
        stage, line, key, details = reply(content, stage, text)
        turns.append({
            "role": "operator",
            "text": text,
            "step": before["id"] if before else None,
            "keyword": details.get("keyword") if "forbidden" not in details else None,
            "fallback": key.endswith(":fallback"),
            "forbidden": [
                {"text": content["forbidden"][index]["text"], "keyword": keyword}
                for index, keyword in hits
            ],
        })
        turns.append({"role": "driver", "text": line, "stage": stage})
    return {"turns": turns, "stage": stage, "resolved": stage == RESOLVED}


# Editing: trainers, supervisors, heads and admins write, publish and withdraw scenarios.

def require_editor(user):
    if not user.is_active or user.role not in EDITORS:
        raise PermissionDeniedError(
            "Сценарии звонков редактируют тренеры, супервайзеры, руководители и администраторы."
        )


def status(row):
    if row.published is None:
        return "draft"
    if not row.active:
        return "withdrawn"
    return "published" if row.published == row.draft else "changed"


async def names(session, ids):
    ids = {item for item in ids if item}
    if not ids:
        return {}
    rows = await session.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return dict(rows.all())


def summary(row, people):
    return {
        "id": row.id,
        "key": f"{KEY_PREFIX}{row.id}",
        "title": row.title,
        "language": row.draft.get("language", "ru"),
        "status": status(row),
        "revision": row.revision,
        "steps": len(row.draft.get("steps", [])),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by": people.get(row.updated_by_id),
        "published_at": row.published_at.isoformat() if row.published_at else None,
        "published_by": people.get(row.published_by_id),
    }


async def editor_list(session, user):
    require_editor(user)
    rows = list(await session.scalars(select(VoiceScenario).order_by(VoiceScenario.id.desc())))
    people = await names(session, [i for r in rows for i in (r.updated_by_id, r.published_by_id)])
    return {"scenarios": [summary(row, people) for row in rows]}


async def editor_row(session, user, scenario_id, *, lock=False):
    require_editor(user)
    query = select(VoiceScenario).where(VoiceScenario.id == scenario_id)
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query.execution_options(populate_existing=True))
    if row is None:
        raise NotFoundError("Сценарий не найден.")
    return row


async def editor_data(session, row):
    people = await names(session, [row.updated_by_id, row.published_by_id, row.created_by_id])
    return {
        **summary(row, people),
        "draft": deepcopy(row.draft),
        "draft_version": row.draft_version,
        "published": deepcopy(row.published),
        "problems": problems(row.draft),
        "unreachable": unreachable(row.draft),
        "created_by": people.get(row.created_by_id),
    }


async def create(session, user):
    require_editor(user)
    row = VoiceScenario(
        title="Новый сценарий", draft=empty_content(), draft_version=1, revision=0, active=False,
        created_by_id=user.id, updated_by_id=user.id,
    )
    session.add(row)
    await session.flush()
    return row


async def save(session, user, scenario_id, body):
    row = await editor_row(session, user, scenario_id, lock=True)
    if body.draft_version != row.draft_version:
        raise ConflictError(
            "Сценарий изменил другой сотрудник. Обновите страницу, чтобы не потерять правки."
        )
    content = body.content.model_dump()
    row.draft = content
    row.title = content["title"].strip() or "Без названия"
    row.draft_version += 1
    row.updated_by_id = user.id
    await session.flush()
    return row


async def publish(session, user, scenario_id, draft_version):
    row = await editor_row(session, user, scenario_id, lock=True)
    if draft_version != row.draft_version:
        raise ConflictError(
            "Сценарий изменил другой сотрудник. Обновите страницу перед публикацией."
        )
    issues = problems(row.draft)
    if issues:
        raise DomainError("Сценарий нельзя опубликовать: " + " ".join(issues))
    if row.published != row.draft or not row.active:
        if row.published != row.draft:
            row.revision += 1
            row.published = deepcopy(row.draft)
        row.active = True
        row.published_by_id = user.id
        row.published_at = datetime.now(UTC)
    await session.flush()
    return row


async def withdraw(session, user, scenario_id):
    row = await editor_row(session, user, scenario_id, lock=True)
    row.active = False
    await session.flush()
    return row


async def delete(session, user, scenario_id):
    row = await editor_row(session, user, scenario_id, lock=True)
    if row.published is not None:
        raise ConflictError("Опубликованный сценарий не удаляется: снимите его с публикации.")
    await session.delete(row)
    await session.flush()


def test_run(user, body):
    """A call played on the unsaved draft, with what would keep it from publication."""
    require_editor(user)
    content = body.content.model_dump()
    return {
        **simulate(content, body.answers),
        "problems": problems(content),
        "unreachable": unreachable(content),
    }


# Playing: the published scenarios operators of ТП and trainees can call.

def scenario_id(key):
    if not key.startswith(KEY_PREFIX) or not key[len(KEY_PREFIX):].isdigit():
        return None
    return int(key[len(KEY_PREFIX):])


async def playable(session):
    return list(
        await session.scalars(
            select(VoiceScenario)
            .where(VoiceScenario.active.is_(True), VoiceScenario.published.is_not(None))
            .order_by(VoiceScenario.id)
        )
    )


def catalog_item(row):
    content = row.published
    return {
        "key": f"{KEY_PREFIX}{row.id}",
        "title": content["title"],
        "description": content["description"],
        "minutes": content["minutes"],
        "languages": [{
            "key": content["language"],
            "label": "Қазақша" if content["language"] == "kk" else "Русский",
        }],
        "revision": row.revision,
        "custom": True,
    }


def snapshot(row):
    content = deepcopy(row.published)
    return {
        "custom": True,
        "scenario_id": row.id,
        "title": content["title"],
        "description": content["description"],
        "rules_source": f"Сценарий «{content['title']}», версия {row.revision}",
        "language": content["language"],
        "driver": {
            "name": content["driver"]["name"],
            "phone": content["driver"]["phone"],
            "park": content["driver"]["park"],
        },
        "incoming_phone": content["driver"]["phone"],
        "notes": content["notes"],
        "content": content,
    }
