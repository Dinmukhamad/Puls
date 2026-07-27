"""
АДМИНИСТРАТИВНАЯ ДИАГНОСТИКА — показывает все тесты в системе и их
назначения, чтобы найти, какой именно тест/назначение вызывает сбой
в GET /api/tests/my (read-only, не вносит изменений).

Запуск:
    python scripts/diagnose_all_tests.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    if not os.getenv("DATABASE_URL"):
        print("DATABASE_URL не задан.", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from sqlalchemy import select

    from app.database.db import SessionLocal
    from app.models.entities import Operator, Test, TestAssignment, TestAttempt, TestQuestion

    db = SessionLocal()
    try:
        tests = list(db.scalars(select(Test).order_by(Test.id)))
        print(f"Всего тестов в системе: {len(tests)}\n")

        for t in tests:
            print(f"{'=' * 70}")
            print(f"Тест ID={t.id} '{t.title}'  status={t.status}")
            print(
                f"  opens_at={t.opens_at}  closes_at={t.closes_at}  time_limit={t.time_limit_minutes}мин"
            )
            print(f"  reward_type={t.reward_type} reward_mode={t.reward_mode}")

            questions = list(db.scalars(select(TestQuestion).where(TestQuestion.test_id == t.id)))
            print(f"  Вопросов: {len(questions)}")
            for q in questions:
                print(
                    f"    Q{q.id}: type={q.question_type} points={q.points} answers={len(q.answers)}"
                )

            assignments = list(
                db.scalars(select(TestAssignment).where(TestAssignment.test_id == t.id))
            )
            print(f"  Назначений: {len(assignments)}")
            for a in assignments:
                print(f"    target_type={a.target_type} target_id={a.target_id}")

            attempts = list(db.scalars(select(TestAttempt).where(TestAttempt.test_id == t.id)))
            print(f"  Попыток всего: {len(attempts)}")
            for at in attempts:
                op = db.get(Operator, at.operator_id)
                print(
                    f"    attempt={at.id} operator={op.full_name if op else '???'}(id={at.operator_id}) status={at.status}"
                )

        # Проверим конкретно оператора Атагельдиева — какие тесты ему видны
        print(
            f"\n{'=' * 70}\nПроверка видимости для Атагельдиева Акнур (operator_id=21):\n{'=' * 70}"
        )
        op21 = db.get(Operator, 21)
        if op21:
            for t in tests:
                if t.status not in ("open", "finished"):
                    print(f"  Тест {t.id} '{t.title}': SKIP (status={t.status}, не open/finished)")
                    continue
                assignments = list(
                    db.scalars(select(TestAssignment).where(TestAssignment.test_id == t.id))
                )
                visible = False
                for a in assignments:
                    if a.target_type == "all":
                        visible = True
                    elif a.target_type == "group" and op21.group_id == a.target_id:
                        visible = True
                    elif a.target_type == "operator" and op21.id == a.target_id:
                        visible = True
                print(
                    f"  Тест {t.id} '{t.title}': visible={visible} (assignments={[(a.target_type, a.target_id) for a in assignments]}, operator.group_id={op21.group_id})"
                )

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
