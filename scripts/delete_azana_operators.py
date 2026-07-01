#!/usr/bin/env python3
"""
Удаляет 9 операторов бывшей группы Сабыр Азана.
Запуск: python scripts/delete_azana_operators.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

db_url = os.environ["DATABASE_URL"]
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from app.models.entities import Operator, User

# Список email операторов Азаны
AZANA_EMAILS = {
    "erlanov_temirlan_co@yandextaxi.kz",
    "zhanserik_alikhan_co@yandextaxi.kz",
    "zhelderbai_boken_co@yandextaxi.kz",
    "zinollayev_alisher_co@yandextaxi.kz",
    "muktar_adilet_co@yandextaxi.kz",
    "nurgazy_zhanelya_co@yandextaxi.kz",
    "serikbayeva_assel_2_co@yandextaxi.kz",
    "token_almaz_co@yandextaxi.kz",
    "shayahmet_zharkynai_co@yandextaxi.kz",
}

engine = create_engine(db_url, pool_pre_ping=True)
db = sessionmaker(bind=engine)()
conn = db.connection()

def safe_exec(sql: str, params: dict) -> int:
    sp = f"sp_{abs(hash(sql+str(params))) % 100000}"
    conn.execute(text(f"SAVEPOINT {sp}"))
    try:
        r = conn.execute(text(sql), params)
        conn.execute(text(f"RELEASE SAVEPOINT {sp}"))
        return r.rowcount
    except Exception as e:
        conn.execute(text(f"ROLLBACK TO SAVEPOINT {sp}"))
        return 0

# Находим операторов
operators = list(db.scalars(
    select(Operator).where(Operator.email.in_(AZANA_EMAILS))
))

# Также ищем по ФИО если email не совпал
AZANA_NAMES = {
    "Ерланов Темирлан Ильясович",
    "Жансерик Алихан Русланулы",
    "Желдербай Бокен Мадиулы",
    "Зиноллаев Алишер Жоланович",
    "Муктар Адилет Мендиханулы",
    "Нургазы Жанеля Багдаткызы",
    "Серикбаева Асел Куралбеккызы",
    "Токен Алмаз Нургазыулы",
    "Шаяхмет Жаркынай Канапийкызы",
}
found_ids = {op.id for op in operators}
by_name = list(db.scalars(
    select(Operator).where(Operator.full_name.in_(AZANA_NAMES))
))
for op in by_name:
    if op.id not in found_ids:
        operators.append(op)
        found_ids.add(op.id)

print(f"Найдено операторов: {len(operators)}")
print()

if not operators:
    print("Операторы не найдены — возможно уже удалены")
    sys.exit(0)

for op in operators:
    print(f"  Удаляю: {op.full_name} (ID={op.id}, email={op.email})")
    oid = op.id
    uid = op.user_id

    TABLES = [
        "period_reports", "operator_daily_metrics",
        "operator_level_assignments", "operator_level_history",
        "coin_transactions", "shop_purchases",
        "lateness_records", "violations", "penalty_records",
        "test_results", "weekly_results", "rating_snapshots",
        "operator_audit_logs",
    ]
    for tbl in TABLES:
        safe_exec(f"DELETE FROM {tbl} WHERE operator_id = :oid", {"oid": oid})

    safe_exec(
        "UPDATE audit_logs SET entity_id = NULL WHERE entity_type='operator' AND entity_id=:oid",
        {"oid": oid}
    )

    if uid:
        safe_exec(
            """UPDATE users SET is_active=false, operator_id=NULL, status='deleted',
               username=CONCAT('deleted_', :oid, '_', username) WHERE id=:uid""",
            {"oid": oid, "uid": uid}
        )

    safe_exec("UPDATE operators SET user_id=NULL, group_id=NULL WHERE id=:oid", {"oid": oid})
    safe_exec("DELETE FROM operators WHERE id=:oid", {"oid": oid})
    print(f"    ✓ Удалён")

db.commit()
print(f"\n✓ Удалено {len(operators)} операторов")
db.close()
