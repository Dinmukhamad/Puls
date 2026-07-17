from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ManualTransactionCreate(BaseModel):
    operator_id: int
    amount: int
    comment: str = ""
    reason: str = ""  # required, validated in router
    # ТЗ «Экономика коинов» §15: начисление свыше лимита требует подтверждения.
    confirm_over_limit: bool = False

    def validate_business_rules(self) -> None:
        """Backend validation per TZ."""
        if not self.reason.strip():
            raise ValueError("Причина операции обязательна")
        if self.amount == 0:
            raise ValueError("Количество коинов должно быть больше 0")
        if self.reason.strip() == "Другое" and not self.comment.strip():
            raise ValueError('Комментарий обязателен при выборе причины "Другое"')


class CoinTransactionRead(BaseModel):
    id: int
    operator_id: int
    amount: int
    type: str
    comment: str
    created_by_user_id: int | None
    related_purchase_id: int | None
    source_type: str | None = None
    source_id: int | None = None
    metadata_json: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WalletRead(BaseModel):
    operator_id: int
    full_name: str
    group_name: str
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    transactions: list[CoinTransactionRead]
