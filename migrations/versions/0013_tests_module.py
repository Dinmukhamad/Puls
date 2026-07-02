"""Add Тесты module: tests, test_questions, test_answers, test_assignments,
test_attempts, test_attempt_answers.

Revision ID: 0013_tests_module
Revises: 0012_missing_fk_indexes
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0013_tests_module"
down_revision = "0012_missing_fk_indexes"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("tests"):
        op.create_table(
            "tests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("instruction", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
            sa.Column("time_limit_minutes", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("opens_at", sa.DateTime(), nullable=True),
            sa.Column("closes_at", sa.DateTime(), nullable=True),
            sa.Column("passing_percent", sa.Float(), nullable=False, server_default="70"),
            sa.Column("show_result_after_finish", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("show_correct_answers", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("allow_retake", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("reward_type", sa.String(32), nullable=False, server_default="none"),
            sa.Column("reward_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_min_percent", sa.Float(), nullable=False, server_default="70"),
            sa.Column("reward_mode", sa.String(32), nullable=False, server_default="fixed"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_tests_status", "tests", ["status"])

    if not _table_exists("test_questions"):
        op.create_table(
            "test_questions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("question_text", sa.Text(), nullable=False),
            sa.Column("question_type", sa.String(32), nullable=False, server_default="single_choice"),
            sa.Column("points", sa.Float(), nullable=False, server_default="1"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_questions_test_id", "test_questions", ["test_id"])

    if not _table_exists("test_answers"):
        op.create_table(
            "test_answers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("question_id", sa.Integer(), sa.ForeignKey("test_questions.id"), nullable=False),
            sa.Column("answer_text", sa.Text(), nullable=False),
            sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_answers_question_id", "test_answers", ["question_id"])

    if not _table_exists("test_assignments"):
        op.create_table(
            "test_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("target_type", sa.String(16), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_assignments_test_id", "test_assignments", ["test_id"])

    if not _table_exists("test_attempts"):
        op.create_table(
            "test_attempts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="in_progress"),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("score_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("max_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("score_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("questions_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_transaction_id", sa.Integer(), sa.ForeignKey("coin_transactions.id"), nullable=True),
            sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_attempts_test_id", "test_attempts", ["test_id"])
        op.create_index("ix_test_attempts_operator_id", "test_attempts", ["operator_id"])
        op.create_index("ix_test_attempts_status", "test_attempts", ["status"])
        op.create_unique_constraint(
            "uq_test_attempt_number", "test_attempts", ["test_id", "operator_id", "attempt_number"]
        )

    if not _table_exists("test_attempt_answers"):
        op.create_table(
            "test_attempt_answers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("test_attempts.id"), nullable=False),
            sa.Column("question_id", sa.Integer(), sa.ForeignKey("test_questions.id"), nullable=False),
            sa.Column("selected_answer_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("is_correct", sa.Boolean(), nullable=True),
            sa.Column("points_awarded", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_attempt_answers_attempt_id", "test_attempt_answers", ["attempt_id"])
        op.create_index("ix_test_attempt_answers_question_id", "test_attempt_answers", ["question_id"])
        op.create_unique_constraint(
            "uq_attempt_question", "test_attempt_answers", ["attempt_id", "question_id"]
        )


def downgrade() -> None:
    for table in ("test_attempt_answers", "test_attempts", "test_assignments",
                  "test_answers", "test_questions", "tests"):
        if _table_exists(table):
            op.drop_table(table)
"""Add Тесты module: tests, test_questions, test_answers, test_assignments,
test_attempts, test_attempt_answers.

Revision ID: 0013_tests_module
Revises: 0012_missing_fk_indexes
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0013_tests_module"
down_revision = "0012_missing_fk_indexes"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("tests"):
        op.create_table(
            "tests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("instruction", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
            sa.Column("time_limit_minutes", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("opens_at", sa.DateTime(), nullable=True),
            sa.Column("closes_at", sa.DateTime(), nullable=True),
            sa.Column("passing_percent", sa.Float(), nullable=False, server_default="70"),
            sa.Column("show_result_after_finish", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("show_correct_answers", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("allow_retake", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("reward_type", sa.String(32), nullable=False, server_default="none"),
            sa.Column("reward_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_min_percent", sa.Float(), nullable=False, server_default="70"),
            sa.Column("reward_mode", sa.String(32), nullable=False, server_default="fixed"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_tests_status", "tests", ["status"])

    if not _table_exists("test_questions"):
        op.create_table(
            "test_questions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("question_text", sa.Text(), nullable=False),
            sa.Column("question_type", sa.String(32), nullable=False, server_default="single_choice"),
            sa.Column("points", sa.Float(), nullable=False, server_default="1"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_questions_test_id", "test_questions", ["test_id"])

    if not _table_exists("test_answers"):
        op.create_table(
            "test_answers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("question_id", sa.Integer(), sa.ForeignKey("test_questions.id"), nullable=False),
            sa.Column("answer_text", sa.Text(), nullable=False),
            sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_answers_question_id", "test_answers", ["question_id"])

    if not _table_exists("test_assignments"):
        op.create_table(
            "test_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("target_type", sa.String(16), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_assignments_test_id", "test_assignments", ["test_id"])

    if not _table_exists("test_attempts"):
        op.create_table(
            "test_attempts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("tests.id"), nullable=False),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("operators.id"), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="in_progress"),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("score_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("max_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("score_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("questions_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_points", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reward_coins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reward_transaction_id", sa.Integer(), sa.ForeignKey("coin_transactions.id"), nullable=True),
            sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_attempts_test_id", "test_attempts", ["test_id"])
        op.create_index("ix_test_attempts_operator_id", "test_attempts", ["operator_id"])
        op.create_index("ix_test_attempts_status", "test_attempts", ["status"])
        op.create_unique_constraint(
            "uq_test_attempt_number", "test_attempts", ["test_id", "operator_id", "attempt_number"]
        )

    if not _table_exists("test_attempt_answers"):
        op.create_table(
            "test_attempt_answers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("test_attempts.id"), nullable=False),
            sa.Column("question_id", sa.Integer(), sa.ForeignKey("test_questions.id"), nullable=False),
            sa.Column("selected_answer_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("is_correct", sa.Boolean(), nullable=True),
            sa.Column("points_awarded", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_test_attempt_answers_attempt_id", "test_attempt_answers", ["attempt_id"])
        op.create_index("ix_test_attempt_answers_question_id", "test_attempt_answers", ["question_id"])
        op.create_unique_constraint(
            "uq_attempt_question", "test_attempt_answers", ["attempt_id", "question_id"]
        )


def downgrade() -> None:
    for table in ("test_attempt_answers", "test_attempts", "test_assignments",
                  "test_answers", "test_questions", "tests"):
        if _table_exists(table):
            op.drop_table(table)
