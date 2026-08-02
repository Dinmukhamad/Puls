"""Загрузка отчётов не должна занимать event loop.

Обработчик upload_period_files объявлен async (нужен await file.read()), но
внутри вызывает синхронный process_upload: sha256 по двум файлам до 15 МБ,
парсинг Excel и запись в БД. Если вызвать его напрямую, петля встанет на всё
время загрузки и сервер перестанет отвечать кому-либо — включая healthcheck.

Тест проверяет само свойство, а не наличие строки в коде: пока «долгая»
загрузка висит, соседний запрос обязан пройти.
"""
from __future__ import annotations

import threading
import time

from app.modules.reports import service

UPLOAD_URL = "/api/reports/period-report/upload"
STATUS_URL = "/api/reports/period-report/status"


def _files():
    return {
        "monthly_report_file": ("monthly.xlsx", b"fake-monthly-bytes", "application/vnd.ms-excel"),
        "report_file": ("report.xlsx", b"fake-report-bytes", "application/vnd.ms-excel"),
    }


HOLD_SECONDS = 20.0      # сколько «работает» загрузка
NEIGHBOUR_TIMEOUT = 5.0  # сколько ждём соседний запрос


def test_slow_upload_does_not_freeze_other_requests(client, monkeypatch):
    entered = threading.Event()      # process_upload начался
    release = threading.Event()      # можно отпускать загрузку

    def slow_process_upload(*args, **kwargs):
        entered.set()
        release.wait(timeout=HOLD_SECONDS)
        return {"ok": True, "idempotent": False, "checksum": "stub"}

    monkeypatch.setattr(service, "process_upload", slow_process_upload)

    upload_result: dict[str, object] = {}

    def do_upload():
        try:
            response = client.post(UPLOAD_URL, files=_files())
            upload_result["status"] = response.status_code
            upload_result["body"] = response.text
        except Exception as exc:                       # noqa: BLE001 — диагностика
            upload_result["error"] = repr(exc)

    uploader = threading.Thread(target=do_upload, daemon=True)
    uploader.start()
    try:
        assert entered.wait(timeout=10), "process_upload так и не был вызван"

        # Соседний запрос должен пройти, пока загрузка ещё висит. Таймаут
        # заведомо короче удержания: если работа идёт на event loop, ответа
        # не будет и httpx бросит ReadTimeout.
        started = time.monotonic()
        try:
            status_response = client.get(STATUS_URL, timeout=NEIGHBOUR_TIMEOUT)
        except Exception as exc:                       # noqa: BLE001
            raise AssertionError(
                "Пока шла загрузка, сервер не ответил на другой запрос за "
                f"{NEIGHBOUR_TIMEOUT} с ({exc!r}). Блокирующая работа выполняется "
                "на event loop — верните run_in_threadpool в upload_period_files."
            ) from exc
        elapsed = time.monotonic() - started
    finally:
        release.set()
        uploader.join(timeout=10)

    assert status_response.status_code == 200, status_response.text
    assert elapsed < NEIGHBOUR_TIMEOUT, (
        f"Соседний запрос ждал {elapsed:.1f} с — петля была занята загрузкой"
    )
    assert upload_result.get("status") == 200, upload_result
