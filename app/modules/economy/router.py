"""API экономики коинов (ТЗ §13).

Операторский контур:
  GET /economy/me            — баланс, сезон, заработок недели, ближайшая цель
  GET /economy/transactions  — история операций текущего оператора

Административный контур (/admin/economy/*): сезоны, правила наград,
сезонные цены, preview изменения цен. Все изменения пишутся в AuditLog
с before/after (ТЗ §15: «Все административные операции логируются»).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import (
    AuditLog,
    CoinTransaction,
    EconomySeason,
    RewardRule,
    ShopItem,
    ShopItemPrice,
    User,
    now_utc,
)
from app.modules.economy.schemas import (
    InventoryUpsert,
    ItemPriceRead,
    ItemPriceUpsert,
    RewardRuleCreate,
    RewardRuleRead,
    RewardRuleUpdate,
    SeasonCreate,
    SeasonRead,
    SeasonUpdate,
)
from app.modules.economy.service import (
    economy_me,
    effective_item_pricing,
    get_active_season,
)
from app.modules.wallet.service import operator_for_user_or_403

router = APIRouter(prefix="/economy", tags=["economy"])
admin_router = APIRouter(
    prefix="/admin/economy",
    tags=["economy-admin"],
    dependencies=[Depends(require_roles("manager", "admin"))],
)


def _audit(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    entity_id: int,
    before: dict | None,
    after: dict | None,
) -> None:
    db.add(
        AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=json.dumps(
                {"before": before, "after": after}, ensure_ascii=False, default=str
            ),
            performed_by_user_id=user.id,
        )
    )


def _season_snapshot(season: EconomySeason) -> dict:
    return {
        "code": season.code,
        "name": season.name,
        "status": season.status,
        "starts_at": season.starts_at,
        "ends_at": season.ends_at,
        "notification_at": season.notification_at,
        "version": season.version,
    }


def _rule_snapshot(rule: RewardRule) -> dict:
    return {
        "season_id": rule.season_id,
        "source_type": rule.source_type,
        "source_code": rule.source_code,
        "amount": rule.amount,
        "threshold": rule.threshold,
        "period": rule.period,
        "period_limit": rule.period_limit,
        "active": rule.active,
        "version": rule.version,
    }


# ---------------------------------------------------------------------------
# Операторский контур
# ---------------------------------------------------------------------------

@router.get("/me")
def my_economy(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    return economy_me(db, operator)


@router.get("/transactions")
def my_transactions(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    rows = list(
        db.scalars(
            select(CoinTransaction)
            .where(CoinTransaction.operator_id == operator.id)
            .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return {
        "items": [
            {
                "id": tx.id,
                "amount": tx.amount,
                "type": tx.type,
                "comment": tx.comment,
                "source_type": tx.source_type,
                "created_at": tx.created_at,
            }
            for tx in rows
        ],
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# Админ: сезоны
# ---------------------------------------------------------------------------

@admin_router.get("/seasons", response_model=list[SeasonRead])
def list_seasons(db: Session = Depends(get_db)) -> list[EconomySeason]:
    return list(db.scalars(select(EconomySeason).order_by(EconomySeason.starts_at.desc())))


@admin_router.post("/seasons", response_model=SeasonRead)
def create_season(
    payload: SeasonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EconomySeason:
    if payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="ends_at должен быть позже starts_at")
    exists = db.scalar(select(EconomySeason).where(EconomySeason.code == payload.code))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Код сезона уже занят")
    season = EconomySeason(
        **payload.model_dump(),
        created_by_user_id=current_user.id,
    )
    db.add(season)
    db.flush()
    _audit(db, current_user, "economy_season_create", "economy_season", season.id,
           None, _season_snapshot(season))
    db.commit()
    db.refresh(season)
    return season


@admin_router.patch("/seasons/{season_id}", response_model=SeasonRead)
def update_season(
    season_id: int,
    payload: SeasonUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EconomySeason:
    season = db.get(EconomySeason, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден")
    before = _season_snapshot(season)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(season, key, value)
    if season.ends_at and season.ends_at <= season.starts_at:
        raise HTTPException(status_code=422, detail="ends_at должен быть позже starts_at")
    # Версионирование (ТЗ §11): любое изменение — новая версия; старые
    # транзакции и заказы хранят свои снапшоты и не пересчитываются.
    season.version += 1
    season.updated_at = now_utc()
    _audit(db, current_user, "economy_season_update", "economy_season", season.id,
           before, _season_snapshot(season))
    db.commit()
    db.refresh(season)
    return season


@admin_router.get("/seasons/{season_id}/preview")
def season_price_preview(
    season_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Preview изменения цен (ТЗ §7.2): по каждому активному товару —
    сезонная цена, обычная цена и дельта перехода."""
    season = db.get(EconomySeason, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден")
    items = list(db.scalars(select(ShopItem).where(ShopItem.is_active.is_(True))))
    rows = []
    for item in items:
        pricing = effective_item_pricing(db, item, season, _season_resolved=True)
        rows.append(
            {
                "shop_item_id": item.id,
                "title": item.title,
                "season_price": pricing["price"],
                "regular_price": pricing["regular_price"],
                "is_seasonal_price": pricing["is_seasonal_price"],
                "delta_after_season": pricing["regular_price"] - pricing["price"],
            }
        )
    return {"season": SeasonRead.model_validate(season).model_dump(), "items": rows}


# ---------------------------------------------------------------------------
# Админ: правила наград
# ---------------------------------------------------------------------------

@admin_router.get("/rules", response_model=list[RewardRuleRead])
def list_rules(
    source_type: str | None = None,
    season_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[RewardRule]:
    query = select(RewardRule).order_by(RewardRule.source_type, RewardRule.source_code)
    if source_type:
        query = query.where(RewardRule.source_type == source_type)
    if season_id is not None:
        query = query.where(RewardRule.season_id == season_id)
    return list(db.scalars(query))


@admin_router.post("/rules", response_model=RewardRuleRead)
def create_rule(
    payload: RewardRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardRule:
    if payload.season_id is not None and not db.get(EconomySeason, payload.season_id):
        raise HTTPException(status_code=404, detail="Сезон не найден")
    rule = RewardRule(**payload.model_dump(), updated_by_user_id=current_user.id)
    db.add(rule)
    db.flush()
    _audit(db, current_user, "reward_rule_create", "reward_rule", rule.id,
           None, _rule_snapshot(rule))
    db.commit()
    db.refresh(rule)
    return rule


@admin_router.patch("/rules/{rule_id}", response_model=RewardRuleRead)
def update_rule(
    rule_id: int,
    payload: RewardRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardRule:
    rule = db.get(RewardRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Правило не найдено")
    before = _rule_snapshot(rule)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    rule.version += 1
    rule.updated_at = now_utc()
    rule.updated_by_user_id = current_user.id
    _audit(db, current_user, "reward_rule_update", "reward_rule", rule.id,
           before, _rule_snapshot(rule))
    db.commit()
    db.refresh(rule)
    return rule


# ---------------------------------------------------------------------------
# Админ: сезонные цены
# ---------------------------------------------------------------------------

@admin_router.get("/item-prices", response_model=list[ItemPriceRead])
def list_item_prices(
    season_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[ShopItemPrice]:
    query = select(ShopItemPrice).order_by(ShopItemPrice.shop_item_id)
    if season_id is not None:
        query = query.where(ShopItemPrice.season_id == season_id)
    return list(db.scalars(query))


@admin_router.post("/item-prices", response_model=ItemPriceRead)
def upsert_item_price(
    payload: ItemPriceUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopItemPrice:
    if not db.get(ShopItem, payload.shop_item_id):
        raise HTTPException(status_code=404, detail="Товар не найден")
    if not db.get(EconomySeason, payload.season_id):
        raise HTTPException(status_code=404, detail="Сезон не найден")
    price = db.scalar(
        select(ShopItemPrice).where(
            ShopItemPrice.shop_item_id == payload.shop_item_id,
            ShopItemPrice.season_id == payload.season_id,
        )
    )
    if price:
        before = {"coin_price": price.coin_price, "active": price.active, "version": price.version}
        price.coin_price = payload.coin_price
        price.active = payload.active
        price.version += 1
        price.updated_at = now_utc()
        _audit(db, current_user, "shop_item_price_update", "shop_item_price", price.id,
               before, {"coin_price": price.coin_price, "active": price.active,
                        "version": price.version})
    else:
        price = ShopItemPrice(**payload.model_dump())
        db.add(price)
        db.flush()
        _audit(db, current_user, "shop_item_price_create", "shop_item_price", price.id,
               None, {"coin_price": price.coin_price, "active": price.active, "version": 1})
    db.commit()
    db.refresh(price)
    return price


@admin_router.get("/active-season")
def active_season(db: Session = Depends(get_db)) -> dict:
    season = get_active_season(db)
    return {"season": SeasonRead.model_validate(season).model_dump() if season else None}


# ---------------------------------------------------------------------------
# Админ: складской учёт призов (ТЗ §12.1 prize_inventory, §10.3)
# ---------------------------------------------------------------------------

@admin_router.get("/inventory")
def list_inventory(db: Session = Depends(get_db)) -> list[dict]:
    from app.models.entities import ShopItemInventory

    rows = list(
        db.scalars(
            select(ShopItemInventory).order_by(ShopItemInventory.shop_item_id)
        )
    )
    return [
        {
            "id": inv.id,
            "shop_item_id": inv.shop_item_id,
            "shop_item_title": inv.shop_item.title if inv.shop_item else None,
            "quantity_received": inv.quantity_received,
            "quantity_reserved": inv.quantity_reserved,
            "quantity_issued": inv.quantity_issued,
            "quantity_returned": inv.quantity_returned,
            "available": inv.available,
            "min_stock_alert": inv.min_stock_alert,
            # Флаг «пора пополнить склад» (ТЗ §10.3: уведомление о низком остатке)
            "low_stock": bool(inv.min_stock_alert > 0 and inv.available <= inv.min_stock_alert),
        }
        for inv in rows
    ]


@admin_router.post("/inventory")
def upsert_inventory(
    payload: InventoryUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Приход на склад / настройка порога. quantity_received только растёт
    (add_received добавляет к приходу) — историю приходов не переписываем."""
    from app.models.entities import ShopItemInventory

    if not db.get(ShopItem, payload.shop_item_id):
        raise HTTPException(status_code=404, detail="Товар не найден")
    inv = db.scalar(
        select(ShopItemInventory)
        .where(ShopItemInventory.shop_item_id == payload.shop_item_id)
        .with_for_update()
    )
    if inv is None:
        inv = ShopItemInventory(shop_item_id=payload.shop_item_id)
        db.add(inv)
        db.flush()
        before = None
    else:
        before = {
            "quantity_received": inv.quantity_received,
            "min_stock_alert": inv.min_stock_alert,
        }
    if payload.add_received:
        inv.quantity_received += payload.add_received
    if payload.min_stock_alert is not None:
        inv.min_stock_alert = payload.min_stock_alert
    inv.updated_at = now_utc()
    _audit(db, current_user, "shop_inventory_upsert", "shop_item_inventory", inv.id,
           before, {"quantity_received": inv.quantity_received,
                    "min_stock_alert": inv.min_stock_alert})
    db.commit()
    db.refresh(inv)
    return {
        "id": inv.id,
        "shop_item_id": inv.shop_item_id,
        "quantity_received": inv.quantity_received,
        "available": inv.available,
        "min_stock_alert": inv.min_stock_alert,
    }


@admin_router.post("/orders/expire")
def expire_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Ручной запуск автоистечения заказов (ТЗ §12.1 expired). Та же логика
    выполняется ежедневной cron-задачей; эндпоинт — для админки и отладки."""
    from app.modules.wallet.service import expire_stale_purchases

    result = expire_stale_purchases(db)
    _audit(db, current_user, "orders_expire_run", "shop_purchase", 0, None, result)
    db.commit()
    return result
