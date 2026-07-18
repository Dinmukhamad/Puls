from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import AuditLog, Operator, ShopDiscountCoupon, ShopItem, ShopPurchase, User
from app.modules.economy.schemas import InventoryUpsert
from app.modules.rating.service import rating_cache_invalidate
from app.modules.shop.schemas import (
    PurchaseCreate,
    RejectPurchaseRequest,
    ShopDiscountCouponRead,
    ShopItemCreate,
    ShopItemRead,
    ShopItemUpdate,
    ShopPurchaseRead,
)
from app.modules.wallet.service import (
    approve_purchase,
    complete_purchase,
    create_purchase,
    operator_for_user_or_403,
    reject_purchase,
    shop_item_availability,
    sync_shop_discount_coupons,
)

router = APIRouter(prefix="/shop", tags=["shop"])
store_router = APIRouter(prefix="/store", tags=["store"])
admin_store_router = APIRouter(
    prefix="/admin/store",
    tags=["store-admin"],
    dependencies=[Depends(require_roles("manager", "admin"))],
)


def _item_snapshot(item: ShopItem) -> dict:
    return {
        "code": item.code,
        "title": item.title,
        "category": item.category,
        "prize_type": item.prize_type,
        "price": item.price,
        "is_active": item.is_active,
        "issue_days": item.issue_days,
        "stock_limit": item.stock_limit,
        "purchase_limit_per_operator": item.purchase_limit_per_operator,
    }


def _audit_item(
    db: Session,
    user: User,
    action: str,
    item: ShopItem,
    before: dict | None,
) -> None:
    db.add(
        AuditLog(
            action=action,
            entity_type="shop_item",
            entity_id=item.id,
            details=json.dumps(
                {"before": before, "after": _item_snapshot(item)},
                ensure_ascii=False,
                default=str,
            ),
            performed_by_user_id=user.id,
        )
    )


def _catalog_rows(
    db: Session,
    current_user: User,
    *,
    include_inactive: bool = False,
) -> list[dict]:
    from app.modules.economy.service import effective_item_pricing, get_active_season

    query = select(ShopItem)
    if not include_inactive:
        query = query.where(ShopItem.is_active.is_(True))
    items = list(db.scalars(query.order_by(ShopItem.price.asc(), ShopItem.id.asc())))
    operator_id = current_user.operator_id if current_user.role == "operator" else None
    active_season = get_active_season(db)
    result = []
    for item in items:
        row = ShopItemRead.model_validate(item).model_dump()
        row.update(shop_item_availability(db, item, operator_id))
        pricing = effective_item_pricing(db, item, active_season, _season_resolved=True)
        row.update(
            effective_price=pricing["price"],
            regular_price=pricing["regular_price"],
            is_seasonal_price=pricing["is_seasonal_price"],
            season_id=pricing["season_id"],
            season_code=pricing["season_code"],
            season_name=pricing["season_name"],
            season_ends_at=pricing["season_ends_at"],
        )
        result.append(row)
    return result


def _validate_item_code(db: Session, code: str | None, *, item_id: int | None = None) -> None:
    if not code:
        return
    existing = db.scalar(select(ShopItem).where(ShopItem.code == code))
    if existing is not None and existing.id != item_id:
        raise HTTPException(status_code=409, detail="Код приза уже используется")


def _create_item(
    db: Session,
    current_user: User,
    payload: ShopItemCreate,
) -> ShopItem:
    _validate_item_code(db, payload.code)
    if payload.ends_at and payload.starts_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="ends_at должен быть позже starts_at")
    item = ShopItem(**payload.model_dump())
    db.add(item)
    db.flush()
    _audit_item(db, current_user, "shop_item_create", item, None)
    db.commit()
    db.refresh(item)
    return item


def _update_item(
    db: Session,
    current_user: User,
    item_id: int,
    payload: ShopItemUpdate,
) -> ShopItem:
    item = db.get(ShopItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Бонус не найден")
    before = _item_snapshot(item)
    changes = payload.model_dump(exclude_unset=True)
    if "code" in changes:
        _validate_item_code(db, changes["code"], item_id=item.id)
    for key, value in changes.items():
        setattr(item, key, value)
    if item.ends_at and item.starts_at and item.ends_at <= item.starts_at:
        raise HTTPException(status_code=422, detail="ends_at должен быть позже starts_at")
    _audit_item(db, current_user, "shop_item_update", item, before)
    db.commit()
    db.refresh(item)
    return item


@router.get("/items", response_model=list[ShopItemRead])
def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    return _catalog_rows(
        db,
        current_user,
        include_inactive=current_user.role in {"manager", "admin"},
    )


@router.post("/items", response_model=ShopItemRead, dependencies=[Depends(require_roles("admin"))])
def create_item(
    payload: ShopItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopItem:
    return _create_item(db, current_user, payload)


@router.patch("/items/{item_id}", response_model=ShopItemRead, dependencies=[Depends(require_roles("admin"))])
def update_item(
    item_id: int,
    payload: ShopItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopItem:
    return _update_item(db, current_user, item_id, payload)


@router.post("/purchases", response_model=ShopPurchaseRead)
def request_purchase(
    payload: PurchaseCreate,
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = create_purchase(
        db,
        operator_for_user_or_403(db, current_user),
        payload.shop_item_id,
        payload.discount_coupon_id,
        idempotency_key=idempotency_header or payload.idempotency_key,
    )
    db.commit()
    rating_cache_invalidate()  # резерв меняет доступный баланс оператора
    db.refresh(purchase)
    return purchase


# ---------------------------------------------------------------------------
# Контракт ТЗ §13. Старые /shop/* остаются для обратной совместимости.
# ---------------------------------------------------------------------------


@store_router.get("/prizes", response_model=list[ShopItemRead])
def store_prizes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    return _catalog_rows(db, current_user)


@store_router.get("/orders/me", response_model=list[ShopPurchaseRead])
def my_store_orders(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("operator")),
) -> list[ShopPurchase]:
    operator = operator_for_user_or_403(db, current_user)
    return list(
        db.scalars(
            select(ShopPurchase)
            .where(ShopPurchase.operator_id == operator.id)
            .order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
            .offset(offset)
            .limit(limit)
        )
    )


@store_router.post("/orders", response_model=ShopPurchaseRead)
def create_store_order(
    payload: PurchaseCreate,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=8,
        max_length=200,
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("operator")),
) -> ShopPurchase:
    purchase = create_purchase(
        db,
        operator_for_user_or_403(db, current_user),
        payload.shop_item_id,
        payload.discount_coupon_id,
        idempotency_key=idempotency_key,
    )
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@admin_store_router.get("/prizes", response_model=list[ShopItemRead])
def admin_store_prizes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    return _catalog_rows(db, current_user, include_inactive=True)


@admin_store_router.post("/prizes", response_model=ShopItemRead)
def admin_create_prize(
    payload: ShopItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopItem:
    return _create_item(db, current_user, payload)


@admin_store_router.patch("/prizes/{item_id}", response_model=ShopItemRead)
def admin_update_prize(
    item_id: int,
    payload: ShopItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopItem:
    return _update_item(db, current_user, item_id, payload)


@admin_store_router.get("/orders", response_model=list[ShopPurchaseRead])
def admin_store_orders(
    order_status: str | None = Query(default=None, alias="status"),
    operator_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[ShopPurchase]:
    status_aliases = {
        "created": "pending",
        "reserved": "new",
        "ready": "approved",
        "issued": "completed",
        "cancelled": "rejected",
    }
    query = select(ShopPurchase).order_by(
        ShopPurchase.created_at.desc(),
        ShopPurchase.id.desc(),
    )
    if order_status:
        query = query.where(ShopPurchase.status == status_aliases.get(order_status, order_status))
    if operator_id is not None:
        query = query.where(ShopPurchase.operator_id == operator_id)
    return list(db.scalars(query.offset(offset).limit(limit)))


@admin_store_router.post("/orders/{purchase_id}/ready", response_model=ShopPurchaseRead)
def admin_ready_order(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    approve_purchase(db, purchase, current_user)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@admin_store_router.post("/orders/{purchase_id}/cancel", response_model=ShopPurchaseRead)
def admin_cancel_order(
    purchase_id: int,
    payload: RejectPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    reject_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@admin_store_router.post("/orders/{purchase_id}/issue", response_model=ShopPurchaseRead)
def admin_issue_order(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    complete_purchase(db, purchase, current_user)
    db.commit()
    db.refresh(purchase)
    return purchase


@admin_store_router.post("/orders/{purchase_id}/refund", response_model=ShopPurchaseRead)
def admin_refund_order(
    purchase_id: int,
    payload: RejectPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
) -> ShopPurchase:
    from app.modules.wallet.service import refund_purchase

    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    refund_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@admin_store_router.get("/inventory")
def admin_store_inventory(db: Session = Depends(get_db)) -> list[dict]:
    from app.modules.economy.router import list_inventory

    return list_inventory(db)


@admin_store_router.post("/inventory")
def admin_store_inventory_update(
    payload: InventoryUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from app.modules.economy.router import upsert_inventory

    return upsert_inventory(payload, db, current_user)


@router.get("/discounts", response_model=list[ShopDiscountCouponRead])
def list_discounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("operator")),
) -> list[ShopDiscountCoupon]:
    operator = operator_for_user_or_403(db, current_user)
    coupons = sync_shop_discount_coupons(db, operator.id)
    db.commit()
    return coupons


@router.get("/purchases", response_model=list[ShopPurchaseRead])
def list_purchases(
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ShopPurchase]:
    query = select(ShopPurchase).order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
    if current_user.role == "operator":
        operator = operator_for_user_or_403(db, current_user)
        query = query.where(ShopPurchase.operator_id == operator.id)
    else:
        group_id = supervisor_scope_group_id(db, current_user)
        if group_id is not None:
            query = query.join(Operator, Operator.id == ShopPurchase.operator_id).where(Operator.group_id == group_id)
    if limit is not None:
        query = query.offset(offset).limit(limit)
    return list(db.scalars(query))


def _assert_purchase_in_scope(db: Session, purchase: ShopPurchase, current_user: User) -> None:
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is None:
        return
    operator = db.get(Operator, purchase.operator_id)
    if not operator or operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Заявка вне вашей группы")


@router.post("/purchases/{purchase_id}/approve", response_model=ShopPurchaseRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def approve(purchase_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    approve_purchase(db, purchase, current_user)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@router.post("/purchases/{purchase_id}/reject", response_model=ShopPurchaseRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def reject(
    purchase_id: int,
    payload: RejectPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    reject_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase


@router.post("/purchases/{purchase_id}/complete", response_model=ShopPurchaseRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def complete(purchase_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    _assert_purchase_in_scope(db, purchase, current_user)
    complete_purchase(db, purchase, current_user)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.post(
    "/purchases/{purchase_id}/refund",
    response_model=ShopPurchaseRead,
    dependencies=[Depends(require_roles("admin"))],
)
def refund(
    purchase_id: int,
    payload: RejectPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    """Возврат выданного приза — только администратор (ТЗ «Экономика коинов»
    §6). Обратная транзакция идемпотентна, склад получает единицу обратно."""
    from app.modules.wallet.service import refund_purchase

    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    refund_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    rating_cache_invalidate()
    db.refresh(purchase)
    return purchase
