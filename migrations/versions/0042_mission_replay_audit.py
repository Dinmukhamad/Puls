"""Add replay audit fields and reward-once grants.

Revision ID: 0042_mission_replay_audit
Revises: 0041_repair_operator_account_links
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042_mission_replay_audit"
down_revision = "0041_repair_operator_account_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    if "mission_attempts" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("mission_attempts")}
    additions = (
        sa.Column("reward_eligible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_activity_at", sa.DateTime(), nullable=True),
        sa.Column("best_score_snapshot", sa.Float(), nullable=True),
        sa.Column("replay_of_attempt_id", sa.Integer(), nullable=True),
        sa.Column("close_reason", sa.String(length=80), nullable=True),
        sa.Column(
            "duration_anomalous",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    for column in additions:
        if column.name not in columns:
            op.add_column("mission_attempts", column)
    if connection.dialect.name == "postgresql":
        foreign_keys = {
            foreign_key.get("name")
            for foreign_key in inspector.get_foreign_keys("mission_attempts")
        }
        if "fk_mission_attempt_replay_of" not in foreign_keys:
            op.create_foreign_key(
                "fk_mission_attempt_replay_of",
                "mission_attempts",
                "mission_attempts",
                ["replay_of_attempt_id"],
                ["id"],
            )

    op.execute(
        """
        UPDATE mission_attempts
        SET last_activity_at = COALESCE(completed_at, started_at),
            active_duration_seconds = CASE
                WHEN active_duration_seconds IS NULL THEN
                    CASE WHEN duration_seconds > 900 THEN 900 ELSE duration_seconds END
                WHEN active_duration_seconds > 900 THEN 900
                ELSE active_duration_seconds
            END,
            duration_anomalous = CASE
                WHEN duration_seconds > 14400 THEN TRUE ELSE FALSE
            END
        """
    )
    op.execute(
        """
        UPDATE mission_attempts AS current_attempt
        SET reward_eligible = CASE
            WHEN current_attempt.reward_awarded = TRUE THEN TRUE
            WHEN EXISTS (
                SELECT 1
                FROM mission_attempts AS awarded_attempt
                WHERE awarded_attempt.operator_id = current_attempt.operator_id
                  AND awarded_attempt.mission_id = current_attempt.mission_id
                  AND awarded_attempt.mission_version = current_attempt.mission_version
                  AND awarded_attempt.reward_awarded = TRUE
            ) THEN FALSE
            ELSE TRUE
        END
        """
    )

    required = {"operators", "missions", "coin_transactions"}
    if not required.issubset(tables):
        return
    if "mission_reward_grants" not in tables:
        op.create_table(
            "mission_reward_grants",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "operator_id",
                sa.Integer(),
                sa.ForeignKey("operators.id"),
                nullable=False,
            ),
            sa.Column(
                "mission_id",
                sa.Integer(),
                sa.ForeignKey("missions.id"),
                nullable=False,
            ),
            sa.Column("mission_version", sa.Integer(), nullable=False),
            sa.Column(
                "attempt_id",
                sa.Integer(),
                sa.ForeignKey("mission_attempts.id"),
                nullable=False,
                unique=True,
            ),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("currency", sa.String(length=16), nullable=False, server_default="₡"),
            sa.Column(
                "transaction_id",
                sa.Integer(),
                sa.ForeignKey("coin_transactions.id"),
                nullable=True,
                unique=True,
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "operator_id",
                "mission_id",
                "mission_version",
                name="uq_mission_reward_grant_once",
            ),
        )
        op.create_index(
            "ix_mission_reward_grants_operator_id",
            "mission_reward_grants",
            ["operator_id"],
        )
        op.create_index(
            "ix_mission_reward_grants_mission_id",
            "mission_reward_grants",
            ["mission_id"],
        )
        op.create_index(
            "ix_mission_reward_grants_created_at",
            "mission_reward_grants",
            ["created_at"],
        )

    awarded = connection.execute(
        sa.text(
            """
            SELECT id, operator_id, mission_id, mission_version,
                   reward_amount_snapshot, reward_transaction_id,
                   COALESCE(completed_at, started_at) AS granted_at
            FROM mission_attempts
            WHERE reward_awarded = TRUE
            ORDER BY id
            """
        )
    ).mappings()
    seen: set[tuple[int, int, int]] = set()
    for row in awarded:
        key = (row["operator_id"], row["mission_id"], row["mission_version"])
        if key in seen:
            continue
        seen.add(key)
        connection.execute(
            sa.text(
                """
                INSERT INTO mission_reward_grants (
                    operator_id, mission_id, mission_version, attempt_id,
                    amount, currency, transaction_id, created_at
                ) VALUES (
                    :operator_id, :mission_id, :mission_version, :attempt_id,
                    :amount, :currency, :transaction_id, :created_at
                )
                """
            ),
            {
                "operator_id": row["operator_id"],
                "mission_id": row["mission_id"],
                "mission_version": row["mission_version"],
                "attempt_id": row["id"],
                "amount": row["reward_amount_snapshot"] or 0,
                "currency": "₡",
                "transaction_id": row["reward_transaction_id"],
                "created_at": row["granted_at"],
            },
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "mission_reward_grants" in tables:
        op.drop_table("mission_reward_grants")
    if "mission_attempts" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("mission_attempts")}
    if op.get_bind().dialect.name == "postgresql":
        foreign_keys = {
            foreign_key.get("name")
            for foreign_key in inspector.get_foreign_keys("mission_attempts")
        }
        if "fk_mission_attempt_replay_of" in foreign_keys:
            op.drop_constraint(
                "fk_mission_attempt_replay_of",
                "mission_attempts",
                type_="foreignkey",
            )
    for name in (
        "duration_anomalous",
        "close_reason",
        "replay_of_attempt_id",
        "best_score_snapshot",
        "last_activity_at",
        "reward_eligible",
    ):
        if name in columns:
            op.drop_column("mission_attempts", name)
