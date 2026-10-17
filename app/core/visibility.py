"""Identity visibility for secondary response fields, beyond user directories."""

import re

from app.models.enums import USER_VISIBILITY, Role
from app.models.user import User

#: A patronymic ends like this: «Кайратовна», «Болатович», «Асхатулы»; Turkic two-word forms
#: («Нурлан улы») are joined first.
_PATRONYMIC = re.compile(r"(вич|вна|ична|улы|ұлы|кызы|қызы|оглы)$")
_TURKIC_PARTICLES = {"улы", "ұлы", "кызы", "қызы", "оглы"}


def identity_filter(viewer, entity=User):
    return (entity.id == viewer.id) | entity.role.in_(USER_VISIBILITY[Role(viewer.role)])


def can_identify(viewer, target):
    return target is not None and (
        target.id == viewer.id or target.role in USER_VISIBILITY[Role(viewer.role)]
    )


def shop_request_output(request, viewer):
    from app.schemas.shop import ShopRequestOut

    data = ShopRequestOut.model_validate(request)
    for field in ("user", "decided_by"):
        if not can_identify(viewer, getattr(request, field)):
            setattr(data, field, None)
    return data


def short_name(full_name: str) -> str:
    """«Имя Ф.» from «Имя Отчество Фамилия» or «Фамилия Имя Отчество» (the patronymic tells)."""
    words = full_name.split()
    if len(words) < 2:
        return full_name.strip()
    for index, word in enumerate(words):
        if index and word.lower() in _TURKIC_PARTICLES:
            words = words[: index - 1] + [f"{words[index - 1]} {word}"] + words[index + 1:]
            break
    if len(words) < 2:
        return words[0]
    patronymic = next(
        (i for i, word in enumerate(words) if _PATRONYMIC.search(word.split()[-1].lower())), None
    )
    if len(words) >= 3 and patronymic == len(words) - 1:
        first, last = words[1], words[0]          # Фамилия Имя Отчество
    else:
        first, last = words[0], words[-1]         # Имя Отчество Фамилия, Имя Фамилия
    return f"{first} {last[0]}."


def ranking_name(viewer, target) -> str | None:
    """
    The name a ranking shows: in full to whoever may identify the person; to an operator, the other
    operators appear as «Имя Ф.» so they can see whom they race; anyone else stays unnamed.
    """
    if target is None:
        return None
    if can_identify(viewer, target):
        return target.full_name
    if Role(viewer.role) == Role.OPERATOR and Role(target.role) == Role.OPERATOR:
        return short_name(target.full_name)
    return None
