"""
Импорт операторов из выгрузки users_report (.xlsx) на сайт Puls.

Берёт всех, кроме тех, у кого статус «Уволен», создаёт им учётные записи через API
сайта и сохраняет логины и пароли в CSV — его можно открыть в Excel и раздать.

Скрипту нужен только Python 3.10+ без дополнительных пакетов и доступ администратора.
Файл с личными данными никуда, кроме сайта, не отправляется и в репозиторий не кладётся.

Запуск:
    python scripts/import_operators.py users_report.xlsx --api https://<адрес API> --login admin
    python scripts/import_operators.py users_report.xlsx --api ... --login admin --dry-run

Пароль администратора спрашивается при запуске (или берётся из PULS_ADMIN_PASSWORD).
Повторный запуск безопасен: тех, кто уже есть на сайте, скрипт пропускает и пароль им не меняет.

Группа: оператор попадает в группу, у которой супервайзер с тем же ФИО, что в столбце
«Супервайзер» (или в название группы входит его фамилия). Если такой группы нет,
оператор создаётся без группы — в итогах это видно, группу можно назначить на сайте.
"""
from __future__ import annotations

import argparse
import csv
import getpass
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
FIRED = {"уволен", "уволена"}
# Без похожих символов (0/O, 1/l/I), чтобы пароль было легко продиктовать.
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def read_xlsx(path: Path) -> list[dict[str, str]]:
    """Первый лист книги как список строк {заголовок: значение}."""
    with zipfile.ZipFile(path) as book:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(f"{{{NS['x']}}}t")) for si in root.findall("x:si", NS)]
        workbook = ElementTree.fromstring(book.read("xl/workbook.xml"))
        first = workbook.find("x:sheets/x:sheet", NS).get(REL)
        rels = ElementTree.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == first)
        sheet = ElementTree.fromstring(book.read("xl/" + target.lstrip("/").removeprefix("xl/")))
    table: list[list[str]] = []
    for row in sheet.iter(f"{{{NS['x']}}}row"):
        values: dict[int, str] = {}
        for cell in row.findall("x:c", NS):
            column = 0
            for char in re.match(r"[A-Z]+", cell.get("r")).group():
                column = column * 26 + ord(char) - 64
            kind, raw = cell.get("t"), cell.find("x:v", NS)
            if kind == "inlineStr":
                text = "".join(t.text or "" for t in cell.iter(f"{{{NS['x']}}}t"))
            elif raw is None:
                text = ""
            elif kind == "s":
                text = shared[int(raw.text)]
            else:
                text = raw.text or ""
            values[column - 1] = text.strip()
        if values:
            table.append([values.get(i, "") for i in range(max(values) + 1)])
    header = table[0]
    return [{name: (line[i] if i < len(line) else "") for i, name in enumerate(header)} for line in table[1:]]


def operator_payload(row: dict[str, str]) -> dict:
    gender = {"мужской": "male", "женский": "female"}.get(row.get("Пол", "").lower())
    hired = row.get("Дата принятия", "")
    email = row.get("Почта", "") or row.get("Личный Email", "")
    payload = {
        "login": row["Логин"].strip().lower(),
        "full_name": re.sub(r"\s+", " ", row["ФИО"]).strip(),
        "role": "operator",
        "phone": row.get("Номер телефона") or None,
        "email": email if "@" in email else None,
        "gender": gender,
        "hired_on": hired if re.fullmatch(r"\d{4}-\d{2}-\d{2}", hired) else None,
    }
    return {key: value for key, value in payload.items() if value is not None}


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None, form: dict | None = None):
        data, headers = None, {"Accept": "application/json"}
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(f"{self.base}/api/v1{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read() or b"null")
            except ValueError:
                detail = None
            return error.code, detail


def error_text(detail) -> str:
    if isinstance(detail, dict):
        detail = detail.get("detail", detail)
    if isinstance(detail, list):
        return "; ".join(str(item.get("msg", item)) for item in detail)
    return str(detail)


def surname_key(name: str) -> str:
    return " ".join(name.lower().replace("ё", "е").split()[:2])


def main() -> int:
    parser = argparse.ArgumentParser(description="Импорт операторов из users_report.xlsx на сайт Puls")
    parser.add_argument("file", type=Path, help="выгрузка .xlsx")
    parser.add_argument("--api", required=True, help="адрес API, например https://gamification-api.onrender.com")
    parser.add_argument("--login", default="admin", help="логин администратора")
    parser.add_argument("--out", type=Path, default=Path("operators_credentials.csv"), help="куда сохранить логины и пароли")
    parser.add_argument("--dry-run", action="store_true", help="только показать, кого создаст, без изменений")
    args = parser.parse_args()

    rows = read_xlsx(args.file)
    people = [r for r in rows if r.get("Логин") and r.get("Статус", "").strip().lower() not in FIRED]
    print(f"В файле {len(rows)} человек, к импорту {len(people)} (уволенные пропущены: {len(rows) - len(people)}).")

    api = Api(args.api)
    password = os.environ.get("PULS_ADMIN_PASSWORD") or getpass.getpass(f"Пароль администратора {args.login}: ")
    status, token = api.call("POST", "/auth/login", form={"username": args.login, "password": password})
    if status != 200:
        print(f"Не удалось войти: {error_text(token)}", file=sys.stderr)
        return 1
    api.token = token["access_token"]

    status, groups = api.call("GET", "/admin/groups")
    groups = groups if status == 200 else []
    def group_for(supervisor: str):
        key = surname_key(supervisor)
        if not key:
            return None
        for group in groups:
            lead = (group.get("supervisor") or {}).get("full_name", "")
            if lead and surname_key(lead) in (key, " ".join(reversed(key.split()))):
                return group
        surname = key.split()[0]
        return next((g for g in groups if surname in g.get("name", "").lower()), None)

    results = []
    for row in people:
        payload = operator_payload(row)
        group = group_for(row.get("Супервайзер", ""))
        if group:
            payload["group_id"] = group["id"]
        group_name = group["name"] if group else f"нет группы (супервайзер: {row.get('Супервайзер') or '—'})"
        if args.dry_run:
            results.append((payload["full_name"], payload["login"], "", group_name, "будет создан"))
            continue
        payload["password"] = "".join(secrets.choice(ALPHABET) for _ in range(10))
        status, answer = api.call("POST", "/admin/users", body=payload)
        if status in (200, 201):
            results.append((payload["full_name"], payload["login"], payload["password"], group_name, "создан"))
        elif status == 409:
            results.append((payload["full_name"], payload["login"], "", group_name, "уже есть на сайте — пароль не менялся"))
        else:
            results.append((payload["full_name"], payload["login"], "", group_name, f"ошибка: {error_text(answer)}"))

    for name, login, secret, group_name, state in results:
        print(f"{state:<14} {login:<20} {secret:<12} {name}  [{group_name}]")
    if not args.dry_run:
        with args.out.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle, delimiter=";")
            writer.writerow(["ФИО", "Логин", "Пароль", "Группа", "Итог"])
            writer.writerows(results)
        print(f"\nЛогины и пароли сохранены в {args.out.resolve()} — храните файл в надёжном месте.")
    created = sum(1 for r in results if r[4] == "создан")
    print(f"Итого: создано {created}, уже было {sum(1 for r in results if r[4].startswith('уже'))}, "
          f"ошибок {sum(1 for r in results if r[4].startswith('ошибка'))}, без группы {sum(1 for r in results if r[3].startswith('нет группы'))}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
