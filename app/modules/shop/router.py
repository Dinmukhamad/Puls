from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import Operator, ShopDiscountCoupon, ShopItem, ShopPurchase, User
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


@router.get("/items", response_model=list[ShopItemRead])
def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    from app.modules.economy.service import effective_item_pricing, get_active_season

    items = list(db.scalars(select(ShopItem).where(ShopItem.is_active.is_(True)).order_by(ShopItem.price.asc())))
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
            season_ends_at=pricing["season_ends_at"],
        )
        result.append(row)
    return result


@router.post("/items", response_model=ShopItemRead, dependencies=[Depends(require_roles("admin"))])
def create_item(payload: ShopItemCreate, db: Session = Depends(get_db)) -> ShopItem:
    item = ShopItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/items/{item_id}", response_model=ShopItemRead, dependencies=[Depends(require_roles("admin"))])
def update_item(item_id: int, payload: ShopItemUpdate, db: Session = Depends(get_db)) -> ShopItem:
    item = db.get(ShopItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Бонус не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/purchases", response_model=ShopPurchaseRead)
def request_purchase(
    payload: PurchaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShopPurchase:
    purchase = create_purchase(
        db,
        operator_for_user_or_403(db, current_user),
        payload.shop_item_id,
        payload.discount_coupon_id,
        idempotency_key=payload.idempotency_key,
    )
    db.commit()
    rating_cache_invalidate()  # резерв меняет доступный баланс оператора
    db.refresh(purchase)
    return purchase


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
