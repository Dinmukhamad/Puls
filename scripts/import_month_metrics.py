"""
Загрузка месячных отчётов СЗоВ в недели конкурса Puls.

Отчёты приходят по дням, а сайт считает баллы по неделям, поэтому скрипт складывает
дни в недели месяца (понедельник–воскресенье целиком внутри месяца) и загружает:

    hours_norm      выполнение нормы часов, %: часы / (40 ч × ставка)
    efficiency      эффективность, %: эффективные часы / отработанные часы
    calls_per_hour  звонки / отработанные часы
    quality         средняя оценка проверяющих за неделю

Недели не закрываются и коины не начисляются: скрипт только пересчитывает
предварительный рейтинг. Закрывает неделю руководитель на сайте.

Оператор находится по ФИО (без учёта регистра, лишних пробелов и «ё»). Строки с «др.»
(другой отдел) пропускаются. При первом запуске скрипт заводит показатель hours_norm
и выключает hours_worked: общая цель 40 часов несправедлива к 0.5 и 0.75 ставки.

Запуск (нужен openpyxl, он есть в requirements.txt):
    python -m scripts.import_month_metrics --month 2026-08 \\
        --qa monthly_report_dates_2026-08.xlsx report_2026-08_3.xlsx report_2026-08_4.xlsx \\
        --api https://<адрес API> --login admin [--dry-run]
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import openpyxl

HOURS, CALLS, EFFECTIVE = "Отработанные часы", "Звонки", "Эффективность"
DAY = re.compile(r"^(\d{2})\.(\d{2})$")
HOURS_NORM = {"code": "hours_norm", "title": "Выполнение нормы часов", "unit": "%", "target_value": 100,
              "max_points": 25, "allow_overachievement": False, "sort_order": 1,
              "description": "Отработанные часы за неделю относительно 40 ч × ставка"}


def norm(name) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().lower().replace("ё", "е")


def number(value) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", ".").replace(" ", ""))
    except ValueError:
        return None


def day_columns(header, year: int, month: int) -> dict[int, date]:
    columns = {}
    for index, title in enumerate(header):
        match = DAY.match(str(title or "").strip())
        if match and int(match.group(2)) == month:
            columns[index] = date(year, month, int(match.group(1)))
    return columns


def read_team(path: Path, year: int, month: int, daily: dict, rates: dict) -> None:
    """Часы, звонки и эффективные часы по дням: daily[name][kind][date] = value."""
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for kind in (HOURS, CALLS, EFFECTIVE):
        rows = list(book[kind].iter_rows(values_only=True))
        days = day_columns(rows[0], year, month)
        seen = set()
        for row in rows[1:]:
            name = norm(row[0])
            if not name or name == "итого" or name in seen:
                continue
            seen.add(name)
            if kind == HOURS and number(row[1]):
                rates[name] = number(row[1])
            for column, day in days.items():
                value = number(row[column]) if column < len(row) else None
                if value is not None:
                    daily[name][kind][day] = value


def read_quality(path: Path, year: int, month: int) -> dict:
    """Оценки проверяющих из раздела «Оценки по датам» каждого листа: {name: {date: [оценки]}}."""
    scores: dict = defaultdict(lambda: defaultdict(list))
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for sheet in book.worksheets:
        section, days = None, {}
        for row in sheet.iter_rows(values_only=True):
            first = str(row[0] or "").strip()
            if first.startswith("Оценки"):
                section = first
                continue
            if first == "ФИО":
                days = day_columns(row, year, month)
                continue
            if not first or not section or not section.startswith("Оценки по датам"):
                continue
            for column, day in days.items():
                cell = row[column] if column < len(row) else None
                for part in str(cell or "").split(","):
                    value = number(part)
                    if value is not None and part.strip():
                        scores[norm(first)][day].append(value)
    return scores


def month_weeks(year: int, month: int) -> list[list[date]]:
    day = date(year, month, 1)
    day += timedelta(days=(7 - day.weekday()) % 7)
    weeks = []
    while (day + timedelta(days=6)).month == month:
        weeks.append([day + timedelta(days=i) for i in range(7)])
        day += timedelta(days=7)
    return weeks


class Api:
    def __init__(self, base: str):
        self.base, self.token = base.rstrip("/"), None

    def call(self, method, path, body=None, form=None):
        headers, data = {"Accept": "application/json"}, None
        if form is not None:
            data, headers["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
        elif body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(f"{self.base}/api/v1{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read() or b"null")
            except ValueError:
                return error.code, None


def main() -> int:
    parser = argparse.ArgumentParser(description="Месячные отчёты СЗоВ → недели конкурса Puls")
    parser.add_argument("reports", nargs="+", type=Path, help="report_YYYY-MM_*.xlsx по командам")
    parser.add_argument("--qa", type=Path, required=True, help="monthly_report_dates_YYYY-MM.xlsx")
    parser.add_argument("--month", required=True, help="месяц, например 2026-08")
    parser.add_argument("--api", required=True)
    parser.add_argument("--login", default="admin")
    parser.add_argument("--dry-run", action="store_true", help="посчитать и показать, ничего не загружая")
    args = parser.parse_args()
    year, month = map(int, args.month.split("-"))

    daily: dict = defaultdict(lambda: defaultdict(dict))
    rates: dict = {}
    for path in args.reports:
        read_team(path, year, month, daily, rates)
    quality = read_quality(args.qa, year, month)

    api = Api(args.api)
    password = os.environ.get("PULS_ADMIN_PASSWORD") or getpass.getpass(f"Пароль {args.login}: ")
    status, token = api.call("POST", "/auth/login", form={"username": args.login, "password": password})
    if status != 200:
        print(f"Не удалось войти: {token}", file=sys.stderr)
        return 1
    api.token = token["access_token"]
    operators, page = {}, 1
    while True:
        status, answer = api.call("GET", f"/admin/users?page={page}&size=100")
        items = answer.get("items", []) if isinstance(answer, dict) else []
        operators.update({norm(u["full_name"]): u["id"] for u in items if u["role"] == "operator" and u["is_active"]})
        if len(items) < 100:
            break
        page += 1

    names = set(daily) | set(quality)
    found = {name for name in names if name in operators}
    print(f"В отчётах {len(names)} человек, на сайте найдено {len(found)}.")
    weeks = month_weeks(year, month)
    plan = []
    for days in weeks:
        values = []
        for name in sorted(found):
            user = operators[name]
            hours = sum(daily[name][HOURS].get(d, 0) for d in days)
            if hours > 0:
                rate = rates.get(name) or 1
                values.append({"user_id": user, "metric_code": "hours_norm", "value": round(hours / (40 * rate) * 100, 1)})
                values.append({"user_id": user, "metric_code": "efficiency", "value": round(min(100, sum(daily[name][EFFECTIVE].get(d, 0) for d in days) / hours * 100), 1)})
                values.append({"user_id": user, "metric_code": "calls_per_hour", "value": round(sum(daily[name][CALLS].get(d, 0) for d in days) / hours, 2)})
            marks = [score for d in days for score in quality[name].get(d, [])]
            if marks:
                values.append({"user_id": user, "metric_code": "quality", "value": round(sum(marks) / len(marks), 1)})
        plan.append((days, values))
        print(f"Неделя {days[0]:%d.%m}–{days[-1]:%d.%m}: {len({v['user_id'] for v in values})} операторов, {len(values)} значений")
    missing = sorted(set(operators) - found)
    if missing:
        print(f"Операторов сайта без данных в отчётах: {len(missing)}")
    if args.dry_run:
        return 0

    status, metrics = api.call("GET", "/admin/config/metrics")
    by_code = {m["code"]: m for m in metrics}
    if "hours_norm" not in by_code:
        status, answer = api.call("POST", "/admin/config/metrics", body=HOURS_NORM)
        print("Показатель «Выполнение нормы часов» создан" if status in (200, 201) else f"Не создан hours_norm: {answer}")
    elif not by_code["hours_norm"]["is_active"]:
        api.call("PATCH", f"/admin/config/metrics/{by_code['hours_norm']['id']}", body={"is_active": True})
    if by_code.get("hours_worked", {}).get("is_active"):
        api.call("PATCH", f"/admin/config/metrics/{by_code['hours_worked']['id']}", body={"is_active": False})
        print("Показатель hours_worked выключен: часы теперь считаются от нормы по ставке")

    for days, values in plan:
        status, week = api.call("POST", "/admin/weeks", body={"any_day": days[0].isoformat()})
        if status not in (200, 201):
            print(f"Неделя {days[0]}: не удалось открыть — {week}")
            continue
        if week.get("status") == "closed":
            print(f"Неделя {days[0]:%d.%m}: уже закрыта, пропущена")
            continue
        status, answer = api.call("POST", f"/admin/weeks/{week['id']}/metrics", body={"values": values, "source": "import", "replace": False})
        state = "загружено" if status in (200, 201) else f"ошибка {answer}"
        status, preview = api.call("POST", f"/admin/weeks/{week['id']}/recalculate")
        print(f"Неделя {days[0]:%d.%m}–{days[-1]:%d.%m}: {state}, рейтинг пересчитан" if status == 200 else f"Неделя {days[0]:%d.%m}: {state}, пересчёт: {preview}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
