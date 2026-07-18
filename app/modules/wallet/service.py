from __future__ import annotations

import json
from datetime import datetime, timedelta
from math import ceil, floor

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    AuditLog,
    CoinTransaction,
    Operator,
    ShopDiscountCoupon,
    ShopItem,
    ShopItemInventory,
    ShopPurchase,
    User,
    WheelSpin,
    now_utc,
)

# Жизненный цикл заказа (ТЗ «Экономика коинов» §12.1):
# new(=created+reserved) → approved(=ready) → completed(=issued);
# rejected(=cancelled) / refunded / expired.
PENDING_EXPIRE_DAYS = 7    # заявка не обработана ревьюером → автоотмена с возвратом
READY_PICKUP_DAYS = 14     # приз готов, но не забран → автоистечение с возвратом


def _audit_purchase_status(
    db: Session,
    purchase: ShopPurchase,
    before: str,
    actor: User | None,
    *,
    reason: str | None = None,
) -> None:
    db.add(
        AuditLog(
            action="shop_order_status_change",
            entity_type="shop_purchase",
            entity_id=purchase.id,
            operator_id=purchase.operator_id,
            details=json.dumps(
                {"before": before, "after": purchase.status, "reason": reason},
                ensure_ascii=False,
            ),
            performed_by_user_id=actor.id if actor else None,
        )
    )


def _inventory_for_update(db: Session, item_id: int) -> ShopItemInventory | None:
    """Строка склада с блокировкой FOR UPDATE (если складской учёт включён).
    Блокировка обязательна: reserve/issue/return меняют счётчики конкурентно."""
    return db.scalar(
        select(ShopItemInventory)
        .where(ShopItemInventory.shop_item_id == item_id)
        .with_for_update()
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
    reason_code: str | None = None,
    metadata: dict | None = None,
    related_spin_id: int | None = None,
    idempotency_key: str | None = None,
) -> CoinTransaction:
    if not comment.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Комментарий обязателен")

    # Идемпотентность (ТЗ «Экономика коинов» §14): повторное событие с тем же
    # ключом возвращает ранее созданную транзакцию без повторного изменения
    # баланса. Уникальный индекс в БД — вторая линия защиты от гонки.
    if idempotency_key:
        existing = db.scalar(
            select(CoinTransaction).where(CoinTransaction.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return existing

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
        reason_code=reason_code or source_type or transaction_type,
        metadata_json=metadata,
        idempotency_key=idempotency_key,
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
    # Складской учёт (ТЗ §12.1 prize_inventory): если для товара включены
    # счётчики — они источник истины по остатку; иначе fallback на stock_limit.
    inventory = db.scalar(
        select(ShopItemInventory).where(ShopItemInventory.shop_item_id == item.id)
    )
    if inventory is not None:
        stock_remaining = max(0, inventory.available)
    elif item.stock_limit > 0:
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
    idempotency_key: str | None = None,
) -> ShopPurchase:
    # Idempotency-Key (ТЗ §14): повторная отправка формы (double-click, retry
    # сети) возвращает уже созданный заказ, не создавая второй резерв.
    # Уникальный индекс в БД страхует от гонки двух одновременных запросов.
    if idempotency_key:
        existing = db.scalar(
            select(ShopPurchase).where(ShopPurchase.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return existing

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

    # Складской учёт (ТЗ §12.1): при включённых счётчиках остаток по ним —
    # источник истины; строка склада заблокирована FOR UPDATE на всю покупку.
    inventory = _inventory_for_update(db, item.id)
    if inventory is not None and inventory.available <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Товар закончился")

    if inventory is None and item.stock_limit > 0:
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
    # Эффективная цена сезона (ТЗ «Экономика коинов» §7, §9.1): backend в той же
    # транзакции повторно определяет сезон и цену — frontend не источник истины.
    from app.modules.economy.service import effective_item_pricing, get_active_season

    active_season = get_active_season(db, now)
    pricing = effective_item_pricing(db, item, active_season, _season_resolved=True)
    effective_price = pricing["price"]
    final_price = effective_price
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
        discount_amount = (effective_price * discount_percent) // 100
        final_price = max(0, effective_price - discount_amount)

    if operator.current_balance < final_price:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Недостаточно коинов")

    purchase = ShopPurchase(
        operator_id=operator.id,
        shop_item_id=item.id,
        price=final_price,
        original_price=effective_price,
        discount_percent=discount_percent,
        discount_amount=discount_amount,
        discount_coupon_id=coupon.id if coupon else None,
        season_id=active_season.id if active_season else None,
        idempotency_key=idempotency_key,
        status="new",
    )
    db.add(purchase)
    db.flush()

    # Резерв единицы на складе (счётчик снимается при reject/expire,
    # переходит в issued при выдаче).
    if inventory is not None:
        inventory.quantity_reserved += 1

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
            reason_code="purchase_reservation",
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
    before_status = purchase.status
    operator.reserved_balance = max(0, operator.reserved_balance - purchase.price)
    operator.total_spent += purchase.price
    purchase.status = "approved"
    purchase.reviewed_by_user_id = reviewer.id

    purchase.reviewed_at = now_utc()
    # Дедлайн получения приза (ТЗ §12.1 expired): не забрал за
    # READY_PICKUP_DAYS — заказ истекает с возвратом коинов.
    purchase.expires_at = purchase.reviewed_at + timedelta(days=READY_PICKUP_DAYS)
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
            reason_code="purchase_approved",
        )
    )
    _audit_purchase_status(db, purchase, before_status, reviewer)
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
    before_status = purchase.status
    operator.reserved_balance = max(0, operator.reserved_balance - purchase.price)
    operator.current_balance += purchase.price
    purchase.status = "rejected"
    purchase.reject_reason = reason
    purchase.reviewed_by_user_id = reviewer.id
    # Возврат складского резерва (ТЗ §12.1): единица снова доступна.
    inventory = _inventory_for_update(db, purchase.shop_item_id)
    if inventory is not None:
        inventory.quantity_reserved = max(0, inventory.quantity_reserved - 1)

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
            reason_code="purchase_refund",
        )
    )
    _audit_purchase_status(db, purchase, before_status, reviewer, reason=reason)
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
    before_status = purchase.status
    purchase.status = "completed"
    purchase.reviewed_by_user_id = purchase.reviewed_by_user_id or reviewer.id
    # completed = issued (ТЗ §12.1): фиксируем, кто фактически выдал приз.
    purchase.issued_by_user_id = reviewer.id
    purchase.completed_at = now_utc()
    purchase.expires_at = None
    # Склад: резерв переходит в выдачу.
    inventory = _inventory_for_update(db, purchase.shop_item_id)
    if inventory is not None:
        inventory.quantity_reserved = max(0, inventory.quantity_reserved - 1)
        inventory.quantity_issued += 1
    db.add(
        CoinTransaction(
            operator_id=purchase.operator_id,
            amount=0,
            type="request_completed",
            comment="Заявка отмечена выполненной",
            created_by_user_id=reviewer.id,
            related_purchase_id=purchase.id,
            reason_code="prize_issued",
        )
    )
    _audit_purchase_status(db, purchase, before_status, reviewer)
    from app.modules.notifications.service import notify_purchase_status
    item = db.get(ShopItem, purchase.shop_item_id)
    notify_purchase_status(db, purchase.operator_id, item.title if item else "бонус", "completed")
    return purchase


def refund_purchase(db: Session, purchase: ShopPurchase, admin: User, reason: str) -> ShopPurchase:
    """Возврат выданного приза (ТЗ §12.1 refunded, §6 «Возврат/аннулирование
    покупки — только администратор»).

    Только из completed(=issued). Деньги возвращаются ОТДЕЛЬНОЙ обратной
    транзакцией (ТЗ §5.4: «возврат должен быть... с обратной транзакцией»),
    идемпотентной по ключу purchase:{id}:refund — повторный вызов не создаст
    второй возврат. Склад: issued--, returned++ (единица снова в остатке)."""
    operator = db.get(Operator, purchase.operator_id, with_for_update=True)
    db.refresh(purchase)
    if purchase.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Вернуть можно только выданный приз",
        )
    if operator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    refund_tx = add_transaction(
        db,
        operator,
        purchase.price,
        "refund",
        f"Возврат выданного приза: {reason}",
        created_by=admin,
        purchase=purchase,
        source_type="purchase_refund",
        source_id=purchase.id,
        idempotency_key=f"purchase:{purchase.id}:refund",
    )
    db.flush()
    # add_transaction вернул существующую транзакцию → возврат уже проведён.
    if refund_tx.created_by_user_id != admin.id or purchase.status == "refunded":
        db.refresh(purchase)
        return purchase

    before_status = purchase.status
    operator.total_spent = max(0, operator.total_spent - purchase.price)
    purchase.status = "refunded"
    purchase.reject_reason = reason
    _audit_purchase_status(db, purchase, before_status, admin, reason=reason)

    inventory = _inventory_for_update(db, purchase.shop_item_id)
    if inventory is not None:
        # Счётчики исторические: quantity_issued НЕ уменьшается (это журнал
        # выдач); возврат отражается только в quantity_returned. Остаток
        # available = приход + возврат − резерв − выдача снова растёт на 1.
        inventory.quantity_returned += 1

    from app.modules.notifications.service import notify_purchase_status
    item = db.get(ShopItem, purchase.shop_item_id)
    notify_purchase_status(db, operator.id, item.title if item else "бонус", "refunded", reason)
    return purchase


def expire_stale_purchases(
    db: Session,
    *,
    pending_days: int = PENDING_EXPIRE_DAYS,
    now: datetime | None = None,
) -> dict:
    """Автоистечение заказов (ТЗ §12.1 expired). Два случая:

    1. new старше pending_days — заявку так и не обработали: возврат резерва
       коинов и склада, освобождение купона.
    2. approved с истёкшим expires_at — приз не забрали: коины уже в
       total_spent, возвращаем и current_balance, и total_spent.

    В обоих случаях возврат — отдельная транзакция с идемпотентным ключом
    purchase:{id}:expire. Вызывается ежедневной cron-задачей и вручную из
    админки. Возвращает счётчики для лога/ответа."""
    moment = now or now_utc()
    pending_deadline = moment - timedelta(days=pending_days)
    expired_pending = 0
    expired_ready = 0

    stale_new = list(
        db.scalars(
            select(ShopPurchase)
            .where(ShopPurchase.status == "new", ShopPurchase.created_at < pending_deadline)
            .with_for_update()
        )
    )
    stale_ready = list(
        db.scalars(
            select(ShopPurchase)
            .where(
                ShopPurchase.status == "approved",
                ShopPurchase.expires_at.is_not(None),
                ShopPurchase.expires_at < moment,
            )
            .with_for_update()
        )
    )

    for purchase in stale_new:
        operator = db.get(Operator, purchase.operator_id, with_for_update=True)
        if operator is None:
            continue
        before_status = purchase.status
        operator.reserved_balance = max(0, operator.reserved_balance - purchase.price)
        add_transaction(
            db,
            operator,
            purchase.price,
            "refund",
            "Срок обработки заявки истёк — коины возвращены",
            purchase=purchase,
            source_type="purchase_expire",
            source_id=purchase.id,
            idempotency_key=f"purchase:{purchase.id}:expire",
        )
        purchase.status = "expired"
        purchase.reject_reason = "Срок обработки заявки истёк"
        _audit_purchase_status(
            db,
            purchase,
            before_status,
            None,
            reason=purchase.reject_reason,
        )
        inventory = _inventory_for_update(db, purchase.shop_item_id)
        if inventory is not None:
            inventory.quantity_reserved = max(0, inventory.quantity_reserved - 1)
        if purchase.discount_coupon_id:
            coupon = db.get(ShopDiscountCoupon, purchase.discount_coupon_id, with_for_update=True)
            if coupon and coupon.status == "reserved" and coupon.reserved_purchase_id == purchase.id:
                coupon.status = "available"
                coupon.reserved_purchase_id = None
                coupon.reserved_at = None
        expired_pending += 1

    for purchase in stale_ready:
        operator = db.get(Operator, purchase.operator_id, with_for_update=True)
        if operator is None:
            continue
        before_status = purchase.status
        add_transaction(
            db,
            operator,
            purchase.price,
            "refund",
            "Приз не был получен в срок — коины возвращены",
            purchase=purchase,
            source_type="purchase_expire",
            source_id=purchase.id,
            idempotency_key=f"purchase:{purchase.id}:expire",
        )
        operator.total_spent = max(0, operator.total_spent - purchase.price)
        purchase.status = "expired"
        purchase.reject_reason = "Приз не был получен в срок"
        _audit_purchase_status(
            db,
            purchase,
            before_status,
            None,
            reason=purchase.reject_reason,
        )
        inventory = _inventory_for_update(db, purchase.shop_item_id)
        if inventory is not None:
            inventory.quantity_reserved = max(0, inventory.quantity_reserved - 1)
        expired_ready += 1

    return {"expired_pending": expired_pending, "expired_ready": expired_ready}


def operator_for_user_or_403(db: Session, user: User) -> Operator:
    if user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь не привязан к оператору")
    operator = db.get(Operator, user.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator
