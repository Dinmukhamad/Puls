"""Настройки правил, показателей, номинаций, бейджей и магазина (п. 4.4.5)."""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.deps import HeadUser, SessionDep, StaffUser
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.badge import BadgeDefinition
from app.models.contest import MetricDefinition, NominationDefinition
from app.models.enums import BadgeRule, MetricKind
from app.models.shop import ShopItem
from app.models.user import User
from app.schemas.admin import (
    BadgeCreate,
    BadgeOut,
    BadgeUpdate,
    MetricCreate,
    MetricOut,
    MetricUpdate,
    NominationCreate,
    NominationOut,
    NominationUpdate,
    RulesOut,
    RulesUpdate,
)
from app.schemas.common import Message
from app.schemas.shop import ShopItemCreate, ShopItemOut, ShopItemUpdate
from app.services.rules import get_rules, write_audit

router = APIRouter(prefix="/admin/config", tags=["Настройки правил"])


async def _commit(session: SessionDep, entity: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(f"{entity}: нарушено ограничение уникальности") from exc


def _clean_changes(changes: dict[str, Any], nullable: tuple[str, ...] = ()) -> dict[str, Any]:
    for key, value in changes.items():
        if value is None and key not in nullable:
            raise DomainError("Обязательные поля не могут быть пустыми")
        if isinstance(value, float) and not math.isfinite(value):
            raise DomainError("Числовые значения должны быть конечными")
        if key in (
            "title",
            "code",
            "metric_code",
            "lateness_metric_code",
            "forbidden_sites_metric_code",
        ):
            if not isinstance(value, str) or not value.strip():
                raise DomainError("Заполните название и код")
            changes[key] = value.strip()
            if len(changes[key]) > (255 if key == "title" else 64):
                raise DomainError("Название или код слишком длинные")
    return changes


async def _save(
    session: SessionDep,
    actor: User,
    entity: Any,
    entity_type: str,
    changes: dict[str, Any],
    before: dict[str, Any] | None = None,
) -> None:
    # The entity and its audit record must commit atomically, including creates.
    try:
        await session.flush()
        if entity_type == "badge":
            from app.services.badges import reconcile_badge_definition

            await reconcile_badge_definition(session, entity)
        await write_audit(
            session,
            actor_id=actor.id,
            action=f"{entity_type}.{'create' if before is None else 'update'}",
            entity_type=entity_type,
            entity_id=entity.id,
            payload=jsonable_encoder({"before": before or {}, "after": changes}),
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Этот код уже используется. Выберите другой код.") from exc


async def _metric_exists(session: SessionDep, code: str, *, progress: bool = False) -> None:
    if progress and code == "__progress__":
        return
    if (
        await session.scalar(select(MetricDefinition.id).where(MetricDefinition.code == code))
        is None
    ):
        raise DomainError("Выбранный показатель не найден")


def _validate_metric(data: dict[str, Any]) -> None:
    if data["max_points"] < 0 or data["penalty_per_unit"] < 0 or data["target_value"] < 0:
        raise DomainError("Цель, баллы и штраф не могут быть отрицательными")
    if data["kind"] == MetricKind.POSITIVE and data["target_value"] <= 0:
        raise DomainError("У положительного показателя цель должна быть больше нуля")
    if data.get("unit") is not None and len(data["unit"]) > 32:
        raise DomainError("Единица измерения не должна превышать 32 символа")


async def _validate_badge(session: SessionDep, data: dict[str, Any]) -> None:
    if str(data.get("code", "")).startswith("level_"):
        raise DomainError("Коды level_ зарезервированы для достижений за уровни")
    params = data["rule_params"]
    rule = data["rule_type"]
    if rule in (
        BadgeRule.ZERO_METRIC_STREAK,
        BadgeRule.METRIC_THRESHOLD_STREAK,
        BadgeRule.METRIC_TOTAL,
    ):
        metric = params.get(
            "metric",
            {
                BadgeRule.ZERO_METRIC_STREAK: "lateness",
                BadgeRule.METRIC_THRESHOLD_STREAK: "quality",
            }.get(rule, "driver_gratitudes"),
        )
        if not isinstance(metric, str):
            raise DomainError("Выберите показатель для достижения")
        await _metric_exists(session, metric)
    if data.get("coins_reward", 0) and rule in (
        BadgeRule.TOTAL_EARNED,
        BadgeRule.TOP_RANK,
        BadgeRule.NOMINATION_COUNT,
    ):
        raise DomainError(
            "За этот результат коины уже начисляются. Дополнительная награда недоступна."
        )
    keys = {
        BadgeRule.TOP_RANK: ("max_rank",),
        BadgeRule.ZERO_METRIC_STREAK: ("weeks",),
        BadgeRule.METRIC_THRESHOLD_STREAK: ("weeks", "gte"),
        BadgeRule.METRIC_TOTAL: ("gte",),
        BadgeRule.TOTAL_EARNED: ("gte",),
        BadgeRule.NOMINATION_COUNT: ("gte",),
        BadgeRule.LEARNING_COUNT: ("gte",),
    }[rule]
    for key in keys:
        if key not in params:
            continue  # Existing documented service defaults remain supported.
        value = params[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
        ):
            raise DomainError("Порог достижения должен быть числом")
        if value <= 0 or (
            (key in ("weeks", "max_rank") or rule == BadgeRule.LEARNING_COUNT)
            and int(value) != value
        ):
            raise DomainError("Количество недель, место и порог должны быть положительными")


# --------------------------------------------------------------------------- #
# Правила начисления
# --------------------------------------------------------------------------- #


@router.get("/rules", response_model=RulesOut, summary="Текущие правила начисления")
async def read_rules(session: SessionDep, _: StaffUser) -> RulesOut:
    return RulesOut.model_validate(await get_rules(session))


@router.put("/rules", response_model=RulesOut, summary="Изменить правила начисления")
async def update_rules(session: SessionDep, actor: HeadUser, payload: RulesUpdate) -> RulesOut:
    """
    Меняет курс перевода и размеры бонусов.

    Новые значения применяются к следующим расчётам; уже закрытые недели
    пересчёту не подлежат - их правила сохранены в снимке недели.
    """
    rules = await get_rules(session)
    changes = _clean_changes(payload.model_dump(exclude_unset=True))
    if changes.get("manual_reason_min_length", 0) > 500:
        raise DomainError("Минимальная длина комментария не может превышать 500 символов")
    for key in ("lateness_metric_code", "forbidden_sites_metric_code"):
        if key in changes:
            await _metric_exists(session, changes[key])
    before = {field: getattr(rules, field) for field in changes}
    for field, value in changes.items():
        setattr(rules, field, value)
    rules.updated_by_id = actor.id

    await write_audit(
        session,
        actor_id=actor.id,
        action="rules.update",
        entity_type="gamification_settings",
        entity_id=rules.id,
        payload={"before": before, "after": changes},
    )
    await session.commit()
    return RulesOut.model_validate(rules)


# --------------------------------------------------------------------------- #
# Показатели конкурса
# --------------------------------------------------------------------------- #


@router.get("/metrics", response_model=list[MetricOut], summary="Показатели конкурса")
async def list_metrics(
    session: SessionDep, _: StaffUser, include_inactive: bool = True
) -> list[MetricDefinition]:
    stmt = select(MetricDefinition).order_by(MetricDefinition.sort_order, MetricDefinition.id)
    if not include_inactive:
        stmt = stmt.where(MetricDefinition.is_active.is_(True))
    return list(await session.scalars(stmt))


@router.post(
    "/metrics",
    response_model=MetricOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить показатель",
)
async def create_metric(
    session: SessionDep, actor: HeadUser, payload: MetricCreate
) -> MetricDefinition:
    data = _clean_changes(payload.model_dump(), ("unit", "description"))
    _validate_metric(data)
    metric = MetricDefinition(**data)
    session.add(metric)
    await _save(session, actor, metric, "metric", data)
    return metric


@router.patch("/metrics/{metric_id}", response_model=MetricOut, summary="Изменить показатель")
async def update_metric(
    session: SessionDep, actor: HeadUser, metric_id: int, payload: MetricUpdate
) -> MetricDefinition:
    metric = await session.get(MetricDefinition, metric_id)
    if metric is None:
        raise NotFoundError(f"Показатель id={metric_id} не найден")
    changes = _clean_changes(payload.model_dump(exclude_unset=True), ("unit", "description"))
    _validate_metric({**MetricOut.model_validate(metric).model_dump(), **changes})
    before = {field: getattr(metric, field) for field in changes}
    for field, value in changes.items():
        setattr(metric, field, value)
    await _save(session, actor, metric, "metric", changes, before)
    return metric


# --------------------------------------------------------------------------- #
# Номинации
# --------------------------------------------------------------------------- #


@router.get("/nominations", response_model=list[NominationOut], summary="Номинации")
async def list_nominations(session: SessionDep, _: StaffUser) -> list[NominationDefinition]:
    return list(
        await session.scalars(
            select(NominationDefinition).order_by(
                NominationDefinition.sort_order, NominationDefinition.id
            )
        )
    )


@router.post(
    "/nominations",
    response_model=NominationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить номинацию",
)
async def create_nomination(
    session: SessionDep, actor: HeadUser, payload: NominationCreate
) -> NominationDefinition:
    data = _clean_changes(payload.model_dump(), ("description", "min_value"))
    await _metric_exists(session, data["metric_code"], progress=True)
    nomination = NominationDefinition(**data)
    session.add(nomination)
    await _save(session, actor, nomination, "nomination", data)
    return nomination


@router.patch(
    "/nominations/{nomination_id}",
    response_model=NominationOut,
    summary="Изменить номинацию",
)
async def update_nomination(
    session: SessionDep, actor: HeadUser, nomination_id: int, payload: NominationUpdate
) -> NominationDefinition:
    nomination = await session.get(NominationDefinition, nomination_id)
    if nomination is None:
        raise NotFoundError(f"Номинация id={nomination_id} не найдена")
    changes = _clean_changes(payload.model_dump(exclude_unset=True), ("description", "min_value"))
    if "metric_code" in changes:
        await _metric_exists(session, changes["metric_code"], progress=True)
    before = {field: getattr(nomination, field) for field in changes}
    for field, value in changes.items():
        setattr(nomination, field, value)
    await _save(session, actor, nomination, "nomination", changes, before)
    return nomination


# --------------------------------------------------------------------------- #
# Бейджи
# --------------------------------------------------------------------------- #


@router.get("/badges", response_model=list[BadgeOut], summary="Бейджи")
async def list_badges(session: SessionDep, _: StaffUser) -> list[BadgeDefinition]:
    return list(
        await session.scalars(
            select(BadgeDefinition).order_by(BadgeDefinition.sort_order, BadgeDefinition.id)
        )
    )


@router.post(
    "/badges",
    response_model=BadgeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить бейдж",
)
async def create_badge(
    session: SessionDep, actor: HeadUser, payload: BadgeCreate
) -> BadgeDefinition:
    data = _clean_changes(payload.model_dump(), ("description", "icon"))
    await _validate_badge(session, data)
    badge = BadgeDefinition(**data)
    session.add(badge)
    await _save(session, actor, badge, "badge", data)
    return badge


@router.patch("/badges/{badge_id}", response_model=BadgeOut, summary="Изменить бейдж")
async def update_badge(
    session: SessionDep, actor: HeadUser, badge_id: int, payload: BadgeUpdate
) -> BadgeDefinition:
    badge = await session.get(BadgeDefinition, badge_id)
    if badge is None:
        raise NotFoundError(f"Бейдж id={badge_id} не найден")
    changes = _clean_changes(payload.model_dump(exclude_unset=True), ("description", "icon"))
    await _validate_badge(session, {**BadgeOut.model_validate(badge).model_dump(), **changes})
    before = {field: getattr(badge, field) for field in changes}
    for field, value in changes.items():
        setattr(badge, field, value)
    await _save(session, actor, badge, "badge", changes, before)
    return badge


# --------------------------------------------------------------------------- #
# Магазин
# --------------------------------------------------------------------------- #


@router.get("/shop-items", response_model=list[ShopItemOut], summary="Каталог магазина")
async def list_shop_items(session: SessionDep, _: StaffUser) -> list[ShopItem]:
    return list(
        await session.scalars(select(ShopItem).order_by(ShopItem.sort_order, ShopItem.price))
    )


@router.post(
    "/shop-items",
    response_model=ShopItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить бонус в магазин",
)
async def create_shop_item(
    session: SessionDep, actor: HeadUser, payload: ShopItemCreate
) -> ShopItem:
    data = _clean_changes(
        payload.model_dump(), ("description", "stock_limit", "per_user_monthly_limit")
    )
    item = ShopItem(**data)
    session.add(item)
    await _save(session, actor, item, "shop_item", data)
    return item


@router.patch("/shop-items/{item_id}", response_model=ShopItemOut, summary="Изменить бонус")
async def update_shop_item(
    session: SessionDep, actor: HeadUser, item_id: int, payload: ShopItemUpdate
) -> ShopItem:
    """
    Меняет цену, лимит или отключает бонус.

    Цена уже поданных заявок не меняется: она зафиксирована в момент подачи.
    """
    item = await session.get(ShopItem, item_id)
    if item is None:
        raise NotFoundError(f"Бонус id={item_id} не найден")
    changes = _clean_changes(
        payload.model_dump(exclude_unset=True),
        ("description", "stock_limit", "per_user_monthly_limit"),
    )
    before = {field: getattr(item, field) for field in changes}
    for field, value in changes.items():
        setattr(item, field, value)
    await _save(session, actor, item, "shop_item", changes, before)
    return item


@router.delete("/shop-items/{item_id}", response_model=Message, summary="Отключить бонус")
async def disable_shop_item(session: SessionDep, actor: HeadUser, item_id: int) -> Message:
    """
    Позиция не удаляется физически: на неё ссылаются уже поданные заявки.
    Вместо удаления бонус скрывается из каталога.
    """
    item = await session.get(ShopItem, item_id)
    if item is None:
        raise NotFoundError(f"Бонус id={item_id} не найден")
    item.is_active = False
    await write_audit(
        session,
        actor_id=actor.id,
        action="shop_item.disable",
        entity_type="shop_item",
        entity_id=item.id,
    )
    await session.commit()
    return Message(detail=f"Бонус «{item.title}» отключён")
