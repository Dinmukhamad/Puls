"""Настройки правил, показателей, номинаций, бейджей и магазина (п. 4.4.5)."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.deps import HeadUser, SessionDep, StaffUser
from app.core.errors import ConflictError, NotFoundError
from app.models.badge import BadgeDefinition
from app.models.contest import MetricDefinition, NominationDefinition
from app.models.level import LevelDefinition
from app.models.shop import ShopItem
from app.schemas.admin import (
    BadgeCreate,
    BadgeOut,
    BadgeUpdate,
    LevelCreate,
    LevelOut,
    LevelUpdate,
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


# --------------------------------------------------------------------------- #
# Правила начисления
# --------------------------------------------------------------------------- #


@router.get("/rules", response_model=RulesOut, summary="Текущие правила начисления")
async def read_rules(session: SessionDep, _: StaffUser) -> RulesOut:
    return RulesOut.model_validate(await get_rules(session))


@router.put("/rules", response_model=RulesOut, summary="Изменить правила начисления")
async def update_rules(
    session: SessionDep, actor: HeadUser, payload: RulesUpdate
) -> RulesOut:
    """
    Меняет курс перевода и размеры бонусов.

    Новые значения применяются к следующим расчётам; уже закрытые недели
    пересчёту не подлежат - их правила сохранены в снимке недели.
    """
    rules = await get_rules(session)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(rules, field, value)
    rules.updated_by_id = actor.id

    await write_audit(
        session,
        actor_id=actor.id,
        action="rules.update",
        entity_type="gamification_settings",
        entity_id=rules.id,
        payload=changes,
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
    stmt = select(MetricDefinition).order_by(
        MetricDefinition.sort_order, MetricDefinition.id
    )
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
    metric = MetricDefinition(**payload.model_dump())
    session.add(metric)
    await _commit(session, "Показатель")
    return metric


@router.patch("/metrics/{metric_id}", response_model=MetricOut, summary="Изменить показатель")
async def update_metric(
    session: SessionDep, actor: HeadUser, metric_id: int, payload: MetricUpdate
) -> MetricDefinition:
    metric = await session.get(MetricDefinition, metric_id)
    if metric is None:
        raise NotFoundError(f"Показатель id={metric_id} не найден")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(metric, field, value)
    await _commit(session, "Показатель")
    return metric


# --------------------------------------------------------------------------- #
# Номинации
# --------------------------------------------------------------------------- #


@router.get("/nominations", response_model=list[NominationOut], summary="Номинации")
async def list_nominations(
    session: SessionDep, _: StaffUser
) -> list[NominationDefinition]:
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
    nomination = NominationDefinition(**payload.model_dump())
    session.add(nomination)
    await _commit(session, "Номинация")
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
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(nomination, field, value)
    await _commit(session, "Номинация")
    return nomination


# --------------------------------------------------------------------------- #
# Бейджи
# --------------------------------------------------------------------------- #


@router.get("/badges", response_model=list[BadgeOut], summary="Бейджи")
async def list_badges(session: SessionDep, _: StaffUser) -> list[BadgeDefinition]:
    return list(
        await session.scalars(
            select(BadgeDefinition).order_by(
                BadgeDefinition.sort_order, BadgeDefinition.id
            )
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
    badge = BadgeDefinition(**payload.model_dump())
    session.add(badge)
    await _commit(session, "Бейдж")
    return badge


@router.patch("/badges/{badge_id}", response_model=BadgeOut, summary="Изменить бейдж")
async def update_badge(
    session: SessionDep, actor: HeadUser, badge_id: int, payload: BadgeUpdate
) -> BadgeDefinition:
    badge = await session.get(BadgeDefinition, badge_id)
    if badge is None:
        raise NotFoundError(f"Бейдж id={badge_id} не найден")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(badge, field, value)
    await _commit(session, "Бейдж")
    return badge


# --------------------------------------------------------------------------- #
# Уровни (п. 6.2 ТЗ)
# --------------------------------------------------------------------------- #


@router.get("/levels", response_model=list[LevelOut], summary="Ступени прогресса")
async def list_levels(session: SessionDep, _: StaffUser) -> list[LevelDefinition]:
    return list(
        await session.scalars(
            select(LevelDefinition).order_by(LevelDefinition.min_earned, LevelDefinition.id)
        )
    )


@router.post(
    "/levels",
    response_model=LevelOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить ступень",
)
async def create_level(
    session: SessionDep, actor: HeadUser, payload: LevelCreate
) -> LevelDefinition:
    level = LevelDefinition(**payload.model_dump())
    session.add(level)
    await _commit(session, "Ступень")
    await write_audit(
        session,
        actor_id=actor.id,
        action="level.create",
        entity_type="level",
        entity_id=level.id,
        payload={"code": level.code, "min_earned": level.min_earned},
    )
    await session.commit()
    return level


@router.patch("/levels/{level_id}", response_model=LevelOut, summary="Изменить ступень")
async def update_level(
    session: SessionDep, actor: HeadUser, level_id: int, payload: LevelUpdate
) -> LevelDefinition:
    """
    Меняет порог или название ступени.

    Уровень нигде не хранится: он вычисляется от накопленной суммы при каждом
    запросе, поэтому новый порог применяется сразу ко всем операторам.
    """
    level = await session.get(LevelDefinition, level_id)
    if level is None:
        raise NotFoundError(f"Ступень id={level_id} не найдена")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(level, field, value)
    await write_audit(
        session,
        actor_id=actor.id,
        action="level.update",
        entity_type="level",
        entity_id=level.id,
        payload=changes,
    )
    await _commit(session, "Ступень")
    return level


# --------------------------------------------------------------------------- #
# Магазин
# --------------------------------------------------------------------------- #


@router.get("/shop-items", response_model=list[ShopItemOut], summary="Каталог магазина")
async def list_shop_items(session: SessionDep, _: StaffUser) -> list[ShopItem]:
    return list(
        await session.scalars(
            select(ShopItem).order_by(ShopItem.sort_order, ShopItem.price)
        )
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
    item = ShopItem(**payload.model_dump())
    session.add(item)
    await _commit(session, "Бонус")
    await write_audit(
        session,
        actor_id=actor.id,
        action="shop_item.create",
        entity_type="shop_item",
        entity_id=item.id,
        payload={"code": item.code, "price": item.price},
    )
    await session.commit()
    return item


@router.patch(
    "/shop-items/{item_id}", response_model=ShopItemOut, summary="Изменить бонус"
)
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
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(item, field, value)
    await write_audit(
        session,
        actor_id=actor.id,
        action="shop_item.update",
        entity_type="shop_item",
        entity_id=item.id,
        payload=changes,
    )
    await _commit(session, "Бонус")
    return item


@router.delete(
    "/shop-items/{item_id}", response_model=Message, summary="Отключить бонус"
)
async def disable_shop_item(
    session: SessionDep, actor: HeadUser, item_id: int
) -> Message:
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
