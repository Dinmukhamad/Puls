"""
Диагностика: показывает opens_at/closes_at/status всех тестов "как есть" в БД,
чтобы проверить, реально ли closes_at сохраняется при создании/редактировании.

Запуск: python scripts/check_test_closes_at.py
"""
from __future__ import annotations
import os, sys
from pathlib import Path

def main() -> int:
    if not os.getenv("DATABASE_URL"):
        print("DATABASE_URL не задан.", file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from datetime import datetime, timezone
    from sqlalchemy import select
    from app.database.db import SessionLocal
    from app.models.entities import Test

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        tests = list(db.scalars(select(Test).order_by(Test.id)))
        print(f"Текущее время сервера (UTC): {now}\n")
        for t in tests:
            print(f"Тест ID={t.id} '{t.title}' status={t.status}")
            print(f"  opens_at={t.opens_at!r}")
            print(f"  closes_at={t.closes_at!r}")
            if t.closes_at:
                expired = now > t.closes_at
                print(f"  now > closes_at: {expired}")
            print()
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
