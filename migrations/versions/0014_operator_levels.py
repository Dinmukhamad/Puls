"""Add operator levels.

Revision ID: 0014_operator_levels
Revises: 0013_tests_module
Create Date: 2026-07-01
"""
from __future__ import annotations

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "0014_operator_levels"
down_revision = "0013_tests_module"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("operator_levels"):
        op.create_table(
            "operator_levels",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(64), nullable=False, unique=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("color", sa.String(32), nullable=False, server_default="#64748B"),
            sa.Column("icon", sa.String(64), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_operator_levels_code", "operator_levels", ["code"])
        op.create_index("ix_operator_levels_is_active", "operator_levels", ["is_active"])
        op.create_index("ix_operator_levels_sort_order", "operator_levels", ["sort_order"])

    if not _table_exists("operator_level_rules"):
        op.create_table(
            "operator_level_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=False),
            sa.Column("metric_code", sa.String(64), nullable=False),
            sa.Column("operator", sa.String(16), nullable=False),
            sa.Column("value_min", sa.Float(), nullable=True),
            sa.Column("value_max", sa.Float(), nullable=True),
            sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_operator_level_rules_level_id", "operator_level_rules", ["level_id"])
        op.create_index("ix_operator_level_rules_metric_code", "operator_level_rules", ["metric_code"])

    if not _table_exists("operator_level_assignments"):
        op.create_table(
            "operator_level_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=False),
            sa.Column("assignment_type", sa.String(16), nullable=False, server_default="auto"),
            sa.Column("calculated_from", sa.Date(), nullable=True),
            sa.Column("calculated_to", sa.Date(), nullable=True),
            sa.Column("is_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("manual_reason", sa.String(255), nullable=True),
            sa.Column("manual_comment", sa.Text(), nullable=True),
            sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assigned_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("operator_id", name="uq_operator_level_assignments_operator"),
        )
        op.create_index("ix_operator_level_assignments_operator_id", "operator_level_assignments", ["operator_id"])
        op.create_index("ix_operator_level_assignments_level_id", "operator_level_assignments", ["level_id"])
        op.create_index("ix_operator_level_assignments_assignment_type", "operator_level_assignments", ["assignment_type"])
        op.create_index("ix_operator_level_assignments_is_manual", "operator_level_assignments", ["is_manual"])

    if not _table_exists("operator_level_history"):
        op.create_table(
            "operator_level_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("old_level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=True),
            sa.Column("new_level_id", sa.Integer(), sa.ForeignKey("operator_levels.id"), nullable=True),
            sa.Column("change_type", sa.String(16), nullable=False),
            sa.Column("reason", sa.String(255), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("changed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("changed_at", sa.DateTime(), nullable=False),
            sa.Column("metadata", sa.Text(), nullable=True),
        )
        op.create_index("ix_operator_level_history_operator_id", "operator_level_history", ["operator_id"])
        op.create_index("ix_operator_level_history_change_type", "operator_level_history", ["change_type"])
        op.create_index("ix_operator_level_history_changed_at", "operator_level_history", ["changed_at"])

    levels = sa.table(
        "operator_levels",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("color", sa.String),
        sa.column("icon", sa.String),
        sa.column("sort_order", sa.Integer),
        sa.column("is_active", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    now = datetime.utcnow()
    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(sa.text("SELECT code FROM operator_levels"))}
    seed_levels = [
        ("trainee", "Стажёр", "Адаптация и обучение", "#64748B", "seedling", 10),
        ("newbie", "Новичок", "Первые стабильные результаты на линии", "#0EA5E9", "sparkles", 20),
        ("operator", "Оператор", "Основной рабочий уровень", "#2563EB", "badge-check", 30),
        ("pro", "Профи", "Стабильно сильный оператор", "#A855F7", "crown", 40),
    ]
    level_rows = [
        {
            "code": code,
            "name": name,
            "description": description,
            "color": color,
            "icon": icon,
            "sort_order": sort_order,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        for code, name, description, color, icon, sort_order in seed_levels
        if code not in existing
    ]
    if level_rows:
        op.bulk_insert(levels, level_rows)

    rules = sa.table(
        "operator_level_rules",
        sa.column("level_id", sa.Integer),
        sa.column("metric_code", sa.String),
        sa.column("operator", sa.String),
        sa.column("value_min", sa.Float),
        sa.column("value_max", sa.Float),
        sa.column("is_required", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    ids = dict(bind.execute(sa.text("SELECT code, id FROM operator_levels")))
    if bind.execute(sa.text("SELECT COUNT(*) FROM operator_level_rules")).scalar() == 0:
        seed_rules = [
            ("trainee", "tenure_days", "between", 0, 7),
            ("newbie", "tenure_days", "between", 8, 30),
            ("newbie", "quality", "gte", 70, None),
            ("newbie", "penalty_minutes", "lte", None, 20),
            ("operator", "tenure_days", "gte", 30, None),
            ("operator", "quality", "gte", 80, None),
            ("operator", "kvz", "gte", 8, None),
            ("operator", "efficiency", "gte", 45, None),
            ("operator", "penalty_minutes", "lte", None, 10),
            ("pro", "tenure_days", "gte", 30, None),
            ("pro", "quality", "gte", 90, None),
            ("pro", "kvz", "gte", 10, None),
            ("pro", "efficiency", "gte", 50, None),
            ("pro", "penalty_minutes", "lte", None, 5),
            ("pro", "final_points", "gte", 150, None),
        ]
        rule_rows = [
            {
                "level_id": ids[code],
                "metric_code": metric,
                "operator": operator,
                "value_min": value_min,
                "value_max": value_max,
                "is_required": True,
                "created_at": now,
                "updated_at": now,
            }
            for code, metric, operator, value_min, value_max in seed_rules
            if code in ids
        ]
        if rule_rows:
            op.bulk_insert(rules, rule_rows)


def downgrade() -> None:
    for table in (
        "operator_level_history",
        "operator_level_assignments",
        "operator_level_rules",
        "operator_levels",
    ):
        if _table_exists(table):
            op.drop_table(table)
