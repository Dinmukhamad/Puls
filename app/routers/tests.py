from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import (
    Operator,
    Test,
    TestAnswerOption,
    TestAssignment,
    TestAttempt,
    TestAttemptAnswer,
    TestQuestion,
    User,
    now_utc,
)
from app.services.coins import operator_for_user_or_403
from app.services.tests import (
    activate_scheduled_tests,
    auto_expire_attempt,
    finish_attempt,
    full_question_payload,
    get_active_or_recent_attempt,
    is_test_assigned_to_operator,
    operator_test_status,
    safe_question_payload,
    save_draft_answer,
    start_attempt,
    visible_tests_for_operator,
)

router = APIRouter(prefix="/tests", tags=["tests"])
admin_router = APIRouter(prefix="/admin/tests", tags=["tests-admin"])

logger = logging.getLogger(__name__)

STAFF_ROLES = ("supervisor", "manager", "admin")


def _strip_tzinfo(value: datetime | None) -> datetime | None:
    """
    Frontend отправляет opens_at/closes_at как ISO-строку с суффиксом Z
    (UTC), которую Pydantic парсит в timezone-AWARE datetime. Колонки
    tests.opens_at/closes_at в БД — naive DateTime (без timezone, как и
    now_utc() везде в проекте — naive UTC). Сравнение aware vs naive
    datetime в Python бросает TypeError — именно это происходило при
    проверке test.closes_at (now_utc() > test.closes_at), из-за чего тест
    физически не закрывался по достижении времени: исключение прерывало
    проверку статуса до того, как она доходила до сравнения с closes_at.
    Здесь явно убираем tzinfo сразу при разборе входных данных, оставляя
    числовое значение времени как есть (оно уже сконвертировано в UTC на
    фронтенде через .toISOString() перед отправкой).
    """
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo else value


def _utc_iso(dt: datetime | None) -> str | None:
    """
    Сериализует naive datetime (хранится как UTC, см. now_utc()) в ISO-строку
    с явным суффиксом Z. Без этого JavaScript (new Date(str)) интерпретирует
    строку без таймзоны как ЛОКАЛЬНОЕ время браузера, а не UTC — что приводило
    к смещению на величину часового пояса пользователя (опубликованные тесты
    оставались в статусе "Запланирован" дольше, чем реально нужно).
    """
    if dt is None:
        return None
    return dt.isoformat() + "Z"


def _require_staff(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ запрещён")
    return current_user


def _supervisor_group_ids(current_user: User) -> set | None:
    """
    Супервайзер видит/управляет только своей группой (ТЗ п.3.2). В модели
    User нет явного supervisor_group_id — используем operator_id оператора,
    привязанного к супервайзеру, как индикатор его группы (если привязан).
    Manager/admin не ограничиваются (None = без ограничения).
    """
    if current_user.role != "supervisor":
        return None
    return None  # без явного supervisor_group_id в модели User — пока не сужаем (как и в остальной системе, см. analytics.py)


# ══════════════════════════════════════════════════════════════════
# ОПЕРАТОРСКИЕ ЭНДПОИНТЫ
# ══════════════════════════════════════════════════════════════════

@router.get("/my")
def my_tests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    tests = visible_tests_for_operator(db, operator)
    db.commit()  # фиксируем возможный scheduled->open переход из activate_scheduled_tests

    if not tests:
        return {"items": []}

    test_ids = [t.id for t in tests]

    # Bulk-загрузка вместо N+1: раньше get_active_or_recent_attempt вызывалась
    # в цикле (1 SELECT на каждый тест), а t.questions лениво триггерила ещё
    # один SELECT на каждый тест — итого 1 + 2N запросов вместо 1 + 2.
    all_attempts = list(
        db.scalars(
            select(TestAttempt)
            .where(TestAttempt.test_id.in_(test_ids), TestAttempt.operator_id == operator.id)
            .order_by(TestAttempt.test_id, TestAttempt.attempt_number.desc())
        )
    )
    latest_attempt_by_test: dict[int, TestAttempt] = {}
    for a in all_attempts:
        if a.test_id not in latest_attempt_by_test:  # первая встреченная — самая свежая попытка (см. order_by выше)
            latest_attempt_by_test[a.test_id] = a

    all_questions = list(
        db.scalars(select(TestQuestion).where(TestQuestion.test_id.in_(test_ids)))
    )
    questions_by_test: dict[int, list] = {}
    for q in all_questions:
        questions_by_test.setdefault(q.test_id, []).append(q)

    items = []
    for t in tests:
        attempt = latest_attempt_by_test.get(t.id)
        op_status = operator_test_status(t, attempt)
        questions = questions_by_test.get(t.id, [])
        items.append({
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "status": op_status,
            "opens_at": _utc_iso(t.opens_at),
            "closes_at": _utc_iso(t.closes_at),
            "time_limit_minutes": t.time_limit_minutes,
            "questions_count": len(questions),
            "max_points": sum(q.points for q in questions),
            "reward_type": t.reward_type,
            "reward_points": t.reward_points,
            "reward_coins": t.reward_coins,
            "attempt_id": attempt.id if attempt else None,
            "attempt_status": attempt.status if attempt else None,
            "score_percent": attempt.score_percent if attempt and attempt.status == "finished" else None,
            "correct_count": attempt.correct_count if attempt and attempt.status == "finished" else None,
            "reward_coins_earned": attempt.reward_coins if attempt and attempt.status == "finished" else None,
        })
    return {"items": items}


@router.post("/{test_id}/start")
def start_test(test_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if not is_test_assigned_to_operator(db, test, operator):
        raise HTTPException(status_code=403, detail="Тест не назначен вам")

    existing = get_active_or_recent_attempt(db, test, operator)
    if existing and existing.status == "in_progress":
        if now_utc() > existing.expires_at:
            try:
                auto_expire_attempt(db, existing)
                db.commit()
            except Exception:
                # Если авто-завершение по таймеру упало (например ошибка в
                # подсчёте баллов) — раньше исключение улетало наружу БЕЗ
                # rollback и без изменения статуса попытки. Из-за этого
                # попытка навечно оставалась "in_progress", и при каждом
                # повторном заходе оператора в раздел система снова и снова
                # пыталась её авто-завершить, получая ту же ошибку — визуально
                # это выглядело как бесконечная загрузка страницы. Теперь
                # откатываем транзакцию и принудительно помечаем попытку
                # как "expired" отдельным простым UPDATE (без сложной логики
                # подсчёта баллов, которая и могла быть причиной сбоя),
                # чтобы оператор не застревал навсегда. Детали ошибки — только
                # в логи, клиенту внутренности не показываем (ТЗ 10.2).
                logger.exception("Авто-завершение просроченной попытки attempt_id=%s упало", existing.id)
                db.rollback()
                existing.status = "expired"
                existing.finished_at = now_utc()
                db.commit()
                raise HTTPException(status_code=400, detail="Время теста истекло") from None
            raise HTTPException(status_code=400, detail="Время теста истекло")
        attempt = existing
    else:
        attempt = start_attempt(db, test, operator)
        db.commit()
        db.refresh(attempt)

    questions = [safe_question_payload(q) for q in test.questions]
    return {
        "attempt_id": attempt.id,
        "test_title": test.title,
        "instruction": test.instruction,
        "time_limit_minutes": test.time_limit_minutes,
        "started_at": _utc_iso(attempt.started_at),
        "expires_at": _utc_iso(attempt.expires_at),
        "questions": questions,
        "attempt_number": attempt.attempt_number,
    }


class SaveAnswerPayload(BaseModel):
    question_id: int
    selected_answer_ids: list[int] = Field(default_factory=list)


@router.post("/attempts/{attempt_id}/save-answer")
def save_answer(
    attempt_id: int, payload: SaveAnswerPayload,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    attempt = db.get(TestAttempt, attempt_id)
    if not attempt or attempt.operator_id != operator.id:
        raise HTTPException(status_code=404, detail="Попытка не найдена")

    save_draft_answer(db, attempt, payload.question_id, payload.selected_answer_ids)
    db.commit()
    return {"ok": True}


@router.post("/attempts/{attempt_id}/finish")
def finish_test(attempt_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    attempt = db.get(TestAttempt, attempt_id)
    if not attempt or attempt.operator_id != operator.id:
        raise HTTPException(status_code=404, detail="Попытка не найдена")

    try:
        finish_attempt(db, attempt, reviewer=None)
        db.commit()
        db.refresh(attempt)
        # ТЗ 11.1: после сохранения результата теста — проверка правил колеса.
        # Обёртка изолирована (своя сессия + подавление ошибок), поэтому сбой
        # колеса не влияет на завершение теста.
        from app.services.wheel_eligibility import notify_test_attempt_finished
        notify_test_attempt_finished(attempt.id)
        return _attempt_result_payload(attempt, attempt.test)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        # Полный traceback — в логи сервера; клиенту — только понятное сообщение
        # без внутренних путей и деталей исключения (ТЗ P0.2 / 10.2).
        logger.exception("Не удалось завершить попытку теста attempt_id=%s", attempt_id)
        raise HTTPException(
            status_code=500,
            detail="Не удалось завершить тест. Попробуйте позже или обратитесь к администратору.",
        ) from None


@router.get("/attempts/{attempt_id}/result")
def get_result(attempt_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    attempt = db.get(TestAttempt, attempt_id)
    if not attempt or attempt.operator_id != operator.id:
        raise HTTPException(status_code=404, detail="Попытка не найдена")

    if attempt.status == "in_progress" and now_utc() > attempt.expires_at:
        auto_expire_attempt(db, attempt)
        db.commit()
        db.refresh(attempt)

    return _attempt_result_payload(attempt, attempt.test)


def _attempt_result_payload(attempt: TestAttempt, test: Test) -> dict:
    payload = {
        "attempt_id": attempt.id,
        "test_title": test.title,
        "status": attempt.status,
        "correct_count": attempt.correct_count,
        "questions_count": attempt.questions_count,
        "score_percent": attempt.score_percent,
        "score_points": attempt.score_points,
        "max_points": attempt.max_points,
        "passed": attempt.score_percent >= test.passing_percent if attempt.status == "finished" else None,
        "reward_points": attempt.reward_points,
        "reward_coins": attempt.reward_coins,
        "show_result": test.show_result_after_finish,
    }
    if test.show_correct_answers and attempt.status == "finished":
        payload["questions"] = [full_question_payload(q) for q in test.questions]
        payload["your_answers"] = {
            a.question_id: json.loads(a.selected_answer_ids_json)
            for a in attempt.answers
        }
    return payload


# ══════════════════════════════════════════════════════════════════
# АДМИНСКИЕ ЭНДПОИНТЫ (supervisor / manager / admin)
# ══════════════════════════════════════════════════════════════════

class AnswerOptionPayload(BaseModel):
    answer_text: str
    is_correct: bool = False
    sort_order: int = 0


class QuestionPayload(BaseModel):
    question_text: str
    question_type: str = Field(pattern="^(single_choice|multiple_choice)$")
    points: float = 1.0
    sort_order: int = 0
    answers: list[AnswerOptionPayload] = Field(default_factory=list, min_length=2, max_length=10)


class TestCreatePayload(BaseModel):
    title: str
    description: str = ""
    instruction: str = ""
    time_limit_minutes: int = 30
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    passing_percent: float = 70.0
    show_result_after_finish: bool = True
    show_correct_answers: bool = False
    allow_retake: bool = False
    max_attempts: int = 1
    reward_type: str = Field(default="none", pattern="^(none|points|coins|points_and_coins)$")
    reward_points: float = 0
    reward_coins: int = 0
    reward_min_percent: float = 70.0
    reward_mode: str = Field(default="fixed", pattern="^(fixed|proportional)$")

    @field_validator("opens_at", "closes_at")
    @classmethod
    def _strip_tz(cls, v):
        return _strip_tzinfo(v)


class TestUpdatePayload(BaseModel):
    title: str | None = None
    description: str | None = None
    instruction: str | None = None
    time_limit_minutes: int | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    passing_percent: float | None = None
    show_result_after_finish: bool | None = None
    show_correct_answers: bool | None = None
    allow_retake: bool | None = None
    max_attempts: int | None = None
    reward_type: str | None = None
    reward_points: float | None = None
    reward_coins: int | None = None
    reward_min_percent: float | None = None
    reward_mode: str | None = None

    @field_validator("opens_at", "closes_at")
    @classmethod
    def _strip_tz(cls, v):
        return _strip_tzinfo(v)


class AssignPayload(BaseModel):
    target_type: str = Field(pattern="^(all|group|operator)$")
    target_ids: list[int] = Field(default_factory=list)  # для group/operator — список ID; для all — игнорируется


def _test_summary(db: Session, t: Test) -> dict:
    attempts = list(db.scalars(select(TestAttempt).where(TestAttempt.test_id == t.id)))
    finished = [a for a in attempts if a.status == "finished"]
    avg_percent = round(sum(a.score_percent for a in finished) / len(finished), 1) if finished else None
    assignments = list(db.scalars(select(TestAssignment).where(TestAssignment.test_id == t.id)))
    return {
        "id": t.id,
        "title": t.title,
        "status": t.status,
        "created_by_name": t.created_by.full_name if t.created_by else None,
        "opens_at": _utc_iso(t.opens_at),
        "closes_at": _utc_iso(t.closes_at),
        "time_limit_minutes": t.time_limit_minutes,
        "questions_count": len(t.questions),
        "assignments": [{"target_type": a.target_type, "target_id": a.target_id} for a in assignments],
        "attempts_started": len(attempts),
        "attempts_finished": len(finished),
        "average_percent": avg_percent,
    }


@admin_router.get("")
def list_tests(db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    activate_scheduled_tests(db)
    db.commit()
    tests = list(db.scalars(select(Test).order_by(Test.created_at.desc())))
    return {"items": _test_summaries_bulk(db, tests)}


def _test_summaries_bulk(db: Session, tests: list) -> list:
    """
    Batch-версия _test_summary для списков — раньше list_tests вызывала
    _test_summary(db, t) в цикле, и КАЖДЫЙ вызов делал 2 явных запроса
    (attempts, assignments) + 2 lazy-load (created_by, questions) — итого
    4N запросов на N тестов. Здесь все 4 типа данных загружаются ОДИН раз
    для всех тестов сразу, дальше группируются в памяти по test_id.
    """
    if not tests:
        return []
    test_ids = [t.id for t in tests]

    all_attempts = list(db.scalars(select(TestAttempt).where(TestAttempt.test_id.in_(test_ids))))
    attempts_by_test: dict[int, list] = {}
    for a in all_attempts:
        attempts_by_test.setdefault(a.test_id, []).append(a)

    all_assignments = list(db.scalars(select(TestAssignment).where(TestAssignment.test_id.in_(test_ids))))
    assignments_by_test: dict[int, list] = {}
    for a in all_assignments:
        assignments_by_test.setdefault(a.test_id, []).append(a)

    all_questions = list(db.scalars(select(TestQuestion).where(TestQuestion.test_id.in_(test_ids))))
    questions_count_by_test: dict[int, int] = {}
    for q in all_questions:
        questions_count_by_test[q.test_id] = questions_count_by_test.get(q.test_id, 0) + 1

    creator_ids = [t.created_by_user_id for t in tests if t.created_by_user_id]
    creators_by_id: dict[int, User] = {}
    if creator_ids:
        creators_by_id = {u.id: u for u in db.scalars(select(User).where(User.id.in_(creator_ids)))}

    result = []
    for t in tests:
        attempts = attempts_by_test.get(t.id, [])
        finished = [a for a in attempts if a.status == "finished"]
        avg_percent = round(sum(a.score_percent for a in finished) / len(finished), 1) if finished else None
        assignments = assignments_by_test.get(t.id, [])
        creator = creators_by_id.get(t.created_by_user_id) if t.created_by_user_id else None
        result.append({
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "created_by_name": creator.full_name if creator else None,
            "opens_at": _utc_iso(t.opens_at),
            "closes_at": _utc_iso(t.closes_at),
            "time_limit_minutes": t.time_limit_minutes,
            "questions_count": questions_count_by_test.get(t.id, 0),
            "assignments": [{"target_type": a.target_type, "target_id": a.target_id} for a in assignments],
            "attempts_started": len(attempts),
            "attempts_finished": len(finished),
            "average_percent": avg_percent,
        })
    return result


@admin_router.post("")
def create_test(payload: TestCreatePayload, db: Session = Depends(get_db), current_user: User = Depends(_require_staff)) -> dict:
    test = Test(**payload.model_dump(), created_by_user_id=current_user.id, status="draft")
    db.add(test)
    db.commit()
    db.refresh(test)
    return _test_summary(db, test)


@admin_router.patch("/{test_id}")
def update_test(test_id: int, payload: TestUpdatePayload, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if test.status == "open":
        # ТЗ п.26: открытый тест — нельзя менять вопросы/правильные ответы, только закрыть/продлить
        allowed_fields = {"closes_at", "status"}
        updates = payload.model_dump(exclude_unset=True)
        forbidden = set(updates.keys()) - allowed_fields
        if forbidden:
            raise HTTPException(status_code=400, detail=f"Тест уже открыт — нельзя менять: {', '.join(forbidden)}")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(test, key, value)
    db.commit()
    return _test_summary(db, test)


@admin_router.post("/{test_id}/questions")
def add_question(test_id: int, payload: QuestionPayload, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if test.status == "open":
        raise HTTPException(status_code=400, detail="Нельзя добавлять вопросы в открытый тест")

    correct_count = sum(1 for a in payload.answers if a.is_correct)
    if correct_count == 0:
        raise HTTPException(status_code=400, detail="Нужно отметить хотя бы один правильный вариант")
    if payload.question_type == "single_choice" and correct_count != 1:
        raise HTTPException(status_code=400, detail="Для одного правильного ответа должен быть отмечен ровно один вариант")

    question = TestQuestion(
        test_id=test.id, question_text=payload.question_text,
        question_type=payload.question_type, points=payload.points, sort_order=payload.sort_order,
    )
    db.add(question)
    db.flush()
    for a in payload.answers:
        db.add(TestAnswerOption(question_id=question.id, answer_text=a.answer_text, is_correct=a.is_correct, sort_order=a.sort_order))
    db.commit()
    db.refresh(question)
    return full_question_payload(question)


@admin_router.patch("/questions/{question_id}")
def update_question(question_id: int, payload: QuestionPayload, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    question = db.get(TestQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
    if question.test.status == "open":
        raise HTTPException(status_code=400, detail="Нельзя редактировать вопросы открытого теста")

    question.question_text = payload.question_text
    question.question_type = payload.question_type
    question.points = payload.points
    question.sort_order = payload.sort_order

    for old_answer in list(question.answers):
        db.delete(old_answer)
    db.flush()
    for a in payload.answers:
        db.add(TestAnswerOption(question_id=question.id, answer_text=a.answer_text, is_correct=a.is_correct, sort_order=a.sort_order))

    db.commit()
    db.refresh(question)
    return full_question_payload(question)


@admin_router.delete("/questions/{question_id}")
def delete_question(question_id: int, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    question = db.get(TestQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
    if question.test.status == "open":
        raise HTTPException(status_code=400, detail="Нельзя удалять вопросы открытого теста")
    db.delete(question)
    db.commit()
    return {"ok": True}


@admin_router.post("/{test_id}/assign")
def assign_test(test_id: int, payload: AssignPayload, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")

    for old in list(test.assignments):
        db.delete(old)
    db.flush()

    if payload.target_type == "all":
        db.add(TestAssignment(test_id=test.id, target_type="all", target_id=None))
    else:
        if not payload.target_ids:
            raise HTTPException(status_code=400, detail="Укажите хотя бы один ID")
        for tid in payload.target_ids:
            db.add(TestAssignment(test_id=test.id, target_type=payload.target_type, target_id=tid))

    db.commit()
    db.refresh(test)
    return _test_summary(db, test)


@admin_router.post("/{test_id}/publish")
def publish_test(test_id: int, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if not test.questions:
        raise HTTPException(status_code=400, detail="Нельзя опубликовать тест без вопросов")
    if not test.assignments:
        raise HTTPException(status_code=400, detail="Нельзя опубликовать тест без назначения")

    now = now_utc()
    if test.opens_at and now < test.opens_at:
        test.status = "scheduled"
    else:
        test.status = "open"
    db.commit()
    return _test_summary(db, test)


@admin_router.post("/{test_id}/close")
def close_test(test_id: int, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")
    test.status = "finished"
    db.commit()
    return _test_summary(db, test)


@admin_router.get("/{test_id}/results")
def get_results(
    test_id: int,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    _: User = Depends(_require_staff),
) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")

    q = (
        select(TestAttempt, Operator)
        .join(Operator, Operator.id == TestAttempt.operator_id)
        .where(TestAttempt.test_id == test_id)
        .order_by(TestAttempt.attempt_number.asc(), TestAttempt.started_at.desc())
    )
    if group_id:
        q = q.where(Operator.group_id == group_id)
    if operator_query:
        q = q.where(Operator.full_name.ilike(f"%{operator_query}%"))
    if status_filter:
        q = q.where(TestAttempt.status == status_filter)

    rows = []
    for attempt, operator in db.execute(q):
        rows.append({
            "attempt_id": attempt.id,
            "operator_id": operator.id,
            "operator_name": operator.full_name,
            "group_name": operator.group_name,
            "status": attempt.status,
            "started_at": _utc_iso(attempt.started_at),
            "finished_at": _utc_iso(attempt.finished_at),
            "duration_seconds": (
                (attempt.finished_at - attempt.started_at).total_seconds()
                if attempt.finished_at else None
            ),
            "correct_count": attempt.correct_count,
            "questions_count": attempt.questions_count,
            "score_percent": attempt.score_percent,
            "score_points": attempt.score_points,
            "reward_points": attempt.reward_points,
            "reward_coins": attempt.reward_coins,
            "attempt_number": attempt.attempt_number,
            "passed": attempt.score_percent >= test.passing_percent if attempt.status == "finished" else None,
        })
    return {"items": rows}


@admin_router.get("/{test_id}/analytics")
def get_analytics(test_id: int, db: Session = Depends(get_db), _: User = Depends(_require_staff)) -> dict:
    test = db.get(Test, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Тест не найден")

    assignments = list(db.scalars(select(TestAssignment).where(TestAssignment.test_id == test_id)))
    all_operators = list(db.scalars(select(Operator)))

    def is_assigned(op: Operator) -> bool:
        for a in assignments:
            if a.target_type == "all":
                return True
            if a.target_type == "group" and op.group_id == a.target_id:
                return True
            if a.target_type == "operator" and op.id == a.target_id:
                return True
        return False

    assigned_operators = [op for op in all_operators if is_assigned(op)]
    attempts = list(db.scalars(select(TestAttempt).where(TestAttempt.test_id == test_id)))
    started_operator_ids = {a.operator_id for a in attempts}
    finished = [a for a in attempts if a.status == "finished"]

    avg_percent = round(sum(a.score_percent for a in finished) / len(finished), 1) if finished else None
    avg_duration = None
    durations = [
        (a.finished_at - a.started_at).total_seconds() for a in finished if a.finished_at
    ]
    if durations:
        avg_duration = round(sum(durations) / len(durations))

    passed = sum(1 for a in finished if a.score_percent >= test.passing_percent)

    # Аналитика по вопросам — какие чаще вызывают ошибки (ТЗ п.17).
    # Раньше TestAttemptAnswer запрашивались отдельным SELECT на каждый
    # вопрос (N+1) — здесь загружаем все ответы по всем вопросам теста
    # одним запросом и группируем в памяти.
    questions = list(test.questions)
    question_ids = [q.id for q in questions]
    all_answers_flat = list(
        db.scalars(
            select(TestAttemptAnswer).where(
                TestAttemptAnswer.question_id.in_(question_ids), TestAttemptAnswer.is_correct.is_not(None)
            )
        )
    ) if question_ids else []
    answers_by_question: dict[int, list] = {}
    for a in all_answers_flat:
        answers_by_question.setdefault(a.question_id, []).append(a)

    question_stats = []
    for q in questions:
        q_answers = answers_by_question.get(q.id, [])
        correct = sum(1 for a in q_answers if a.is_correct)
        total = len(q_answers)
        question_stats.append({
            "question_id": q.id,
            "question_text": q.question_text,
            "correct_count": correct,
            "incorrect_count": total - correct,
            "error_percent": round((total - correct) / total * 100, 1) if total else None,
        })

    return {
        "total_assigned": len(assigned_operators),
        "started": len(started_operator_ids),
        "finished": len(finished),
        "not_started": len(assigned_operators) - len(started_operator_ids),
        "average_percent": avg_percent,
        "average_duration_seconds": avg_duration,
        "passed": passed,
        "failed": len(finished) - passed,
        "questions": question_stats,
    }
