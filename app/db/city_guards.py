"""Append-only history of district land, guarded like the XP ledger, old migrations untouched."""


def city_guard_statements(dialect: str) -> list[str]:
    if dialect == "sqlite":
        return [
            f"CREATE TRIGGER IF NOT EXISTS city_events_no_{action.lower()} BEFORE {action} "
            "ON city_events BEGIN SELECT RAISE(ABORT, 'Журнал района неизменяем'); END;"
            for action in ("UPDATE", "DELETE")
        ]
    if dialect == "postgresql":
        return [
            "DROP TRIGGER IF EXISTS city_events_append_only ON city_events;",
            "CREATE TRIGGER city_events_append_only BEFORE UPDATE OR DELETE ON city_events "
            "FOR EACH ROW EXECUTE FUNCTION forbid_append_only_write();",
        ]
    return []


def drop_city_guard_statements(dialect: str) -> list[str]:
    if dialect == "sqlite":
        return [
            f"DROP TRIGGER IF EXISTS city_events_no_{action};" for action in ("update", "delete")
        ]
    if dialect == "postgresql":
        return ["DROP TRIGGER IF EXISTS city_events_append_only ON city_events;"]
    return []
