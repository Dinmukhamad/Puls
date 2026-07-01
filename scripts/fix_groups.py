#!/usr/bin/env python3
"""
Объединяет 'Группа Динмухамада' → 'Пахриддинов Динмухамад'
Обновляет все FK ссылки перед удалением.
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from app.models.entities import Group, Operator, User

db_url = os.environ["DATABASE_URL"]
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
db = sessionmaker(bind=engine)()

all_groups = list(db.scalars(select(Group)))
print("Группы в БД:")
for g in all_groups:
    print(f"  #{g.id}: '{g.name}'")

old_g = next((g for g in all_groups if g.name == "Группа Динмухамада"), None)
new_g = next((g for g in all_groups if g.name == "Пахриддинов Динмухамад"), None)

if not old_g:
    print("\nДубль 'Группа Динмухамада' не найден — всё чисто")
    db.close()
    sys.exit(0)

if not new_g:
    # Только старая — просто переименовываем
    print(f"\nТолько старая группа — переименовываем #{old_g.id}...")
    db.execute(text("UPDATE operators SET group_name='Пахриддинов Динмухамад' WHERE group_id=:gid"), {"gid": old_g.id})
    old_g.name = "Пахриддинов Динмухамад"
    db.commit()
    print("✓ Готово")
    db.close()
    sys.exit(0)

old_id = old_g.id
new_id = new_g.id
print(f"\nОбъединяем #{old_id} → #{new_id}")

# Обновляем ВСЕ таблицы которые ссылаются на group_id
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
    try:
        result = db.execute(
            text(f"UPDATE {table} SET group_id=:new WHERE group_id=:old"),
            {"new": new_id, "old": old_id}
        )
        if result.rowcount > 0:
            print(f"  {table}: перенесено {result.rowcount} строк")
    except Exception as e:
        if "column" in str(e).lower() and "group_id" in str(e).lower():
            pass  # таблица не имеет group_id — нормально
        else:
            print(f"  WARN {table}: {e}")

# Обновляем group_name у операторов
db.execute(
    text("UPDATE operators SET group_name='Пахриддинов Динмухамад' WHERE group_id=:gid"),
    {"gid": new_id}
)

# Удаляем старую группу
db.execute(text("DELETE FROM groups WHERE id=:gid"), {"gid": old_id})
db.commit()

print(f"\n✓ Группа #{old_id} удалена, всё перенесено в #{new_id}")
db.close()
