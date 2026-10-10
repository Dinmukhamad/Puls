"""Human metric names in files resolve to stable codes without ambiguous guesses."""

from __future__ import annotations

import csv
from datetime import date
from io import BytesIO, StringIO

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select

from app.models.contest import MetricDefinition, OperatorWeekMetric
from app.services import imports, weekly
from tests.conftest import auth, login

CUSTOM_CODE = "79059736-af96-498e-aeb4-a17fd1c9f077"
OTHER_CODE = "aa92d102-f2a8-46af-bd34-dc346a910045"


def _file(rows: list[list[object]], extension: str = "csv") -> bytes:
    if extension == "csv":
        stream = StringIO()
        csv.writer(stream, delimiter=";").writerows(rows)
        return stream.getvalue().encode("utf-8-sig")
    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def _rows(login_name: str, reference: str, format_name: str, value: int = 8):
    return (
        [["Логин", "Показатель", "Значение"], [login_name, reference, value]]
        if format_name == "long"
        else [["Логин", reference], [login_name, value]]
    )


@pytest.mark.parametrize("extension", ["csv", "xlsx"])
@pytest.mark.parametrize("format_name", ["long", "wide"])
async def test_russian_metric_titles_preview_and_apply_use_original_codes(
    client, session, operator, head, extension, format_name
):
    session.add(MetricDefinition(
        code=CUSTOM_CODE, title="  Подтверждённые ответы  ", is_active=True
    ))
    week = await weekly.get_or_create_week(session, date(2026, 10, 5))
    await session.commit()
    rows = _rows(operator.login, "  ПОДТВЕРЖДЁННЫЕ ОТВЕТЫ  ", format_name)
    if format_name == "long":
        rows.append([operator.login, "quality", 98])
    else:
        rows[0].append("QUALITY")  # Existing wide files normalize code headers.
        rows[1].append(98)
    headers = auth(await login(client, head.login))
    root = f"/api/v1/admin/weeks/{week.id}"
    preview_response = await client.post(
        f"{root}/import/preview", headers=headers,
        files={"file": (f"metrics.{extension}", _file(rows, extension))},
    )
    assert preview_response.status_code == 200, preview_response.text
    preview = preview_response.json()
    assert preview["can_apply"] is True
    assert preview["errors"] == []
    assert preview["valid_values"] == 2
    assert preview["format"] == format_name
    assert {(value["metric_code"], value["value"]) for value in preview["values"]} == {
        (CUSTOM_CODE, 8), ("quality", 98),
    }
    assert await session.scalar(select(func.count(OperatorWeekMetric.id))) == 0
    applied = await client.post(
        f"{root}/metrics", headers=headers, json={"values": preview["values"]}
    )
    assert applied.status_code == 200, applied.text
    assert set(await session.scalars(select(OperatorWeekMetric.metric_code))) == {
        CUSTOM_CODE, "quality",
    }


@pytest.mark.parametrize("format_name", ["long", "wide"])
async def test_ambiguous_active_titles_require_unique_names(
    session, operator, head, format_name
):
    session.add_all([
        MetricDefinition(code=CUSTOM_CODE, title="Оценка разговора", is_active=True),
        MetricDefinition(code=OTHER_CODE, title="  ОЦЕНКА РАЗГОВОРА  ", is_active=True),
    ])
    week = await weekly.get_or_create_week(session, date(2026, 10, 5))
    await session.commit()
    preview = await imports.preview_file(
        session, head, week, "metrics.csv",
        _file(_rows(operator.login, "  Оценка разговора  ", format_name)),
    )
    assert preview.can_apply is False
    assert preview.valid_values == 0
    assert len(preview.errors) == 1
    assert preview.errors[0].code == "ambiguous_metric"
    assert preview.errors[0].row == (2 if format_name == "long" else 1)
    assert "Сделайте названия уникальными" in preview.errors[0].message
    assert CUSTOM_CODE not in preview.errors[0].message
    assert OTHER_CODE not in preview.errors[0].message
    assert await session.scalar(select(func.count(OperatorWeekMetric.id))) == 0


@pytest.mark.parametrize(
    ("format_name", "reference"), [("long", "quality"), ("wide", "quality"), ("wide", "QUALITY")]
)
async def test_exact_legacy_code_takes_precedence_over_colliding_titles(
    session, operator, head, format_name, reference
):
    session.add_all([
        MetricDefinition(code=CUSTOM_CODE, title="quality", is_active=True),
        MetricDefinition(code=OTHER_CODE, title="QUALITY", is_active=True),
    ])
    week = await weekly.get_or_create_week(session, date(2026, 10, 5))
    await session.commit()
    preview = await imports.preview_file(
        session, head, week, "metrics.csv", _file(_rows(operator.login, reference, format_name))
    )
    assert preview.can_apply is True
    assert preview.errors == []
    assert preview.values[0].metric_code == "quality"
    assert preview.values[0].value == 8


@pytest.mark.parametrize("format_name", ["long", "wide"])
async def test_disabled_title_does_not_conflict_with_active_title_or_become_importable(
    session, operator, head, format_name
):
    session.add_all([
        MetricDefinition(code=CUSTOM_CODE, title="Оценка разговора", is_active=True),
        MetricDefinition(code=OTHER_CODE, title="ОЦЕНКА РАЗГОВОРА", is_active=False),
        MetricDefinition(code="disabled-only", title="Старый показатель", is_active=False),
    ])
    week = await weekly.get_or_create_week(session, date(2026, 10, 5))
    await session.commit()
    active = await imports.preview_file(
        session, head, week, "metrics.csv",
        _file(_rows(operator.login, "Оценка разговора", format_name)),
    )
    assert active.can_apply is True and active.values[0].metric_code == CUSTOM_CODE
    inactive = await imports.preview_file(
        session, head, week, "metrics.csv",
        _file(_rows(operator.login, "Старый показатель", format_name)),
    )
    assert inactive.can_apply is False
    assert inactive.errors[0].code == "unknown_metric"


async def test_title_and_code_for_same_metric_are_reported_as_duplicate(
    session, operator, head
):
    week = await weekly.get_or_create_week(session, date(2026, 10, 5))
    await session.commit()
    preview = await imports.preview_file(
        session, head, week, "metrics.csv", _file([
            ["Логин", "Качество работы", "quality"], [operator.login, 98, 97],
        ]),
    )
    assert preview.can_apply is False
    assert preview.errors[0].code == "duplicate"
    assert await session.scalar(select(func.count(OperatorWeekMetric.id))) == 0
