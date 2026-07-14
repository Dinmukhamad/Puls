from __future__ import annotations

import json
from math import ceil, floor

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    CoinTransaction,
    Operator,
    ShopDiscountCoupon,
    ShopItem,
    ShopPurchase,
    User,
    WheelSpin,
    now_utc,
)


def points_to_coins(points: float, db: Session | None = None) -> int:
    """Переводит баллы в коины по настраиваемому курсу (ТЗ §4).

    Если передана сессия БД — берёт активные правила (`coin_rules`): курс,
    режим округления и минимальный порог. Без сессии (например, вызов вне
    запроса) — старое поведение по умолчанию: floor(points / 5).
    """
    if db is not None:
        from app.modules.settings.service import get_active_coin_rule

        rule = get_active_coin_rule(db)
        rate = rule.points_per_coin or 5
        min_points = rule.min_points_for_accrual or 0
        if points < min_points:
            return 0
        ratio = points / rate
        if rule.rounding_mode == "ceil":
            value = ceil(ratio)
        elif rule.rounding_mode == "round":
            value = round(ratio)
        else:
            value = floor(ratio)
        return max(0, int(value))
    return max(0, floor(points / 5))


def add_transaction(
    db: Session,
    operator: Operator,
    amount: int,
    transaction_type: str,
    comment: str,
    created_by: User | None = None,
    purchase: ShopPurchase | None = None,
    source_type: str | None = None,
    source_id: int | None = None,
    metadata: dict | None = None,
    related_spin_id: int | None = None,
) -> CoinTransaction:
    if not comment.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Комментарий обязателен")

    operator.current_balance += amount
    if amount > 0:
        operator.total_earned += amount
    elif transaction_type in {"manual_subtract", "manual_deduction", "purchase"}:
        operator.total_spent += abs(amount)

    if operator.current_balance < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недостаточно коинов")

    transaction = CoinTransaction(
        operator_id=operator.id,
        amount=amount,
        type=transaction_type,
        comment=comment.strip(),
        created_by_user_id=created_by.id if created_by else None,
        related_purchase_id=purchase.id if purchase else None,
        related_spin_id=related_spin_id,
        source_type=source_type,
        source_id=source_id,
        metadata_json=metadata,
    )
    db.add(transaction)
    return transaction


_STOCK_CONSUMING_STATUSES = ("new", "approved", "completed")  # всё, кроме rejected — тот резерв реален


def shop_item_claimed_count(db: Session, item_id: int) -> int:
    """Сколько единиц товара уже разобрано (заявки не в статусе rejected)."""
    return db.scalar(
        select(func.count(ShopPurchase.id)).where(
            ShopPurchase.shop_item_id == item_id,
            ShopPurchase.status.in_(_STOCK_CONSUMING_STATUSES),
        )
    ) or 0


def shop_item_operator_purchase_count(db: Session, item_id: int, operator_id: int) -> int:
    """Сколько раз этот оператор уже брал именно этот товар (без rejected)."""
    return db.scalar(
        select(func.count(ShopPurchase.id)).where(
            ShopPurchase.shop_item_id == item_id,
            ShopPurchase.operator_id == operator_id,
            ShopPurchase.status.in_(_STOCK_CONSUMING_STATUSES),
        )
    ) or 0


def shop_item_availability(db: Session, item: ShopItem, operator_id: int) -> dict:
    """Персонализированные поля для ShopItemRead (ТЗ P2, сезонный магазин):
    остаток, сколько уже взял этот оператор, доступен ли товар прямо сейчас."""
    now = now_utc()
    stock_remaining = None
    if item.stock_limit > 0:
        stock_remaining = max(0, item.stock_limit - shop_item_claimed_count(db, item.id))

    operator_count = shop_item_operator_purchase_count(db, item.id, operator_id) if operator_id else 0
    limit_reached = bool(item.purchase_limit_per_operator > 0 and operator_count >= item.purchase_limit_per_operator)

    in_season = True
    if item.starts_at and now < item.starts_at:
        in_season = False
    if item.ends_at and now > item.ends_at:
        in_season = False

    is_available = bool(item.is_active and in_season and not limit_reached and (stock_remaining is None or stock_remaining > 0))

    return {
        "stock_remaining": stock_remaining,
        "operator_purchased_count": operator_count,
        "operator_limit_reached": limit_reached,
        "is_available_now": is_available,
    }


def sync_shop_discount_coupons(db: Session, operator_id: int) -> list[ShopDiscountCoupon]:
    """Materialize coupons for shop-discount spins created before coupon support."""
    spins = list(db.scalars(
        select(WheelSpin).where(
            WheelSpin.operator_id == operator_id,
            WheelSpin.status == "completed",
        )
    ))
    existing_spin_ids = set(db.scalars(
        select(ShopDiscountCoupon.wheel_spin_id).where(ShopDiscountCoupon.operator_id == operator_id)
    ))
    for spin in spins:
        if spin.id in existing_spin_ids:
            continue
        try:
            payload = json.loads(spin.result_payload_json or "{}")
        except (TypeError, ValueError):
            continue
        if payload.get("type") != "shop_discount":
            continue
        percent = max(1, min(90, int(payload.get("amount") or 10)))
        db.add(ShopDiscountCoupon(
            operator_id=operator_id,
            wheel_spin_id=spin.id,
            title=str(payload.get("title") or "Скидка в магазине"),
            percent=percent,
        ))
        existing_spin_ids.add(spin.id)
    db.flush()
    return list(db.scalars(
        select(ShopDiscountCoupon)
        .where(
            ShopDiscountCoupon.operator_id == operator_id,
            ShopDiscountCoupon.status == "available",
        )
        .order_by(ShopDiscountCoupon.percent.desc(), ShopDiscountCoupon.created_at.asc())
    ))


def create_purchase(
    db: Session,
    operator: Operator,
    item_id: int,
    discount_coupon_id: int | None = None,
) -> ShopPurchase:
    # Блокируем и строку товара: лимит остатка (stock_limit) читается и
    # проверяется здесь же, и без FOR UPDATE два одновременных запроса на
    # последнюю единицу товара оба прошли бы проверку и оба списали бы —
    # тот же класс гонки, что и с балансом оператора ниже.
    item = db.get(ShopItem, item_id, with_for_update=True)
    if not item or not item.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Бонус не найден")

    now = now_utc()
    if item.starts_at and now < item.starts_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Товар пока не доступен — раздача ещё не началась")
    if item.ends_at and now > item.ends_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Товар больше не доступен — раздача завершена")

    if item.stock_limit > 0:
        claimed = shop_item_claimed_count(db, item.id)
        if claimed >= item.stock_limit:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Товар закончился")

    if item.purchase_limit_per_operator > 0:
        already = shop_item_operator_purchase_count(db, item.id, operator.id)
        if already >= item.purchase_limit_per_operator:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Лимит на одного оператора: {item.purchase_limit_per_operator}",
            )

    if item.min_level_id:
        from app.modules.operator_levels.service import operator_level_summary

        current_level = operator_level_summary(db, operator).get("level") or {}
        required_level = item.min_level
        current_sort = current_level.get("sort_order") or 0
        required_sort = required_level.sort_order if required_level else 0
        if current_sort < required_sort:
            required_name = required_level.name if required_level else "нужного уровня"
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Доступно с уровня «{required_name}»",
            )

    # Блокируем строку оператора на время транзакции (SELECT ... FOR UPDATE).
    # Без этого два одновременных запроса на покупку читают один и тот же
    # баланс, оба проходят проверку и оба списывают — двойное списание и уход
    # баланса в минус. На PostgreSQL (prod) блокировка сериализует запросы,
    # на SQLite (dev) FOR UPDATE просто игнорируется.
    operator = db.get(Operator, operator.id, with_for_update=True)
    if operator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    coupon = None
    discount_percent = 0
    discount_amount = 0
    final_price = item.price
    if discount_coupon_id is not None:
        sync_shop_discount_coupons(db, operator.id)
        coupon = db.scalar(
            select(ShopDiscountCoupon)
            .where(ShopDiscountCoupon.id == discount_coupon_id)
            .with_for_update()
        )
        if not coupon or coupon.operator_id != operator.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Скидка не найдена")
        if coupon.status != "available":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Эта скидка уже используется")
        discount_percent = max(1, min(90, int(coupon.percent or 10)))
        discount_amount = (item.price * discount_percent) // 100
        final_price = max(0, item.price - discount_amount)

    if operator.current_balance < final_price:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недостаточно коинов")

    purchase = ShopPurchase(
        operator_id=operator.id,
        shop_item_id=item.id,
        price=final_price,
        original_price=item.price,
        discount_percent=discount_percent,
        discount_amount=discount_amount,
        discount_coupon_id=coupon.id if coupon else None,
        status="new",
    )
    db.add(purchase)
    db.flush()

    if coupon:
        coupon.status = "reserved"
        coupon.reserved_purchase_id = purchase.id
        coupon.reserved_at = now

    # Резервирование: коины уходят с доступного баланса, но еще не считаются потраченными.
    operator.current_balance -= final_price
    operator.reserved_balance += final_price

    # Страховка: баланс не должен уйти в минус ни при каких рассогласованиях.
    if operator.current_balance < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недостаточно коинов")

    db.add(
        CoinTransaction(
            operator_id=operator.id,
            amount=-final_price,
            type="reservation",
            comment=(
                f"Резерв заявки: {item.title} (скидка {discount_percent}%)"
                if coupon else f"Резерв заявки: {item.title}"
            ),
            related_purchase_id=purchase.id,
        )
    )
    return purchase


def approve_purchase(db: Session, purchase: ShopPurchase, reviewer: User) -> ShopPurchase:
    # Блокируем оператора и перечитываем актуальный статус заявки — защита от
    # двойной обработки, когда два ревьюера жмут «Одобрить»/«Отклонить»
    # одновременно (оба видят статус "new" до блокировки).
    operator = db.get(Operator, purchase.operator_id, with_for_update=True)
    db.refresh(purchase)
    if purchase.status not in {"pending", "new"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Заявка уже обработана")
    if operator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    operator.reserved_balance = max(0, operator.reserved_balance - purchase.price)
    operator.total_spent += purchase.price
    purchase.status = "approved"
    purchase.reviewed_by_user_id = reviewer.id

    purchase.reviewed_at = now_utc()
    if purchase.discount_coupon_id:
        coupon = db.scalar(
            select(ShopDiscountCoupon)
            .where(ShopDiscountCoupon.id == purchase.discount_coupon_id)
            .with_for_update()
        )
        if coupon and coupon.status == "reserved" and coupon.reserved_purchase_id == purchase.id:
            coupon.status = "used"
            coupon.used_at = purchase.reviewed_at
    db.add(
        CoinTransaction(
            operator_id=operator.id,
            amount=0,
            type="purchase",
            comment="Заявка одобрена, резерв списан окончательно",
            created_by_user_id=reviewer.id,
            related_purchase_id=purchase.id,
        )
    )
    from app.modules.notifications.service import notify_purchase_status
    item = db.get(ShopItem, purchase.shop_item_id)
    notify_purchase_status(db, operator.id, item.title if item else "бонус", "approved")
    return purchase


def reject_purchase(db: Session, purchase: ShopPurchase, reviewer: User, reason: str) -> ShopPurchase:
    # Блокируем оператора и перечитываем статус заявки (см. approve_purchase).
    operator = db.get(Operator, purchase.operator_id, with_for_update=True)
    db.refresh(purchase)
    if purchase.status not in {"pending", "new"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Заявка уже обработана")
    if operator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    operator.reserved_balance = max(0, operator.reserved_balance - purchase.price)
    operator.current_balance += purchase.price
    purchase.status = "rejected"
    purchase.reject_reason = reason
    purchase.reviewed_by_user_id = reviewer.id

    purchase.reviewed_at = now_utc()
    if purchase.discount_coupon_id:
        coupon = db.scalar(
            select(ShopDiscountCoupon)
            .where(ShopDiscountCoupon.id == purchase.discount_coupon_id)
            .with_for_update()
        )
        if coupon and coupon.status == "reserved" and coupon.reserved_purchase_id == purchase.id:
            coupon.status = "available"
            coupon.reserved_purchase_id = None
            coupon.reserved_at = None
    db.add(
        CoinTransaction(
            operator_id=operator.id,
            amount=purchase.price,
            type="refund",
            comment=f"Возврат по отклоненной заявке: {reason}",
            created_by_user_id=reviewer.id,
            related_purchase_id=purchase.id,
        )
    )
    from app.modules.notifications.service import notify_purchase_status
    item = db.get(ShopItem, purchase.shop_item_id)
    notify_purchase_status(db, operator.id, item.title if item else "бонус", "rejected", reason)
    return purchase


def complete_purchase(db: Session, purchase: ShopPurchase, reviewer: User) -> ShopPurchase:
    if purchase.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Выполнить можно только одобренную заявку",
        )
    purchase.status = "completed"
    purchase.reviewed_by_user_id = purchase.reviewed_by_user_id or reviewer.id
    purchase.completed_at = now_utc()
    db.add(
        CoinTransaction(
            operator_id=purchase.operator_id,
            amount=0,
            type="request_completed",
            comment="Заявка отмечена выполненной",
            created_by_user_id=reviewer.id,
            related_purchase_id=purchase.id,
        )
    )
    from app.modules.notifications.service import notify_purchase_status
    item = db.get(ShopItem, purchase.shop_item_id)
    notify_purchase_status(db, purchase.operator_id, item.title if item else "бонус", "completed")
    return purchase


def operator_for_user_or_403(db: Session, user: User) -> Operator:
    if user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь не привязан к оператору")
    operator = db.get(Operator, user.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator
