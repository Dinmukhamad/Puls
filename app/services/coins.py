from __future__ import annotations

from math import floor

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.entities import CoinTransaction, Operator, ShopItem, ShopPurchase, User, now_utc


def points_to_coins(points: float) -> int:
    return max(0, floor(points / 5))


def add_transaction(
    db: Session,
    operator: Operator,
    amount: int,
    transaction_type: str,
    comment: str,
    created_by: User | None = None,
    purchase: ShopPurchase | None = None,
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
    )
    db.add(transaction)
    return transaction


def create_purchase(db: Session, operator: Operator, item_id: int) -> ShopPurchase:
    item = db.get(ShopItem, item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Бонус не найден")

    # Блокируем строку оператора на время транзакции (SELECT ... FOR UPDATE).
    # Без этого два одновременных запроса на покупку читают один и тот же
    # баланс, оба проходят проверку и оба списывают — двойное списание и уход
    # баланса в минус. На PostgreSQL (prod) блокировка сериализует запросы,
    # на SQLite (dev) FOR UPDATE просто игнорируется.
    operator = db.get(Operator, operator.id, with_for_update=True)
    if operator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    if operator.current_balance < item.price:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недостаточно коинов")

    purchase = ShopPurchase(operator_id=operator.id, shop_item_id=item.id, price=item.price, status="new")
    db.add(purchase)
    db.flush()

    # Резервирование: коины уходят с доступного баланса, но еще не считаются потраченными.
    operator.current_balance -= item.price
    operator.reserved_balance += item.price

    # Страховка: баланс не должен уйти в минус ни при каких рассогласованиях.
    if operator.current_balance < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недостаточно коинов")

    db.add(
        CoinTransaction(
            operator_id=operator.id,
            amount=-item.price,
            type="reservation",
            comment=f"Резерв заявки: {item.title}",
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
    return purchase


def operator_for_user_or_403(db: Session, user: User) -> Operator:
    if user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь не привязан к оператору")
    operator = db.get(Operator, user.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator
