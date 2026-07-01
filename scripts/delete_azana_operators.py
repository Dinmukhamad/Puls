#!/usr/bin/env python3
"""
Удаляет операторов бывшей группы Сабыр Азана.
Ищет по ФИО (более надёжно чем по email).
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

# Сначала покажем что есть в БД
print("=== Все операторы в БД ===")
cur.execute("SELECT id, full_name, email, group_id FROM operators ORDER BY full_name")
all_ops = cur.fetchall()
for op in all_ops:
    print(f"  #{op[0]}: {op[1]} | {op[2]} | group_id={op[3]}")

# Список для удаления — ищем по частичному совпадению ФИО
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

to_delete = []
for op_id, full_name, email, group_id in all_ops:
    for name_part in NAMES_TO_DELETE:
        if name_part.lower() in full_name.lower():
            to_delete.append((op_id, full_name, email))
            break

print(f"\n=== Найдено для удаления: {len(to_delete)} ===")
for oid, name, email in to_delete:
    print(f"  #{oid}: {name} | {email}")

if not to_delete:
    print("Никого не найдено!")
    sys.exit(0)

def safe(sql, params):
    try:
        cur.execute("SAVEPOINT sp1")
        cur.execute(sql, params)
        cur.execute("RELEASE SAVEPOINT sp1")
        return cur.rowcount
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT sp1")
        return 0

TABLES = [
    "period_reports", "operator_daily_metrics",
    "operator_level_assignments", "operator_level_history",
    "coin_transactions", "shop_purchases",
    "lateness_records", "violations", "penalty_records",
    "test_results", "weekly_results", "rating_snapshots",
    "operator_audit_logs",
]

print("\n=== Удаление ===")
for oid, name, email in to_delete:
    print(f"  Удаляю #{oid} {name}...")

    # Получаем user_id
    cur.execute("SELECT user_id FROM operators WHERE id = %s", (oid,))
    row = cur.fetchone()
    uid = row[0] if row else None

    # Удаляем историю
    for tbl in TABLES:
        safe(f"DELETE FROM {tbl} WHERE operator_id = %s", (oid,))

    # Обнуляем audit_logs
    safe("UPDATE audit_logs SET entity_id = NULL WHERE entity_type='operator' AND entity_id=%s", (oid,))

    # Деактивируем пользователя
    if uid:
        safe("UPDATE users SET is_active=false, operator_id=NULL, status='deleted', username=CONCAT('deleted_',%s,'_',username) WHERE id=%s", (oid, uid))

    # Обнуляем FK и удаляем оператора
    safe("UPDATE operators SET user_id=NULL, group_id=NULL WHERE id=%s", (oid,))
    safe("DELETE FROM operators WHERE id=%s", (oid,))
    print(f"    ✓ Готово")

conn.commit()
cur.close()
conn.close()
print(f"\n✓ Удалено {len(to_delete)} операторов")
