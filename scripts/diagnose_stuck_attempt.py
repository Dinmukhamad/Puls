"""
АДМИНИСТРАТИВНАЯ ДИАГНОСТИКА — показывает детальное состояние теста/попытки
для конкретного оператора, чтобы найти причину систематической 500-ошибки
при завершении/авто-завершении теста. Не вносит изменений в БД (read-only).

Запуск:
    python scripts/diagnose_stuck_attempt.py --operator-name "Атагельдиева"
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--operator-name", required=True, help="Часть ФИО оператора (поиск ILIKE)")
    parser.add_argument("--allow-default-db", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not os.getenv("DATABASE_URL") and not args.allow_default_db:
        print("DATABASE_URL не задан.", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from sqlalchemy import select

    from app.database.db import SessionLocal
    from app.models.entities import (
        Operator,
        Test,
        TestAnswerOption,
        TestAttempt,
        TestAttemptAnswer,
        TestQuestion,
    )

    db = SessionLocal()
    try:
        operators = list(
            db.scalars(select(Operator).where(Operator.full_name.ilike(f"%{args.operator_name}%")))
        )
        if not operators:
            print(f"Оператор с именем, содержащим '{args.operator_name}', не найден.")
            return 0

        for op in operators:
            print(f"\n{'=' * 70}\nОператор: {op.full_name} (ID={op.id})\n{'=' * 70}")
            attempts = list(
                db.scalars(
                    select(TestAttempt)
                    .where(TestAttempt.operator_id == op.id)
                    .order_by(TestAttempt.id.desc())
                )
            )
            if not attempts:
                print("  Попыток тестов нет.")
                continue

            for a in attempts:
                test = db.get(Test, a.test_id)
                print(
                    f"\n  Попытка ID={a.id} (тест: {test.title if test else '???'}, test_id={a.test_id})"
                )
                print(f"    status={a.status}  attempt_number={a.attempt_number}")
                print(
                    f"    started_at={a.started_at}  expires_at={a.expires_at}  finished_at={a.finished_at}"
                )
                print(
                    f"    score_points={a.score_points}  max_points={a.max_points}  score_percent={a.score_percent}"
                )
                print(f"    correct_count={a.correct_count}  questions_count={a.questions_count}")
                print(
                    f"    reward_points={a.reward_points}  reward_coins={a.reward_coins}  reward_transaction_id={a.reward_transaction_id}"
                )

                if test:
                    questions = list(
                        db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id))
                    )
                    print(
                        f"    Тест: status={test.status} reward_type={test.reward_type} reward_mode={test.reward_mode} questions_in_test={len(questions)}"
                    )
                    for q in questions:
                        answers = list(
                            db.scalars(
                                select(TestAnswerOption).where(TestAnswerOption.question_id == q.id)
                            )
                        )
                        correct = [x.id for x in answers if x.is_correct]
                        print(
                            f"      Вопрос ID={q.id} type={q.question_type} points={q.points} answers_count={len(answers)} correct_ids={correct}"
                        )
                        if len(correct) == 0:
                            print(
                                f"        !!! ПРОБЛЕМА: у вопроса {q.id} НЕТ правильного ответа !!!"
                            )

                attempt_answers = list(
                    db.scalars(
                        select(TestAttemptAnswer).where(TestAttemptAnswer.attempt_id == a.id)
                    )
                )
                print(f"    Сохранённых ответов оператора: {len(attempt_answers)}")
                for aa in attempt_answers:
                    print(
                        f"      question_id={aa.question_id} selected={aa.selected_answer_ids_json} is_correct={aa.is_correct}"
                    )

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
