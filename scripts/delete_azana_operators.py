#!/usr/bin/env python3
"""
Удаляет операторов Азаны — и из operators, и из users полностью.
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

db_url = os.environ["DATABASE_URL"]
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

import psycopg2
from urllib.parse import urlparse

u = urlparse(db_url.replace("postgresql+psycopg2://", "postgresql://"))
conn = psycopg2.connect(
    host=u.hostname, port=u.port or 5432,
    dbname=u.path.lstrip("/"),
    user=u.username, password=u.password,
    sslmode="require",
)
conn.autocommit = False
cur = conn.cursor()

NAMES_TO_DELETE = [
    "Ерланов Темирлан",
    "Жансерик Алихан",
    "Желдербай Бокен",
    "Зиноллаев Алишер",
    "Муктар Адилет",
    "Нургазы Жанеля",
    "Серикбаева Асел",
    "Токен Алмаз",
    "Шаяхмет Жаркынай",
]

def safe(sql, params=()):
    try:
        cur.execute("SAVEPOINT sp1")
        cur.execute(sql, params)
        cur.execute("RELEASE SAVEPOINT sp1")
        return cur.rowcount
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT sp1")
        return 0

# Найти пользователей со статусом deleted (остатки удалённых операторов)
cur.execute("SELECT id, full_name, username, operator_id FROM users WHERE status='deleted' OR username LIKE 'deleted_%'")
deleted_users = cur.fetchall()
print(f"Пользователи со статусом deleted: {len(deleted_users)}")
for uid, name, uname, oid in deleted_users:
    print(f"  user #{uid}: {name} ({uname})")

# Также найти операторов по ФИО (на случай если остались)
cur.execute("SELECT id, full_name, user_id FROM operators")
all_ops = cur.fetchall()
to_delete_ops = []
for oid, name, uid in all_ops:
    for part in NAMES_TO_DELETE:
        if part.lower() in name.lower():
            to_delete_ops.append((oid, name, uid))
            break

print(f"\nОператоры для удаления: {len(to_delete_ops)}")

TABLES = [
    "period_reports", "operator_daily_metrics",
    "operator_level_assignments", "operator_level_history",
    "coin_transactions", "shop_purchases",
    "lateness_records", "violations", "penalty_records",
    "test_results", "weekly_results", "rating_snapshots",
    "operator_audit_logs",
]

# Удаляем оставшихся операторов
for oid, name, uid in to_delete_ops:
    print(f"\n  Удаляю оператора #{oid}: {name}")
    for tbl in TABLES:
        safe(f"DELETE FROM {tbl} WHERE operator_id = %s", (oid,))
    safe("UPDATE audit_logs SET entity_id=NULL WHERE entity_type='operator' AND entity_id=%s", (oid,))
    if uid:
        safe("DELETE FROM users WHERE id=%s", (uid,))
    safe("UPDATE operators SET user_id=NULL, group_id=NULL WHERE id=%s", (oid,))
    safe("DELETE FROM operators WHERE id=%s", (oid,))
    print(f"    ✓ Оператор удалён")

# Полностью удаляем users со статусом deleted
print(f"\nУдаляю {len(deleted_users)} пользователей со статусом deleted...")
for uid, name, uname, oid in deleted_users:
    n = safe("DELETE FROM users WHERE id=%s", (uid,))
    print(f"  {'✓' if n else '—'} user #{uid}: {name}")

conn.commit()
cur.close()
conn.close()
print("\n✓ Готово")
