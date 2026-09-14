"""Read-only impact preview. Draft rules never enter the database."""

from collections import Counter

from sqlalchemy import select

from app.models.access import AccessRule
from app.models.enums import Role
from app.models.user import User
from app.services.access import SECTIONS, access_decisions

PRIORITY = {"default": -1, "all": 0, "role": 1, "group": 2, "user": 3, "admin_only": -1}


def switch_state(values):
    values = set(values)
    return "on" if values == {True} else "off" if values == {False} else "mixed"


async def preview_access(session, payload):
    rows = await session.scalars(select(AccessRule))
    before = {(r.target_type, r.target_id, r.section): r.effect for r in rows}
    after = dict(before)
    for target in payload.target_ids:
        for change in payload.changes:
            key = (payload.target_type, target, change.section)
            if change.effect == "inherit":
                after.pop(key, None)
            else:
                after[key] = change.effect
    query = select(User.role, User.group_id, User.id)
    if payload.target_type == "role":
        query = query.where(User.role.in_([Role(key) for key in payload.target_ids]))
    elif payload.target_type == "group":
        query = query.where(User.group_id.in_([int(key) for key in payload.target_ids]))
    elif payload.target_type == "user":
        query = query.where(User.id.in_([int(key) for key in payload.target_ids]))
    users = list(await session.execute(query))
    current = [access_decisions(*user, before) for user in users]
    future = [access_decisions(*user, after) for user in users]

    # A role switch describes that role's rule, even when an employee has an
    # overriding personal exception. The impact counts below still include it.
    level = PRIORITY[payload.target_type]
    own_rules = {key: value for key, value in after.items() if PRIORITY[key[0]] <= level}
    if payload.target_type == "role":
        subjects = [(Role(key), None, -1) for key in payload.target_ids]
    elif payload.target_type == "all":
        subjects = [(role, None, -1) for role in Role]
    else:
        subjects = list(users)
        if payload.target_type == "group":
            # Empty groups also inherit role defaults for future members.
            populated = {str(user.group_id) for user in users}
            subjects.extend(
                (role, int(key), -1)
                for key in payload.target_ids if key not in populated
                for role in Role
            )
    settings = [access_decisions(*subject, own_rules) for subject in subjects]
    original_rules = {key: value for key, value in before.items() if PRIORITY[key[0]] <= level}
    original_settings = [access_decisions(*subject, original_rules) for subject in subjects]
    sections = {}
    for section in SECTIONS:
        code = section.code
        effects = {
            after.get((payload.target_type, target, code), "inherit")
            for target in payload.target_ids
        }
        original = [
            before.get((payload.target_type, target, code)) for target in payload.target_ids
        ]
        sections[code] = {
            "state": switch_state(item[code]["allowed"] for item in settings),
            "before_state": switch_state(item[code]["allowed"] for item in original_settings),
            "effect": next(iter(effects)) if len(effects) == 1 else "mixed",
            "has_override": any(value != "inherit" for value in effects),
            "original_override": any(value is not None for value in original),
            "sources": dict(Counter(item[code]["source"] for item in settings)),
            "before_allowed": sum(item[code]["allowed"] for item in current),
            "after_allowed": sum(item[code]["allowed"] for item in future),
            "changed": sum(
                a[code]["allowed"] != b[code]["allowed"]
                for a, b in zip(current, future, strict=True)
            ),
            "exceptions": sum(PRIORITY[item[code]["source"]] > level for item in future),
            "locked": section.admin_only and all(subject[0] != Role.ADMIN for subject in subjects),
        }
    return {"revision": payload.revision, "total": len(users), "sections": sections}
