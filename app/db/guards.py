"""
Защита журналов от изменения на уровне СУБД (п. 5 «История», «Аудит»).

Требование ТЗ - операции с коинами нельзя удалить или отредактировать. Одного
запрета в коде мало: прямой доступ к базе обошёл бы его, поэтому на таблицы
журналов вешаются триггеры, отклоняющие UPDATE и DELETE.

Один и тот же набор используется и при автосоздании схемы, и в миграции.
"""
from __future__ import annotations

#: Таблицы, доступные только на добавление.
APPEND_ONLY_TABLES = ("coin_transactions", "audit_log")

_MESSAGES = {
    "coin_transactions": "Журнал операций с коинами неизменяем",
    "audit_log": "Журнал аудита неизменяем",
}

_PG_FUNCTION = """
CREATE OR REPLACE FUNCTION forbid_append_only_write() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Таблица % доступна только на добавление', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
"""


def guard_statements(dialect_name: str) -> list[str]:
    """SQL, создающий защиту журналов для указанного диалекта."""
    if dialect_name == "sqlite":
        statements = []
        for table in APPEND_ONLY_TABLES:
            message = _MESSAGES[table]
            for action in ("UPDATE", "DELETE"):
                statements.append(
                    f"CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()} "
                    f"BEFORE {action} ON {table} "
                    f"BEGIN SELECT RAISE(ABORT, '{message}'); END;"
                )
        return statements

    if dialect_name == "postgresql":
        statements = [_PG_FUNCTION]
        for table in APPEND_ONLY_TABLES:
            statements.append(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table};")
            statements.append(
                f"CREATE TRIGGER {table}_append_only "
                f"BEFORE UPDATE OR DELETE ON {table} "
                f"FOR EACH ROW EXECUTE FUNCTION forbid_append_only_write();"
            )
        return statements

    # Прочие диалекты остаются без защиты на уровне БД: запрет действует
    # только через сервисный слой, который не предоставляет таких операций.
    return []


def drop_guard_statements(dialect_name: str) -> list[str]:
    """SQL, снимающий защиту (используется при откате миграции)."""
    if dialect_name == "sqlite":
        return [
            f"DROP TRIGGER IF EXISTS {table}_no_{action};"
            for table in APPEND_ONLY_TABLES
            for action in ("update", "delete")
        ]
    if dialect_name == "postgresql":
        return [
            f"DROP TRIGGER IF EXISTS {table}_append_only ON {table};"
            for table in APPEND_ONLY_TABLES
        ] + ["DROP FUNCTION IF EXISTS forbid_append_only_write();"]
    return []
