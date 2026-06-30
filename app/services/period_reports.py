"""
Сервис расчёта показателей операторов по загруженным Excel-файлам за выбранный период.

Источники:
  - Monthly Report: оценки качества звонков (несколько листов-проверяющих, одна
    таблица операторов на каждом, колонки = даты, ячейки = "100, 90, 100").
  - Report: отдельные листы — "Отработанные часы", "Звонки", "Эффективность",
    "Штрафы", "Тренинги", "Тех. сбои", "Офлайн активность". Колонки = даты,
    последняя колонка(и) = агрегаты ("Итого", "Всего (ч)" и т.п.) — игнорируются.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Tuple

import openpyxl


# Заголовки-агрегаты, которые нельзя путать с датами
_AGGREGATE_HEADERS = {
    "итого", "итого часов", "итого баллов", "итог", "итог часов",
    "средний балл", "кол-во", "план", "всего (ч)", "всего", "отн.",
    "квз", "база часов", "тех. сбои (ч)", "тренинги (ч)",
    "офлайн активность (ч)", "вып нормы (%)", "выработка",
    "ставка", "норма часов (ч)", "оператор", "фио",
}

_DATE_RE = re.compile(r"^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$")


def _normalize_name(name: str) -> str:
    """ФИО -> нормализованный ключ для сопоставления между файлами."""
    if not name:
        return ""
    s = re.sub(r"\s+", " ", str(name).strip().lower())
    return s


def _parse_header_date(value, year: int) -> Optional[date]:
    """Парсит заголовок колонки вида '15.06' в date(year, 6, 15). None если не дата."""
    if value is None:
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip().lower()
    if s in _AGGREGATE_HEADERS:
        return None
    m = _DATE_RE.match(s)
    if not m:
        return None
    day, month = int(m.group(1)), int(m.group(2))
    yr = int(m.group(3)) if m.group(3) else year
    if yr < 100:
        yr += 2000
    try:
        return date(yr, month, day)
    except ValueError:
        return None


def parse_scores(cell_value) -> List[float]:
    """'100, 90, 100' -> [100.0, 90.0, 100.0]. Пустая ячейка -> []."""
    if cell_value is None:
        return []
    s = str(cell_value).strip()
    if not s:
        return []
    out = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(float(part))
        except ValueError:
            continue
    return out


@dataclass
class QualityResult:
    scores: List[float] = field(default_factory=list)

    @property
    def avg(self) -> float:
        return round(sum(self.scores) / len(self.scores), 2) if self.scores else 0.0

    @property
    def count(self) -> int:
        return len(self.scores)


def parse_monthly_report(
    file_bytes: bytes,
    period_start: date,
    period_end: date,
    default_year: Optional[int] = None,
) -> Dict[str, QualityResult]:
    """
    Парсит Monthly Report — несколько листов, на каждом несколько таблиц
    (блоки "ФИО + даты"), под каждой шапкой строки операторов.

    Возвращает {normalized_name: QualityResult} — оценки суммируются по
    оператору со всех листов/проверяющих, попадающие в период.
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    year = default_year or period_start.year
    results: Dict[str, QualityResult] = {}
    display_names: Dict[str, str] = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        i = 0
        while i < len(rows):
            row = rows[i]
            if not row or not row[0]:
                i += 1
                continue
            first_cell = str(row[0]).strip().lower()
            # Заголовок блока — строка с "ФИО" в первой колонке
            if first_cell == "фио":
                header = row
                date_cols: List[Tuple[int, date]] = []
                for col_idx, h in enumerate(header):
                    d = _parse_header_date(h, year)
                    if d:
                        date_cols.append((col_idx, d))
                i += 1
                # Читаем строки операторов до следующего заголовка/конца листа
                while i < len(rows):
                    data_row = rows[i]
                    if not data_row or not data_row[0]:
                        i += 1
                        continue
                    cell0 = str(data_row[0]).strip()
                    if cell0.lower() == "фио" or "оценки" in cell0.lower():
                        break  # начался новый блок
                    name_key = _normalize_name(cell0)
                    if name_key not in results:
                        results[name_key] = QualityResult()
                        display_names[name_key] = cell0
                    qr = results[name_key]
                    for col_idx, d in date_cols:
                        if period_start <= d <= period_end and col_idx < len(data_row):
                            qr.scores.extend(parse_scores(data_row[col_idx]))
                    i += 1
                continue
            i += 1

    wb.close()
    # Прикрепим оригинальное отображаемое имя через атрибут
    for key, qr in results.items():
        qr.display_name = display_names.get(key, key)  # type: ignore[attr-defined]
    return results


@dataclass
class ReportSheetResult:
    """Сумма значений по датам периода для одного оператора на одном листе."""
    value: float = 0.0


def _parse_simple_sheet(
    ws,
    period_start: date,
    period_end: date,
    year: int,
    name_col: int = 0,
) -> Dict[str, float]:
    """
    Общий парсер для листов вида: первая колонка — ФИО, остальные — даты,
    последние колонки — агрегаты (Итого/Всего/КВЗ/...). Суммирует значения
    по датам, входящим в период.
    """
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {}
    header = rows[0]
    date_cols: List[Tuple[int, date]] = []
    for col_idx, h in enumerate(header):
        if col_idx == name_col:
            continue
        d = _parse_header_date(h, year)
        if d:
            date_cols.append((col_idx, d))

    out: Dict[str, float] = {}
    for row in rows[1:]:
        if not row or not row[name_col]:
            continue
        name_key = _normalize_name(row[name_col])
        total = 0.0
        for col_idx, d in date_cols:
            if period_start <= d <= period_end and col_idx < len(row):
                v = row[col_idx]
                if isinstance(v, (int, float)):
                    total += float(v)
        out[name_key] = out.get(name_key, 0.0) + total
    return out


REQUIRED_REPORT_SHEETS = [
    "Отработанные часы", "Звонки", "Эффективность",
    "Штрафы", "Тренинги", "Тех. сбои", "Офлайн активность",
]


def parse_report_file(
    file_bytes: bytes,
    period_start: date,
    period_end: date,
    default_year: Optional[int] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Парсит Report — возвращает:
      { sheet_name: { normalized_name: sum_for_period } }
    Бросает ValueError если обязательный лист отсутствует.
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    year = default_year or period_start.year

    missing = [s for s in REQUIRED_REPORT_SHEETS if s not in wb.sheetnames]
    if missing:
        wb.close()
        raise ValueError(f"В файле Report отсутствуют листы: {', '.join(missing)}")

    out: Dict[str, Dict[str, float]] = {}
    for sheet in REQUIRED_REPORT_SHEETS:
        ws = wb[sheet]
        out[sheet] = _parse_simple_sheet(ws, period_start, period_end, year)

    # Сохраняем отображаемые имена с первого листа для последующего вывода
    display_names: Dict[str, str] = {}
    ws0 = wb[REQUIRED_REPORT_SHEETS[0]]
    for row in ws0.iter_rows(values_only=True):
        if row and row[0] and str(row[0]).strip().lower() != "оператор":
            display_names[_normalize_name(row[0])] = str(row[0]).strip()
    out["_display_names"] = display_names  # type: ignore[assignment]

    wb.close()
    return out


@dataclass
class OperatorPeriodMetrics:
    full_name: str
    quality_avg: float = 0.0
    quality_calls_count: int = 0
    total_hours: float = 0.0
    base_hours: float = 0.0
    tech_issue_hours: float = 0.0
    training_hours: float = 0.0
    offline_activity_hours: float = 0.0
    calls_total: float = 0.0
    kvz: float = 0.0
    call_time_hours: float = 0.0
    efficiency_percent: float = 0.0
    penalty_sum: float = 0.0
    penalty_minutes: float = 0.0
    penalty_points: float = 0.0
    final_points: float = 0.0
    warnings: List[str] = field(default_factory=list)


PENALTY_RUB_PER_MINUTE = 50.0
PENALTY_POINTS_PER_MINUTE = 5.0


def compute_operator_metrics(
    name_key: str,
    display_name: str,
    quality: Optional[QualityResult],
    report_data: Dict[str, Dict[str, float]],
) -> OperatorPeriodMetrics:
    m = OperatorPeriodMetrics(full_name=display_name)

    # Качество
    if quality and quality.scores:
        m.quality_avg = quality.avg
        m.quality_calls_count = quality.count
    else:
        m.warnings.append("Нет оценок качества за период")

    # Часы
    m.total_hours = round(report_data.get("Отработанные часы", {}).get(name_key, 0.0), 2)
    m.tech_issue_hours = round(report_data.get("Тех. сбои", {}).get(name_key, 0.0), 2)
    m.training_hours = round(report_data.get("Тренинги", {}).get(name_key, 0.0), 2)
    m.offline_activity_hours = round(report_data.get("Офлайн активность", {}).get(name_key, 0.0), 2)

    base = m.total_hours - m.tech_issue_hours - m.training_hours - m.offline_activity_hours
    if base < 0:
        m.warnings.append("База часов получилась отрицательной. Проверьте тренинги, техсбои и офлайн-активность.")
        base = 0.0
    m.base_hours = round(base, 2)

    # Звонки / КВЗ
    m.calls_total = round(report_data.get("Звонки", {}).get(name_key, 0.0), 2)
    if m.base_hours > 0:
        m.kvz = round(m.calls_total / m.base_hours, 2)
    else:
        m.kvz = 0.0
        m.warnings.append("Нет базы часов за выбранный период.")

    # Эффективность (лист "Эффективность" хранит часы в звонке)
    m.call_time_hours = round(report_data.get("Эффективность", {}).get(name_key, 0.0), 2)
    if m.base_hours > 0:
        m.efficiency_percent = round(m.call_time_hours / m.base_hours * 100, 2)
    else:
        m.efficiency_percent = 0.0
        if "Нет базы часов за выбранный период." not in m.warnings:
            m.warnings.append("Нет базы часов для расчёта эффективности.")

    # Штрафы
    m.penalty_sum = round(report_data.get("Штрафы", {}).get(name_key, 0.0), 2)
    m.penalty_minutes = round(m.penalty_sum / PENALTY_RUB_PER_MINUTE, 2) if m.penalty_sum else 0.0
    m.penalty_points = round(m.penalty_minutes * PENALTY_POINTS_PER_MINUTE, 2)

    # Итоговые баллы
    m.final_points = round(
        m.quality_avg + m.kvz + m.total_hours + m.efficiency_percent - m.penalty_points,
        2,
    )

    return m


@dataclass
class PeriodCalculationResult:
    operators: List[OperatorPeriodMetrics]
    cross_warnings: List[Dict[str, str]]


def calculate_period_report(
    monthly_report_bytes: bytes,
    report_bytes: bytes,
    period_start: date,
    period_end: date,
) -> PeriodCalculationResult:
    if period_start > period_end:
        raise ValueError("Дата начала не может быть позже даты окончания")

    quality_map = parse_monthly_report(monthly_report_bytes, period_start, period_end)
    report_data = parse_report_file(report_bytes, period_start, period_end)
    display_names_report = report_data.pop("_display_names", {})  # type: ignore[arg-type]

    all_keys = set(quality_map.keys()) | set(display_names_report.keys())
    for sheet_data in report_data.values():
        all_keys |= set(sheet_data.keys())
    all_keys.discard("")

    cross_warnings: List[Dict[str, str]] = []
    in_quality = set(quality_map.keys())
    in_report = set(display_names_report.keys())

    for key in in_quality - in_report:
        cross_warnings.append({
            "type": "missing_operator",
            "operator": getattr(quality_map[key], "display_name", key),
            "message": "Оператор найден в Monthly Report, но отсутствует в Report",
        })
    for key in in_report - in_quality:
        cross_warnings.append({
            "type": "missing_operator",
            "operator": display_names_report.get(key, key),
            "message": "Оператор найден в Report, но отсутствует в Monthly Report",
        })

    operators: List[OperatorPeriodMetrics] = []
    for key in sorted(all_keys):
        display = display_names_report.get(key) or getattr(quality_map.get(key), "display_name", None) or key
        q = quality_map.get(key)
        metrics = compute_operator_metrics(key, display, q, report_data)
        operators.append(metrics)

    operators.sort(key=lambda m: m.final_points, reverse=True)
    return PeriodCalculationResult(operators=operators, cross_warnings=cross_warnings)
