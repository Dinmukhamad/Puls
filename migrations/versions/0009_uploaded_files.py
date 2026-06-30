"""0009 uploaded report files

Revision ID: 0009_uploaded_files
Revises: 0008_period_reports
Create Date: 2026-06-30

Создаёт таблицу для хранения загруженных xlsx-файлов (Monthly Report, Report)
в БД, чтобы они не терялись при редеплое (раньше хранились in-memory).
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0009_uploaded_files"
down_revision = "0008_period_reports"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("uploaded_report_files"):
        op.create_table(
            "uploaded_report_files",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("file_kind", sa.String(32), nullable=False, unique=True),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content", sa.LargeBinary(), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(), nullable=False),
            sa.Column("uploaded_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
        op.create_index("ix_uploaded_report_files_file_kind", "uploaded_report_files", ["file_kind"])


def downgrade() -> None:
    pass
