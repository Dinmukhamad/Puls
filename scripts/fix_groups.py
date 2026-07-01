#!/usr/bin/env python3
"""
Объединяет 'Группа Динмухамада' → 'Пахриддинов Динмухамад'.
Каждый UPDATE — отдельное соединение, чтобы ошибка в одной таблице
не роняла всю транзакцию.
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
conn_params = dict(
    host=u.hostname, port=u.port or 5432,
    dbname=u.path.lstrip("/"),
    user=u.username, password=u.password,
    sslmode="require",
)

def run(sql, params=None):
    """Выполняет один SQL в отдельной автокоммит-транзакции."""
    conn = psycopg2.connect(**conn_params)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        rowcount = cur.rowcount
    except psycopg2.errors.UndefinedColumn:
        rowcount = -1   # нет такой колонки — нормально
    except Exception as e:
        print(f"  WARN: {e}")
        rowcount = -1
    finally:
        cur.close()
        conn.close()
    return rowcount

# Читаем группы
conn = psycopg2.connect(**conn_params)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT id, name FROM groups ORDER BY id")
groups = cur.fetchall()
cur.close()
conn.close()

print("Группы в БД:")
for gid, gname in groups:
    print(f"  #{gid}: '{gname}'")

old_id = next((gid for gid, gname in groups if gname == "Группа Динмухамада"), None)
new_id = next((gid for gid, gname in groups if gname == "Пахриддинов Динмухамад"), None)

if not old_id:
    print("\nДубль 'Группа Динмухамада' не найден — всё чисто")
    sys.exit(0)

if not new_id:
    print(f"\nТолько старая — переименовываем #{old_id}...")
    run("UPDATE operators SET group_name='Пахриддинов Динмухамад' WHERE group_id=%s", (old_id,))
    run("UPDATE groups SET name='Пахриддинов Динмухамад' WHERE id=%s", (old_id,))
    print("✓ Готово")
    sys.exit(0)

print(f"\nОбъединяем #{old_id} ('Группа Динмухамада') → #{new_id} ('Пахриддинов Динмухамад')\n")

# Таблицы с group_id — каждая в своей транзакции
tables = [
    "operators",
    "users",
    "operator_daily_metrics",
    "period_reports",
    "coin_transactions",
    "shop_purchases",
    "weekly_results",
    "operator_level_assignments",
    "test_results",
]

for table in tables:
    n = run(f"UPDATE {table} SET group_id=%s WHERE group_id=%s", (new_id, old_id))
    if n > 0:
        print(f"  ✓ {table}: {n} строк перенесено")
    elif n == 0:
        print(f"  — {table}: нет записей")
    # n == -1: нет колонки — молча пропускаем

# Обновляем текстовое поле group_name у операторов
n = run("UPDATE operators SET group_name='Пахриддинов Динмухамад' WHERE group_id=%s", (new_id,))
print(f"\n  ✓ operators.group_name обновлён ({n} строк)")

# Удаляем старую группу
n = run("DELETE FROM groups WHERE id=%s", (old_id,))
if n == 1:
    print(f"  ✓ Группа #{old_id} удалена")
else:
    print(f"  WARN: DELETE вернул {n}")

print("\n✓ Готово — обновите страницу (Ctrl+Shift+R)")
