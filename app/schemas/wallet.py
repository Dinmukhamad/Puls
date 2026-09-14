from pydantic import BaseModel

from app.schemas.cabinet import TransactionOut
from app.schemas.common import Page


class WalletTransaction(TransactionOut):
    user_id: int
    full_name: str


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
