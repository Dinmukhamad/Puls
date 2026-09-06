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
        "Личный кабинет, XP и кошелёк",
        "Собственные рабочие показатели, опыт и коины участника",
        (Role.OPERATOR,),
    ),
    Section(
        "results",
        "Рейтинг и результаты",
        "Рейтинг команды и личная история места и баллов",
        tuple(Role),
    ),
    Section(
        "training", "Прохождение обучения", "Личные тесты, миссии и симулятор", (Role.OPERATOR,)
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
    Section("team", "Команда и структура", "Сотрудники, группы и карточки сотрудников", STAFF),
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
        STAFF,
    ),
    Section(
        "motivation",
        "Управление мотивацией",
        "Экономика команды, XP, товары, заявки и настройка игр",
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
    decisions = {}
    for section in SECTIONS:
        allowed, source = user.role in section.defaults, "default"
        for kind, key in targets:
            effect = by_target.get((kind, key, section.code))
            if effect:
                allowed, source = effect == "allow", kind
        if section.admin_only and user.role != Role.ADMIN:
            allowed, source = False, "admin_only"
        decisions[section.code] = {"allowed": allowed, "source": source}
    return {
        "allowed": {key: item["allowed"] for key, item in decisions.items()},
        "capabilities": {"manage_sessions": is_developer(user)},
        "decisions": decisions,
        "revision": await session.scalar(select(AccessPolicy.revision).where(AccessPolicy.id == 1))
        or 0,
    }


def request_sections(path: str, method: str) -> tuple[str, ...]:
    """Alternative section permissions for an endpoint; supporting reference reads are explicit."""
    read = method in ("GET", "HEAD")
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
        ("/admin/wallet", "/admin/coins", "/admin/xp", "/admin/shop", "/admin/games")
    ):
        return ("motivation",)
    if path == "/games/wheel" and read:
        return ("rewards", "motivation")
    if path.startswith(("/shop", "/games", "/me/shop-requests")):
        return ("rewards",)
    if path in ("/me/balance", "/me/badges"):
        return ("personal", "rewards")
    if path.startswith(("/me/dashboard", "/me/week", "/me/transactions", "/me/xp", "/me/wallet")):
        return ("personal",)
    return ()
