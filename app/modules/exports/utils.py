"""Общие утилиты экспорта (ТЗ §8): один и тот же набор строк можно отдать
и как CSV (с BOM — кириллица не ломается в Excel, ТЗ 8.6), и как XLSX.
"""
from __future__ import annotations

from io import BytesIO

from fastapi import HTTPException, status
from fastapi.responses import Response
from openpyxl import Workbook

VALID_FORMATS = {"csv", "xlsx"}


def _csv_cell(value) -> str:
    return '"' + str(value if value is not None else "").replace('"', '""') + '"'


def _build_csv(headers: list[str], rows: list[list]) -> str:
    lines = [",".join(_csv_cell(v) for v in headers)]
    lines.extend(",".join(_csv_cell(v) for v in row) for row in rows)
    return "\ufeff" + "\n".join(lines)


def _build_xlsx(headers: list[str], rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        # openpyxl не умеет писать наивные с tzinfo/None вперемешку со строками —
        # приводим всё к плоским JSON-совместимым типам заранее в вызывающем коде;
        # здесь только защита от None, чтобы отсутствующее значение не роняло запись.
        ws.append(["" if v is None else v for v in row])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_export_response(headers: list[str], rows: list[list], filename_base: str, format: str = "csv") -> Response:
    if format not in VALID_FORMATS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="format должен быть csv или xlsx")
    if format == "xlsx":
        return Response(
            _build_xlsx(headers, rows),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename_base}.xlsx"},
        )
    return Response(
        _build_csv(headers, rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename_base}.csv"},
    )
