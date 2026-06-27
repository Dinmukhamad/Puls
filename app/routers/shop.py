from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import ShopItem, ShopPurchase, User
from app.schemas.shop import PurchaseCreate, RejectPurchaseRequest, ShopItemCreate, ShopItemRead, ShopItemUpdate, ShopPurchaseRead
from app.services.coins import approve_purchase, create_purchase, operator_for_user_or_403, reject_purchase

router = APIRouter(prefix="/shop", tags=["shop"])


@router.get("/items", response_model=List[ShopItemRead])
def list_items(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> List[ShopItem]:
    return list(db.scalars(select(ShopItem).where(ShopItem.is_active.is_(True)).order_by(ShopItem.price.asc())))


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
    purchase = create_purchase(db, operator_for_user_or_403(db, current_user), payload.shop_item_id)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.get("/purchases", response_model=List[ShopPurchaseRead])
def list_purchases(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> List[ShopPurchase]:
    query = select(ShopPurchase).order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
    if current_user.role == "operator":
        operator = operator_for_user_or_403(db, current_user)
        query = query.where(ShopPurchase.operator_id == operator.id)
    return list(db.scalars(query))


@router.post("/purchases/{purchase_id}/approve", response_model=ShopPurchaseRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def approve(purchase_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> ShopPurchase:
    purchase = db.get(ShopPurchase, purchase_id)
    if not purchase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    approve_purchase(db, purchase, current_user)
    db.commit()
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
    reject_purchase(db, purchase, current_user, payload.reason)
    db.commit()
    db.refresh(purchase)
    return purchase
