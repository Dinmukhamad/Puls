from pydantic import BaseModel

from app.models.enums import Role
from app.schemas.cabinet import TransactionOut
from app.schemas.common import Page


class WalletTransaction(TransactionOut):
    user_id: int
    full_name: str
    author_role: Role | None = None
    is_system: bool


class WalletOperator(BaseModel):
    user_id: int
    full_name: str
    group_name: str | None = None
    is_active: bool
    balance: int
    reserved: int
    available: int


class WalletSummary(BaseModel):
    balance: int
    reserved: int
    available: int
    awarded: int
    spent: int
    refunded: int
    accounts: int
    earned_total: int


class WalletReport(BaseModel):
    summary: WalletSummary
    history: Page[WalletTransaction]
