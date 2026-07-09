"""Бейджи и достижения (ТЗ §7): achievements, operator_achievements.

Revision ID: 0025_achievements
Revises: 0024_weekly_accrual_engine
Create Date: 2026-07-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025_achievements"
down_revision = "0024_weekly_accrual_engine"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _table_exists("achievements"):
        op.create_table(
            "achievements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(64), nullable=False, unique=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("icon", sa.String(64), nullable=False, server_default="🏆"),
            sa.Column("condition_type", sa.String(32), nullable=False),
            sa.Column("condition_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_repeatable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_achievements_code", "achievements", ["code"], unique=True)
        op.create_index("ix_achievements_is_active", "achievements", ["is_active"])

        op.execute("""
            INSERT INTO achievements (code, title, description, icon, condition_type, condition_value, reward_coins, is_repeatable, is_active)
            VALUES
            ('top_3_week', 'Топ-3 недели', 'Попасть в топ-3 за неделю', '🥉', 'top_3_week', 3, 10, true, true),
            ('no_late_3_weeks', 'Без опозданий 3 недели', '3 недели подряд без опозданий', '⏰', 'no_late_streak', 3, 15, false, true),
            ('quality_star', 'Звезда качества', 'Качество 96%+ за неделю', '⭐', 'quality_threshold', 96, 10, true, true),
            ('calls_master', 'Мастер звонков', 'Лучший по звонкам за неделю', '📞', 'calls_leader_week', 0, 10, true, true),
            ('efficiency_top', 'Топ эффективности', 'Лучший по эффективности за неделю', '⚡', 'efficiency_leader_week', 0, 10, true, true),
            ('legend_team', 'Легенда команды', '1000 коинов всего начислено', '👑', 'total_coins', 1000, 50, false, true),
            ('helper', 'Помощник команды', 'Ручное начисление за помощь новичку', '🤝', 'manual', 0, 0, true, true),
            ('test_master', 'Знаток базы', 'Сдать тест на 90%+', '📚', 'test_score', 90, 10, true, true)
        """)

    if not _table_exists("operator_achievements"):
        op.create_table(
            "operator_achievements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False, index=True),
            sa.Column("achievement_id", sa.Integer(), sa.ForeignKey("achievements.id"), nullable=False, index=True),
            sa.Column("progress_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("times_awarded", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("last_awarded_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("operator_id", "achievement_id", name="uq_operator_achievement"),
        )
        op.create_index("ix_operator_achievements_is_completed", "operator_achievements", ["is_completed"])


def downgrade() -> None:
    if _table_exists("operator_achievements"):
        op.drop_table("operator_achievements")
    if _table_exists("achievements"):
        op.drop_table("achievements")
