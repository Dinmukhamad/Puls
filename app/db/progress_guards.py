"""Отдельная защита XP, не меняющая исторические миграции коинов."""


def progress_guard_statements(dialect: str) -> list[str]:
    if dialect == "sqlite":
        return [
            f"CREATE TRIGGER IF NOT EXISTS xp_entries_no_{action.lower()} BEFORE {action} "
            "ON xp_entries BEGIN SELECT RAISE(ABORT, 'XP ledger is append only'); END;"
            for action in ("UPDATE", "DELETE")
        ]
    if dialect == "postgresql":
        return [
            "DROP TRIGGER IF EXISTS xp_entries_append_only ON xp_entries;",
            "CREATE TRIGGER xp_entries_append_only BEFORE UPDATE OR DELETE ON xp_entries "
            "FOR EACH ROW EXECUTE FUNCTION forbid_append_only_write();",
        ]
    return []
