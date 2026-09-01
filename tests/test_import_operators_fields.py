"""
Разбор кадровой выгрузки в scripts/import_operators.py.

Что было не так: скрипт требовал колонку «Участвует», которой в кадровых
выгрузках нет — там «Статус» со значениями Работает / Б/С / Уволен /
Больничный. Импорт падал на первом же файле из отдела. Кроме того, ставка,
дата принятия и направление игнорировались, хотя поля для них в модели
оператора есть, а уволенные заводились как действующие сотрудники.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]


def _load_script():
    """scripts/ не пакет, поэтому подгружаем модуль по пути."""
    spec = importlib.util.spec_from_file_location(
        "import_operators_script", ROOT / "scripts" / "import_operators.py"
    )
    module = importlib.util.module_from_spec(spec)
    # dataclass внутри модуля требует, чтобы модуль был в sys.modules
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script()


def _workbook(tmp_path: Path, headers: list[str], rows: list[list]) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    path = tmp_path / "operators.xlsx"
    wb.save(path)
    return path


def test_old_format_with_participation_column(tmp_path: Path) -> None:
    """Файлы прежнего формата продолжают работать без изменений."""
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта", "Участвует"],
        [
            ["Иванов Иван", "ivanov@example.com", "Участвует"],
            ["Петров Пётр", "petrov@example.com", "Не участвует"],
        ],
    )
    rows, warnings, errors = script.parse_operator_rows(path)

    assert errors == []
    assert [r.participation_status for r in rows] == ["participating", "not_participating"]
    # Кадрового статуса в таком файле нет — считаем всех действующими.
    assert {r.employment_status for r in rows} == {"active"}
    assert warnings == []


def test_employment_status_column_maps_to_participation_and_employment(tmp_path: Path) -> None:
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта", "Статус", "Дата увольнения"],
        [
            ["Работающий Р", "r@example.com", "Работает", ""],
            ["Больничный Б", "b@example.com", "Больничный", ""],
            ["Без списания С", "s@example.com", "Б/С", ""],
            ["Уволенный У", "u@example.com", "Уволен", "2026-08-01"],
        ],
    )
    rows, _warnings, errors = script.parse_operator_rows(path)

    assert errors == []
    by_name = {r.full_name: r for r in rows}

    assert by_name["Работающий Р"].participation_status == "participating"
    assert by_name["Работающий Р"].employment_status == "active"

    # Больничный — человек в штате и в рейтинге остаётся.
    assert by_name["Больничный Б"].participation_status == "participating"
    assert by_name["Больничный Б"].employment_status == "active"

    # Б/С — работает, но в рейтинге не участвует.
    assert by_name["Без списания С"].participation_status == "not_participating"
    assert by_name["Без списания С"].employment_status == "active"

    dismissed = by_name["Уволенный У"]
    assert dismissed.employment_status == "dismissed"
    assert dismissed.participation_status == "not_participating"
    assert dismissed.dismissed_at == date(2026, 8, 1)


def test_dismissed_without_date_is_reported(tmp_path: Path) -> None:
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта", "Статус"],
        [["Уволенный У", "u@example.com", "Уволен"]],
    )
    _rows, warnings, _errors = script.parse_operator_rows(path)
    assert any("дата увольнения" in w.lower() for w in warnings)


def test_rate_start_date_and_position_are_read(tmp_path: Path) -> None:
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта", "Статус", "Ставка", "Дата принятия", "Направление"],
        [
            ["Иванов Иван", "ivanov@example.com", "Работает", "0,75", "2026-06-17", "Основа"],
            ["Петров Пётр", "petrov@example.com", "Работает", "1", "17.03.2025", "Чат менеджер"],
        ],
    )
    rows, _warnings, errors = script.parse_operator_rows(path)

    assert errors == []
    first, second = rows
    # Запятая как разделитель — обычное дело в выгрузках из Excel.
    assert first.rate == 0.75
    assert first.start_date == date(2026, 6, 17)
    assert first.position == "Основа"
    assert second.rate == 1.0
    # Второй распространённый формат даты.
    assert second.start_date == date(2025, 3, 17)
    assert second.position == "Чат менеджер"


def test_broken_rate_and_date_do_not_break_import(tmp_path: Path) -> None:
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта", "Статус", "Ставка", "Дата принятия"],
        [["Иванов Иван", "ivanov@example.com", "Работает", "полставки", "когда-то"]],
    )
    rows, _warnings, errors = script.parse_operator_rows(path)

    assert errors == []
    assert rows[0].rate is None
    assert rows[0].start_date is None


def test_file_without_status_columns_is_rejected(tmp_path: Path) -> None:
    path = _workbook(
        tmp_path,
        ["ФИО", "Почта"],
        [["Иванов Иван", "ivanov@example.com"]],
    )
    with pytest.raises(ValueError, match="участия или кадрового статуса"):
        script.parse_operator_rows(path)


def test_dismissed_operator_is_inactive() -> None:
    assert script._status_fields("participating", "dismissed") == ("inactive", False)
    assert script._status_fields("participating", "active") == ("active", True)
    assert script._status_fields("not_participating", "active") == ("inactive", False)
