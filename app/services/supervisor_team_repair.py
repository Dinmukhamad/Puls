"""Guarded, one-time maintenance of legacy team owners; never exposes an API route."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import Role
from app.models.settings import SETTINGS_SINGLETON_ID, AuditLog, GamificationSettings
from app.models.user import Group, User
from app.services import city_estate, city_world
from app.services.rules import write_audit

REPAIR_ACTION = "supervisor_team.repair"
MAX_PLAN_BYTES = 128 * 1024


class RepairPlanError(ValueError):
    """An invalid or stale plan; messages intentionally contain no staff data."""


class OwnershipChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    group_id: StrictInt = Field(gt=0)
    expected_group_code: str = Field(min_length=1, max_length=32)
    expected_supervisor_id: StrictInt | None = Field(gt=0)
    supervisor_id: StrictInt = Field(gt=0)


class RepairPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    repair_id: str = Field(
        min_length=1, max_length=64, pattern=r"\A[A-Za-z0-9][A-Za-z0-9._-]*\z"
    )
    ownership_changes: list[OwnershipChange] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_groups(self) -> RepairPlan:
        ids = [change.group_id for change in self.ownership_changes]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate groups are not allowed")
        return self


@dataclass(frozen=True)
class RepairResult:
    status: Literal["applied", "already_applied"]
    updated_groups: int = 0
    reconciled_operators: int = 0


def _parse_plan(raw_plan: str) -> RepairPlan:
    if not isinstance(raw_plan, str) or len(raw_plan.encode("utf-8")) > MAX_PLAN_BYTES:
        raise RepairPlanError("Maintenance plan is missing or too large")
    try:
        return RepairPlan.model_validate_json(raw_plan)
    except ValidationError:
        # Pydantic errors include rejected values: do not forward them to startup logs.
        raise RepairPlanError("Maintenance plan has an invalid format") from None


async def apply_plan(session: AsyncSession, raw_plan: str) -> RepairResult:
    """Apply a preapproved ownership plan atomically, once for its persistent repair ID.

    The existing rules singleton serializes all application workers, including before a city
    configuration exists. Audit markers are checked while holding that lock and survive future
    manual team edits, so an old deployment can never reapply a completed repair.
    """
    try:
        plan = _parse_plan(raw_plan)
        mutex = await session.scalar(
            select(GamificationSettings)
            .where(GamificationSettings.id == SETTINGS_SINGLETON_ID)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if mutex is None:
            raise RepairPlanError("Maintenance requires the existing rules singleton")
        completed = await session.scalar(
            select(AuditLog.id).where(
                AuditLog.action == REPAIR_ACTION,
                AuditLog.entity_type == "supervisor_team",
                AuditLog.entity_id == plan.repair_id,
            )
        )
        if completed is not None:
            await session.rollback()
            return RepairResult(status="already_applied")

        await city_world.lock_settings(session)
        owner_ids = {
            owner_id
            for change in plan.ownership_changes
            for owner_id in (change.expected_supervisor_id, change.supervisor_id)
            if owner_id is not None
        }
        owners = {
            user.id: user
            for user in await session.scalars(
                select(User)
                .where(User.id.in_(owner_ids))
                .order_by(User.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        }
        groups = {
            group.id: group
            for group in await session.scalars(
                select(Group)
                .where(Group.id.in_([change.group_id for change in plan.ownership_changes]))
                .order_by(Group.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        }

        # Validate the entire selection before touching ownership, audit, or city estate.
        for change in plan.ownership_changes:
            owner = owners.get(change.supervisor_id)
            if owner is None or owner.role != Role.SUPERVISOR or not owner.is_active:
                raise RepairPlanError("Maintenance target must be an active supervisor")
            group = groups.get(change.group_id)
            if group is None or not group.is_active:
                raise RepairPlanError("Maintenance group must exist and be active")
            if group.code != change.expected_group_code:
                raise RepairPlanError("Maintenance group code has changed")
            if group.supervisor_id != change.expected_supervisor_id:
                raise RepairPlanError("Maintenance group owner has changed")

        changed = [
            change
            for change in plan.ownership_changes
            if change.expected_supervisor_id != change.supervisor_id
        ]
        operator_ids = list(
            await session.scalars(
                select(User.id)
                .where(
                    User.group_id.in_([change.group_id for change in changed]),
                    User.role == Role.OPERATOR,
                )
                .order_by(User.id)
                .with_for_update()
            )
        )
        for change in changed:
            groups[change.group_id].supervisor_id = change.supervisor_id
        await session.flush()

        if operator_ids:
            districts = await city_estate.world_districts(session)
            await city_estate.reconcile_many(session, operator_ids, districts)
        for change in changed:
            await write_audit(
                session,
                actor_id=None,
                action="group.update",
                entity_type="group",
                entity_id=change.group_id,
                payload={
                    "before": {"supervisor_id": change.expected_supervisor_id},
                    "after": {"supervisor_id": change.supervisor_id},
                    "repair_id": plan.repair_id,
                },
            )
        await write_audit(
            session,
            actor_id=None,
            action=REPAIR_ACTION,
            entity_type="supervisor_team",
            entity_id=plan.repair_id,
            payload={
                "repair_id": plan.repair_id,
                "group_ids": [change.group_id for change in changed],
                "updated_groups": len(changed),
                "reconciled_operators": len(operator_ids),
            },
        )
        await session.commit()
        return RepairResult(
            status="applied",
            updated_groups=len(changed),
            reconciled_operators=len(operator_ids),
        )
    except BaseException:
        await session.rollback()
        raise
