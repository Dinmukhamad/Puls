#!/usr/bin/env python3
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

"""
Объединяет дублирующие группы:
  "Группа Динмухамада" → переименовывает в "Пахриддинов Динмухамад"
  (если обе существуют — переносит операторов и удаляет дубль)
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.models.entities import Group, Operator, User

db_url = os.environ["DATABASE_URL"]
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
db = sessionmaker(bind=engine)()

# Все группы
all_groups = list(db.scalars(select(Group)))
print("Группы в БД:")
for g in all_groups:
    cnt_ops = len([o for o in db.scalars(select(Operator).where(Operator.group_id == g.id))])
    print(f"  #{g.id}: '{g.name}' — {cnt_ops} операторов")

# Найти дубли Динмухамада
old_g = next((g for g in all_groups if g.name == "Группа Динмухамада"), None)
new_g = next((g for g in all_groups if g.name == "Пахриддинов Динмухамад"), None)

if old_g and new_g:
    print(f"\nНайдены оба варианта:")
    print(f"  Старая: #{old_g.id} '{old_g.name}'")
    print(f"  Новая:  #{new_g.id} '{new_g.name}'")
    
    # Переносим операторов из старой в новую
    ops = list(db.scalars(select(Operator).where(Operator.group_id == old_g.id)))
    users = list(db.scalars(select(User).where(User.group_id == old_g.id)))
    
    print(f"\nПеренос {len(ops)} операторов и {len(users)} пользователей...")
    for op in ops:
        op.group_id   = new_g.id
        op.group_name = new_g.name
    for u in users:
        u.group_id = new_g.id
    
    db.delete(old_g)
    db.commit()
    print("✓ Старая группа удалена, операторы перенесены")

elif old_g and not new_g:
    print(f"\nТолько старая группа #{old_g.id} — переименовываем...")
    old_g.name = "Пахриддинов Динмухамад"
    # Обновляем group_name у операторов
    ops = list(db.scalars(select(Operator).where(Operator.group_id == old_g.id)))
    for op in ops:
        op.group_name = "Пахриддинов Динмухамад"
    db.commit()
    print("✓ Переименовано")

else:
    print("\nДублей не найдено — всё чисто")

db.close()

