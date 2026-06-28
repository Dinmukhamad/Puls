from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


OPERATOR_STATUSES = {"active", "inactive", "archive"}


class OperatorBase(BaseModel):
    full_name: str = Field(min_length=1)
    group_name: str = Field(min_length=1)
    status: str = "active"
    position: Optional[str] = None
    employee_id: Optional[str] = None
    email: Optional[str] = None
    participation_started_at: Optional[date] = None
    admin_comment: Optional[str] = None


class OperatorCreate(OperatorBase):
    confirm_duplicate: bool = False


class OperatorUpdate(BaseModel):
    full_name: Optional[str] = None
    group_name: Optional[str] = None
    status: Optional[str] = None
    position: Optional[str] = None
    employee_id: Optional[str] = None
    email: Optional[str] = None
    participation_started_at: Optional[date] = None
    admin_comment: Optional[str] = None


class OperatorRead(BaseModel):
    id: int
    full_name: str
    group_name: str
    status: str
    position: Optional[str]
    employee_id: Optional[str]
    email: Optional[str]
    participation_started_at: Optional[date]
    admin_comment: Optional[str]
    user_id: Optional[int]
    username: Optional[str] = None
    created_by_user_id: Optional[int]
    created_by_name: Optional[str] = None
    current_balance: int
    reserved_balance: int
    total_earned: int
    total_spent: int
    created_at: datetime
    is_active: bool

    model_config = {"from_attributes": True}


class OperatorDuplicateRead(BaseModel):
    id: int
    full_name: str
    group_name: str
    status: str
    employee_id: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None

    model_config = {"from_attributes": True}


class OperatorAccountRead(BaseModel):
    full_name: str
    group_name: str
    status: str
    username: str
    temporary_password: str


class OperatorCreateResult(BaseModel):
    operator: OperatorRead
    account: OperatorAccountRead
    possible_duplicates: List[OperatorDuplicateRead] = Field(default_factory=list)


class PasswordResetResult(BaseModel):
    operator: OperatorRead
    account: OperatorAccountRead


class OperatorAuditLogRead(BaseModel):
    id: int
    operator_id: int
    action: str
    comment: str
    actor_user_id: Optional[int]
    actor_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OperatorCardRead(BaseModel):
    operator: OperatorRead
    transactions: List[dict]
    purchases: List[dict]
    audit_log: List[OperatorAuditLogRead]
