from dataclasses import asdict, dataclass

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.developer import is_developer
from app.models.access import AccessPolicy, AccessRule
from app.models.enums import Role
from app.models.user import User


@dataclass(frozen=True)
class Section:
    code: str
    title: str
    description: str
    defaults: tuple[Role, ...]
    admin_only: bool = False


STAFF = (Role.SUPERVISOR, Role.HEAD, Role.ADMIN)
SECTIONS = (
    Section(
        "personal",
        "Личный кабинет и кошелёк",
        "Собственные показатели и коины; для управленческих ролей также личный прогресс",
        (Role.OPERATOR,),
    ),
    Section(
        "results",
        "Рейтинг и результаты",
        "Рейтинг команды; для оператора также личный прогресс, достижения и уровни",
        (Role.OPERATOR, *STAFF),
    ),
    Section(
        "training",
        "Прохождение обучения",
        "Личные тесты, миссии и симулятор",
        (Role.OPERATOR, Role.TRAINER),
    ),
    Section(
        "rewards",
        "Личные награды и покупки",
        "Магазин для себя, колесо и участие в розыгрышах",
        (Role.OPERATOR,),
    ),
    Section(
        "overview",
        "Управленческая сводка",
        "Показатели команды и ситуации, требующие внимания",
        STAFF,
    ),
    Section(
        "team",
        "Команда и структура",
        "Сотрудники, группы и карточки сотрудников",
        (*STAFF, Role.TRAINER),
    ),
    Section("analytics", "Аналитика", "Показатели, качество и сравнение команды", STAFF),
    Section(
        "performance",
        "Расчёт рабочих результатов",
        "Периоды, импорт, рабочие метрики и правила расчёта",
        STAFF,
    ),
    Section(
        "learning_admin",
        "Управление обучением",
        "Материалы, редакторы и результаты сотрудников",
        (*STAFF, Role.TRAINER),
    ),
    Section(
        "motivation",
        "Управление мотивацией",
        "Экономика команды, уровни, товары, заявки и настройка игр",
        STAFF,
    ),
    Section(
        "reports",
        "Отчёты и экспорт",
        "Сводные отчёты и выгрузка рабочих показателей",
        (Role.HEAD, Role.ADMIN),
    ),
    Section(
        "system",
        "Системное администрирование",
        "Полный журнал аудита действий пользователей",
        (Role.ADMIN,),
        True,
    ),
)
SECTION_BY_CODE = {item.code: item for item in SECTIONS}


def catalog():
    return [asdict(item) for item in SECTIONS]


def access_decisions(role, group_id, user_id, rules):
    """One resolver for live authorization and the read-only editor preview."""
    targets = [("all", "*"), ("role", str(role))]
    if group_id is not None:
        targets.append(("group", str(group_id)))
    targets.append(("user", str(user_id)))
    decisions = {}
    for section in SECTIONS:
        allowed, source = role in section.defaults, "default"
        for kind, key in targets:
            effect = rules.get((kind, key, section.code))
            if effect:
                allowed, source = effect == "allow", kind
        if section.admin_only and role != Role.ADMIN:
            allowed, source = False, "admin_only"
        if role == Role.TRAINER and section.code not in ("team", "training", "learning_admin"):
            allowed, source = False, "role_limit"
        decisions[section.code] = {"allowed": allowed, "source": source}
    return decisions


async def effective_access(session: AsyncSession, user: User):
    targets = [("all", "*"), ("role", str(user.role))]
    if user.group_id is not None:
        targets.append(("group", str(user.group_id)))
    targets.append(("user", str(user.id)))
    rules = list(
        await session.scalars(
            select(AccessRule).where(
                or_(
                    *(
                        and_(AccessRule.target_type == kind, AccessRule.target_id == key)
                        for kind, key in targets
                    )
                )
            )
        )
    )
    by_target = {(rule.target_type, rule.target_id, rule.section): rule.effect for rule in rules}
    decisions = access_decisions(user.role, user.group_id, user.id, by_target)
    return {
        "allowed": {key: item["allowed"] for key, item in decisions.items()},
        "capabilities": {"manage_sessions": is_developer(user)},
        "decisions": decisions,
        "revision": await session.scalar(select(AccessPolicy.revision).where(AccessPolicy.id == 1))
        or 0,
    }


def request_sections(path: str, method: str, role: Role | None = None) -> tuple[str, ...]:
    """Alternative section permissions for an endpoint; supporting reference reads are explicit."""
    read = method in ("GET", "HEAD")
    if path.startswith(("/admin/training", "/admin/learning-analytics")):
        return ("learning_admin",)
    if path.startswith(
        (
            "/auth/",
            "/admin/access",
            "/me/access",
            "/me/sessions",
            "/admin/sessions",
            "/me/notifications",
        )
    ):
        return ()
    if path.startswith("/lookups/"):
        return (
            "team",
            "analytics",
            "overview",
            "performance",
            "motivation",
            "learning_admin",
            "reports",
        )
    if path == "/rating/weeks":
        return ("results", "overview", "team", "analytics", "performance", "reports")
    if path.startswith("/rating"):
        return ("results",)
    if path.startswith("/analytics/me"):
        return ("personal", "results")
    if path == "/analytics/overview":
        return ("overview",)
    if path.startswith("/analytics"):
        return ("analytics",)
    if path.startswith("/admin/summary"):
        return ("overview",)
    if path.startswith("/admin/operators/export"):
        return ("reports",)
    if path.startswith(("/admin/users", "/admin/groups", "/admin/operators")):
        if read and path.endswith(("/transactions", "/purchases")):
            return ("motivation",)
        return ("team",)
    if path.startswith("/admin/weeks"):
        return ("performance",)
    if path.startswith(("/admin/learning", "/admin/learning-results")):
        return ("learning_admin",)
    if path.startswith("/learning"):
        return ("training",)
    if path.startswith("/admin/audit"):
        return ("system",)
    if path.startswith("/admin/config"):
        if path.startswith(("/admin/config/shop-items", "/admin/config/badges")):
            return ("motivation",)
        if read and path == "/admin/config/rules":
            return ("performance", "motivation")
        if read and path == "/admin/config/metrics":
            return ("performance", "motivation")
        return ("performance",)
    if path.startswith(
        ("/admin/wallet", "/admin/coins", "/admin/progress", "/admin/shop", "/admin/games")
    ):
        return ("motivation",)
    if path == "/games/wheel" and read:
        return ("rewards", "motivation")
    if path.startswith(("/shop", "/games", "/me/shop-requests")):
        return ("rewards",)
    if path in ("/me/balance", "/me/badges"):
        return ("personal", "rewards")
    if path.startswith("/me/progress"):
        if role == Role.OPERATOR:
            return ("personal", "results")
        return ("personal",)
    if path.startswith(("/me/dashboard", "/me/week", "/me/transactions", "/me/wallet")):
        return ("personal",)
    return ()


def trainer_path_allowed(path: str, method: str) -> bool:
    """A role ceiling remains in force even after an explicit section grant."""
    import re

    if path.startswith(("/auth/", "/me/notifications", "/learning/")) or path in (
        "/me/access",
        "/learning",
    ):
        return True
    if path == "/lookups/users":
        return method in ("GET", "HEAD")
    if path == "/admin/users":
        return method in ("GET", "HEAD", "POST")
    if re.fullmatch(r"/admin/users/\d+", path):
        return method in ("GET", "HEAD")
    if path in ("/admin/learning/driver-parks", "/admin/learning/driver-scenario"):
        return method in ("GET", "HEAD")
    return path.startswith(("/admin/learning", "/admin/training"))
