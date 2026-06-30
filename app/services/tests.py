"""
Бизнес-логика модуля «Тесты»: проверка прав доступа оператора к тесту,
старт/продолжение попытки, проверка ответов, расчёт результата и
начисление награды.

Ключевые инварианты:
  - is_correct/correct_answer_ids НИКОГДА не возвращаются оператору до
    завершения попытки (см. ТЗ п.20) — все сериализаторы для оператора
    проходят через safe_question_payload(), которая обрезает эти поля.
  - Таймер хранится на сервере (test_attempts.expires_at) — фронтенд
    вычисляет остаток как expires_at - now(), что защищает от
    "перезапуска через F5" (ТЗ п.7.3).
  - Награда начисляется максимум один раз за попытку (reward_transaction_id
    как защёлка — если уже заполнен, повторное начисление не происходит).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Operator, Test, TestAnswerOption, TestAssignment, TestAttempt,
    TestAttemptAnswer, TestQuestion, User, now_utc,
)
from app.services.coins import add_transaction


# ── Видимость и назначение ──────────────────────────────────────────

def is_test_assigned_to_operator(db: Session, test: Test, operator: Operator) -> bool:
    assignments = list(db.scalars(select(TestAssignment).where(TestAssignment.test_id == test.id)))
    if not assignments:
        return False  # тест без назначений никому не виден — это безопасный дефолт
    for a in assignments:
        if a.target_type == "all":
            return True
        if a.target_type == "group" and operator.group_id == a.target_id:
            return True
        if a.target_type == "operator" and operator.id == a.target_id:
            return True
    return False


def activate_scheduled_tests(db: Session) -> int:
    """
    Лениво переводит тесты из status='scheduled' в 'open', если наступило
    время opens_at. Без этого тест навсегда оставался "Запланирован" после
    нажатия "Опубликовать" — статус менялся только в момент самого клика
    (см. publish_test), и если opens_at был в будущем, ничто потом не
    пересматривало его снова: ни оператор не видел тест по факту наступления
    времени, ни админ не получал автоматического перехода без повторного
    ручного нажатия "Опубликовать". Вызывается перед каждым чтением списка
    тестов — дешёвая проверка (один UPDATE по условию), не требует cron/воркера.
    """
    now = now_utc()
    updated = db.execute(
        select(Test).where(Test.status == "scheduled", Test.opens_at.is_not(None), Test.opens_at <= now)
    ).scalars().all()
    for t in updated:
        t.status = "open"
    if updated:
        db.flush()
    return len(updated)


def visible_tests_for_operator(db: Session, operator: Operator) -> List[Test]:
    """
    Оптимизированная версия: вместо отдельного SELECT на test_assignments
    для КАЖДОГО теста (N+1 — при 20 тестах это 20 лишних запросов на
    каждый заход оператора в раздел), загружаем ВСЕ назначения для всех
    видимых тестов ОДНИМ запросом и фильтруем в памяти.
    """
    activate_scheduled_tests(db)
    all_tests = list(
        db.scalars(
            select(Test).where(Test.status.in_(["open", "finished"])).order_by(Test.opens_at.desc().nullslast())
        )
    )
    if not all_tests:
        return []

    test_ids = [t.id for t in all_tests]
    all_assignments = list(
        db.scalars(select(TestAssignment).where(TestAssignment.test_id.in_(test_ids)))
    )
    assignments_by_test: Dict[int, List[TestAssignment]] = {}
    for a in all_assignments:
        assignments_by_test.setdefault(a.test_id, []).append(a)

    def is_assigned(test: Test) -> bool:
        for a in assignments_by_test.get(test.id, []):
            if a.target_type == "all":
                return True
            if a.target_type == "group" and operator.group_id == a.target_id:
                return True
            if a.target_type == "operator" and operator.id == a.target_id:
                return True
        return False

    return [t for t in all_tests if is_assigned(t)]


# ── Статусы для оператора ────────────────────────────────────────────

def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Защитный второй уровень: некоторые записи в БД могли сохраниться с
    timezone-aware datetime ДО того как добавился _strip_tzinfo на уровне
    Pydantic-схем (см. tests.py router) — без этой нормализации сравнение
    now_utc() > test.closes_at бросает TypeError, которое тихо обрывало
    проверку статуса теста, из-за чего тест никогда не переходил в
    "expired" и продолжал быть доступным для прохождения после closes_at.
    """
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def operator_test_status(test: Test, attempt: Optional[TestAttempt], now: Optional[datetime] = None) -> str:
    """upcoming | available | in_progress | finished | expired | unavailable"""
    now = _naive(now) or now_utc()

    if attempt and attempt.status == "finished":
        return "finished"
    if attempt and attempt.status == "in_progress":
        if attempt.expires_at and now > _naive(attempt.expires_at):
            return "expired"  # таймер истёк, но finish ещё не вызван — клиент должен сам вызвать finish
        return "in_progress"

    if test.status != "open":
        return "unavailable"
    if test.opens_at and now < _naive(test.opens_at):
        return "upcoming"
    if test.closes_at and now > _naive(test.closes_at):
        return "expired"
    return "available"


def can_start_attempt(db: Session, test: Test, operator: Operator) -> tuple[bool, Optional[str]]:
    now = now_utc()
    if test.status != "open":
        return False, "Тест недоступен"
    if test.opens_at and now < _naive(test.opens_at):
        return False, f"Тест откроется {test.opens_at.strftime('%d.%m.%Y в %H:%M')}"
    if test.closes_at and now > _naive(test.closes_at):
        return False, "Срок прохождения истёк"

    existing_attempts = list(
        db.scalars(
            select(TestAttempt).where(
                TestAttempt.test_id == test.id, TestAttempt.operator_id == operator.id
            ).order_by(TestAttempt.attempt_number.desc())
        )
    )
    in_progress = next((a for a in existing_attempts if a.status == "in_progress"), None)
    if in_progress:
        return False, "Тест уже начат — продолжите текущую попытку"

    finished_count = sum(1 for a in existing_attempts if a.status == "finished")
    if finished_count > 0:
        if not test.allow_retake:
            return False, "Повторное прохождение не разрешено"
        if finished_count >= test.max_attempts:
            return False, "Достигнуто максимальное количество попыток"

    return True, None


# ── Старт попытки ────────────────────────────────────────────────────

def start_attempt(db: Session, test: Test, operator: Operator) -> TestAttempt:
    allowed, reason = can_start_attempt(db, test, operator)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)

    questions = list(db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id)))
    if not questions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="В тесте нет вопросов")

    prev_count = db.scalar(
        select(TestAttempt).where(TestAttempt.test_id == test.id, TestAttempt.operator_id == operator.id)
    )
    attempt_number = (
        db.execute(
            select(TestAttempt.attempt_number)
            .where(TestAttempt.test_id == test.id, TestAttempt.operator_id == operator.id)
            .order_by(TestAttempt.attempt_number.desc())
            .limit(1)
        ).scalar() or 0
    ) + 1

    now = now_utc()
    attempt = TestAttempt(
        test_id=test.id,
        operator_id=operator.id,
        status="in_progress",
        started_at=now,
        expires_at=now + timedelta(minutes=test.time_limit_minutes),
        max_points=sum(q.points for q in questions),
        questions_count=len(questions),
        attempt_number=attempt_number,
    )
    db.add(attempt)
    db.flush()
    return attempt


def get_active_or_recent_attempt(db: Session, test: Test, operator: Operator) -> Optional[TestAttempt]:
    return db.scalar(
        select(TestAttempt)
        .where(TestAttempt.test_id == test.id, TestAttempt.operator_id == operator.id)
        .order_by(TestAttempt.attempt_number.desc())
        .limit(1)
    )


# ── Сохранение черновика ответа ──────────────────────────────────────

def save_draft_answer(db: Session, attempt: TestAttempt, question_id: int, selected_answer_ids: List[int]) -> TestAttemptAnswer:
    if attempt.status != "in_progress":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Попытка уже завершена")
    if now_utc() > attempt.expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Время теста истекло")

    question = db.get(TestQuestion, question_id)
    if not question or question.test_id != attempt.test_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Вопрос не найден в этом тесте")

    existing = db.scalar(
        select(TestAttemptAnswer).where(
            TestAttemptAnswer.attempt_id == attempt.id, TestAttemptAnswer.question_id == question_id
        )
    )
    target = existing or TestAttemptAnswer(attempt_id=attempt.id, question_id=question_id)
    target.selected_answer_ids_json = json.dumps(selected_answer_ids)
    if not existing:
        db.add(target)
    return target


# ── Проверка ответов и завершение попытки ────────────────────────────

def _check_answer(question: TestQuestion, selected_ids: List[int]) -> tuple[bool, float]:
    """
    Правило из ТЗ п.13: для multiple_choice ответ верен ТОЛЬКО если выбраны
    ВСЕ правильные варианты и НИ ОДНОГО лишнего (точное совпадение множеств).
    Для single_choice — совпадение единственного выбранного варианта.
    """
    correct_ids = {a.id for a in question.answers if a.is_correct}
    selected_set = set(selected_ids)
    is_correct = selected_set == correct_ids and len(selected_set) > 0
    points = question.points if is_correct else 0.0
    return is_correct, points


def finish_attempt(db: Session, attempt: TestAttempt, reviewer: Optional[User] = None) -> TestAttempt:
    """
    Завершает попытку: проверяет все ответы (включая неотвеченные вопросы —
    считаются неправильными, см. ТЗ п.7.2), считает итоговый балл и процент,
    начисляет награду если применимо. Идемпотентна — повторный вызов на уже
    finished попытке просто возвращает её без пересчёта.
    """
    if attempt.status == "finished":
        return attempt

    test = attempt.test
    questions = {q.id: q for q in db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id))}

    existing_answers = {
        a.question_id: a
        for a in db.scalars(select(TestAttemptAnswer).where(TestAttemptAnswer.attempt_id == attempt.id))
    }

    total_score = 0.0
    correct_count = 0
    for qid, question in questions.items():
        answer_row = existing_answers.get(qid)
        selected_ids = json.loads(answer_row.selected_answer_ids_json) if answer_row else []
        is_correct, points = _check_answer(question, selected_ids)

        if answer_row:
            answer_row.is_correct = is_correct
            answer_row.points_awarded = points
        else:
            # Вопрос вообще не был отвечен — фиксируем как неправильный (ТЗ п.7.2)
            db.add(TestAttemptAnswer(
                attempt_id=attempt.id, question_id=qid,
                selected_answer_ids_json="[]", is_correct=False, points_awarded=0.0,
            ))

        if is_correct:
            correct_count += 1
            total_score += points

    max_points = sum(q.points for q in questions.values()) or 1.0
    percent = round(total_score / max_points * 100, 2)

    attempt.status = "finished"
    attempt.finished_at = now_utc()
    attempt.score_points = round(total_score, 2)
    attempt.max_points = max_points
    attempt.score_percent = percent
    attempt.correct_count = correct_count
    attempt.questions_count = len(questions)

    _maybe_award_reward(db, attempt, test, reviewer)
    return attempt


def auto_expire_attempt(db: Session, attempt: TestAttempt) -> TestAttempt:
    """
    Вызывается когда оператор открывает уже истёкшую по времени попытку —
    автоматическое завершение по таймеру (ТЗ п.7.2), с тем же расчётом
    результата, что и при обычном finish (ответы, которые успели сохраниться
    через save_draft_answer, учитываются; остальные — как неправильные).
    """
    return finish_attempt(db, attempt)


def _maybe_award_reward(db: Session, attempt: TestAttempt, test: Test, reviewer: Optional[User]) -> None:
    """
    Начисляет награду максимум один раз за попытку (защёлка
    reward_transaction_id). Режимы:
      fixed         — проходной % достигнут -> начисляется reward_points/reward_coins целиком
      proportional  — награда масштабируется пропорционально набранному % от 100%
    """
    if attempt.reward_transaction_id is not None:
        return  # уже начислено — повторное начисление запрещено (ТЗ п.15.4)
    if test.reward_type == "none":
        return
    if attempt.score_percent < test.reward_min_percent:
        return

    if test.reward_mode == "proportional":
        factor = min(1.0, attempt.score_percent / 100.0)
    else:
        factor = 1.0  # fixed — полная награда при достижении порога

    reward_points = round(test.reward_points * factor, 2) if test.reward_type in ("points", "points_and_coins") else 0.0
    reward_coins = round(test.reward_coins * factor) if test.reward_type in ("coins", "points_and_coins") else 0

    attempt.reward_points = reward_points
    attempt.reward_coins = reward_coins

    if reward_coins > 0:
        operator = db.get(Operator, attempt.operator_id)
        transaction = add_transaction(
            db, operator, reward_coins, "test_reward",
            f"Награда за прохождение теста: {test.title}",
            created_by=reviewer,
        )
        db.flush()
        attempt.reward_transaction_id = transaction.id


# ── Сериализация для оператора (БЕЗ is_correct до завершения) ───────

def safe_question_payload(question: TestQuestion) -> dict:
    """Никогда не включает is_correct — используется до завершения попытки."""
    return {
        "id": question.id,
        "question_text": question.question_text,
        "question_type": question.question_type,
        "points": question.points,
        "sort_order": question.sort_order,
        "answers": [
            {"id": a.id, "answer_text": a.answer_text, "sort_order": a.sort_order}
            for a in question.answers
        ],
    }


def full_question_payload(question: TestQuestion) -> dict:
    """Включает is_correct — используется ТОЛЬКО для админского конструктора и
    после завершения попытки (если test.show_correct_answers=True)."""
    payload = safe_question_payload(question)
    for a, src in zip(payload["answers"], question.answers):
        a["is_correct"] = src.is_correct
    return payload
