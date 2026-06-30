from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, User
from app.schemas.wallet import CoinTransactionRead, ManualTransactionCreate, WalletRead
from app.services.coins import add_transaction, operator_for_user_or_403

router = APIRouter(prefix="/wallet", tags=["wallet"])


def build_wallet(db: Session, operator: Operator) -> WalletRead:
    transactions = list(
        db.scalars(
            select(CoinTransaction)
            .where(CoinTransaction.operator_id == operator.id)
            .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
            .limit(50)
        )
    )
    return WalletRead(
        operator_id=operator.id,
        full_name=operator.full_name,
        group_name=operator.group_name,
        current_balance=operator.current_balance,
        reserved_balance=operator.reserved_balance,
        total_earned=operator.total_earned,
        total_spent=operator.total_spent,
        transactions=transactions,
    )


@router.get("/me", response_model=WalletRead)
def my_wallet(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> WalletRead:
    return build_wallet(db, operator_for_user_or_403(db, current_user))


@router.get("/{operator_id}", response_model=WalletRead)
def operator_wallet(operator_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles("supervisor", "manager", "admin"))) -> WalletRead:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return build_wallet(db, operator)


@router.post("/transactions", response_model=CoinTransactionRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def create_manual_transaction(
    payload: ManualTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoinTransaction:
    # Backend validation (TZ Приоритет 4)
    try:
        payload.validate_business_rules()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    # Check operator is active and participating
    dismissed = getattr(operator, 'employment_status', None) == 'dismissed' or                 getattr(operator, 'status', '') == 'dismissed'
    if dismissed or not operator.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя начислять коины уволенному оператору",
        )
    transaction_type = "manual_accrual" if payload.amount >= 0 else "manual_deduction"
    # Build full comment: "Reason: comment" or just "Reason"
    reason = payload.reason.strip()
    comment = payload.comment.strip()
    full_comment = f"{reason}: {comment}" if comment else reason
    transaction = add_transaction(db, operator, payload.amount, transaction_type, full_comment, created_by=current_user)
    db.commit()
    db.refresh(transaction)
    return transaction
