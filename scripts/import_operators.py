"""
Сверка сотрудников сайта Puls с выгрузкой users_report (.xlsx).

Берёт только тех, у кого статус «Работает» или «Б/С»: уволенных пропускает и на сайте не трогает.
Каждого ищет на сайте по логину, телефону или ФИО (и когда на сайте ФИО короче — без отчества).
Найденному исправляет ФИО, если оно отличается, и заполняет то, что на сайте пустое: почту,
телефон, дату принятия, пол и группу. Остальное на сайте не меняется. Кого на сайте нет —
создаёт (логин из файла, «Чат менеджер» → направление «Чаты»). Если у супервайзера из файла нет
учётной записи и группы, создаёт и их.

Логины и пароли созданных сохраняются в CSV — его можно открыть в Excel и раздать.
Скрипту нужен только Python 3.10+ без дополнительных пакетов и доступ администратора.
Файл с личными данными никуда, кроме сайта, не отправляется и в репозиторий не кладётся.

Запуск:
    python scripts/import_operators.py users_report.xlsx --api https://<адрес API> --dry-run
    python scripts/import_operators.py users_report.xlsx --api https://<адрес API>

Сначала --dry-run: что изменится, без изменений. Пароль администратора спрашивается при запуске
(или берётся из PULS_ADMIN_PASSWORD). Повторный запуск безопасен: второй раз менять нечего.
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
WORKING = {"работает", "б/с"}
# Без похожих символов (0/O, 1/l/I), чтобы пароль было легко продиктовать.
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o",
                     "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "sch", "", "y", "", "e",
                     "yu", "ya", "a", "g", "k", "n", "o", "u", "u", "h", "i"], strict=True))


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


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def key(name: str) -> str:
    return clean(name).lower().replace("ё", "е")


def phone_of(value: str) -> str | None:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 11 and digits[0] in "78":
        return "+7" + digits[1:]
    return None


def wanted(row: dict[str, str]) -> dict:
    """What the file says about the employee, in the site's fields."""
    hired = row.get("Дата принятия", "")
    email = row.get("Почта", "") or row.get("Личный Email", "")
    return {
        "login": row["Логин"].strip().lower(),
        "full_name": clean(row["ФИО"]),
        "phone": phone_of(row.get("Номер телефона", "")),
        "email": email.strip() if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email.strip()) else None,
        "gender": {"мужской": "male", "женский": "female"}.get(row.get("Пол", "").strip().lower()),
        "hired_on": hired if re.fullmatch(r"\d{4}-\d{2}-\d{2}", hired) else None,
        "channel": "chat" if "чат" in row.get("Направление", "").lower() else "line",
    }


def login_for(name: str, taken: set[str]) -> str:
    words = key(name).split()
    base = "".join(TRANSLIT.get(ch, ch) for ch in words[0]) if words else "user"
    base = re.sub(r"[^a-z0-9]", "", base) or "user"
    login, number = base, 1
    while login in taken:
        number += 1
        login = f"{base}{number}"
    return login


def password() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(10))


def find(users: list[dict], want: dict) -> dict | None:
    """By login, then phone, then full name; a shorter name on the site (no patronymic) counts."""
    for test in (
        lambda u: u["login"].lower() == want["login"],
        lambda u: want["phone"] and u.get("phone") == want["phone"],
        lambda u: key(u["full_name"]) == key(want["full_name"]),
        lambda u: len(key(u["full_name"]).split()) >= 2
        and key(want["full_name"]).startswith(key(u["full_name"]) + " "),
    ):
        found = [u for u in users if test(u)]
        if len(found) == 1:
            return found[0]
    return None


def all_users(api: Api) -> list[dict]:
    users, page = [], 1
    while True:
        status, answer = api.call("GET", f"/admin/users?page={page}&size=200")
        if status != 200:
            raise SystemExit(f"Не удалось получить сотрудников: {error_text(answer)}")
        users += answer["items"]
        if len(users) >= answer["total"] or not answer["items"]:
            return users
        page += 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Сверка сотрудников сайта Puls с users_report.xlsx")
    parser.add_argument("file", type=Path, help="выгрузка .xlsx")
    parser.add_argument("--api", required=True, help="адрес API, например https://gamification-api.onrender.com")
    parser.add_argument("--login", default="admin", help="логин администратора")
    parser.add_argument("--out", type=Path, default=Path("operators_credentials.csv"), help="куда сохранить логины и пароли")
    parser.add_argument("--dry-run", action="store_true", help="только показать изменения, ничего не менять")
    args = parser.parse_args()

    rows = read_xlsx(args.file)
    people = [r for r in rows if r.get("Логин") and r.get("Статус", "").strip().lower() in WORKING]
    print(f"В файле {len(rows)} человек, к сверке {len(people)} (со статусом «Работает» и «Б/С»).")

    api = Api(args.api)
    secret = os.environ.get("PULS_ADMIN_PASSWORD") or getpass.getpass(f"Пароль администратора {args.login}: ")
    status, token = api.call("POST", "/auth/login", form={"username": args.login, "password": secret})
    if status != 200:
        print(f"Не удалось войти: {error_text(token)}", file=sys.stderr)
        return 1
    api.token = token["access_token"]
    users = all_users(api)
    status, groups = api.call("GET", "/admin/groups")
    groups = [g for g in (groups if status == 200 else []) if g.get("is_active", True)]
    taken = {u["login"].lower() for u in users}
    phones = {u["phone"]: u for u in users if u.get("phone")}
    emails = {(u.get("email") or "").lower(): u for u in users if u.get("email")}
    credentials, log = [], []

    def group_of(supervisor: str) -> dict | None:
        """The group whose supervisor (or name) is the file's supervisor; created when missing."""
        name = clean(supervisor)
        if not name:
            return None
        for group in groups:
            lead = (group.get("supervisor") or {}).get("full_name", "")
            if key(name) in (key(lead), key(group.get("name", ""))):
                return group
        lead = find([u for u in users if u["role"] == "supervisor"], {"login": "", "phone": None, "full_name": name})
        if args.dry_run:
            log.append(f"будет создан   супервайзер {name} и его группа" if not lead else f"будет создана  группа {name}")
            group = {"id": None, "name": name, "supervisor": {"full_name": name}}
            groups.append(group)
            return group
        if not lead:
            login = login_for(name, taken)
            body = {"login": login, "full_name": name, "role": "supervisor", "password": password()}
            status, lead = api.call("POST", "/admin/users", body=body)
            if status not in (200, 201):
                log.append(f"ошибка         супервайзер {name}: {error_text(lead)}")
                return None
            taken.add(login)
            users.append(lead)
            credentials.append((name, login, body["password"], "супервайзер", "создан"))
            log.append(f"создан         супервайзер {name} ({login})")
        code = re.sub(r"[^A-Z0-9]", "", "".join(TRANSLIT.get(c, c) for c in key(name).split()[0]).upper())[:32] or "GROUP"
        status, group = api.call("POST", "/admin/groups", body={"code": code, "name": name, "supervisor_id": lead["id"]})
        if status not in (200, 201):
            log.append(f"ошибка         группа {name}: {error_text(group)}")
            return None
        groups.append(group)
        log.append(f"создана        группа {name}")
        return group

    for row in people:
        want = wanted(row)
        group = group_of(row.get("Супервайзер", ""))
        user = find(users, want)
        if user is None:
            body = {key_: value for key_, value in want.items() if value is not None}
            if body.get("phone") in phones:
                log.append(f"без телефона   {want['full_name']}: {body.pop('phone')} уже у {phones[want['phone']]['full_name']}")
            if (body.get("email") or "").lower() in emails:
                body.pop("email")
            if body["login"] in taken:
                body["login"] = login_for(want["full_name"], taken)
            if group and group.get("id"):
                body["group_id"] = group["id"]
            if args.dry_run:
                log.append(f"будет создан   {body['login']:<16} {want['full_name']} [{(group or {}).get('name', 'без группы')}]")
                continue
            body["password"] = password()
            status, answer = api.call("POST", "/admin/users", body=body)
            if status in (200, 201):
                taken.add(body["login"])
                credentials.append((want["full_name"], body["login"], body["password"], (group or {}).get("name", ""), "создан"))
                log.append(f"создан         {body['login']:<16} {want['full_name']}")
            else:
                log.append(f"ошибка         {want['full_name']}: {error_text(answer)}")
            continue

        changes = {}
        if clean(user["full_name"]) != want["full_name"]:
            changes["full_name"] = want["full_name"]
        if not user.get("email") and want["email"] and want["email"].lower() not in emails:
            changes["email"] = want["email"]
        if not user.get("phone") and want["phone"]:
            if want["phone"] in phones:
                log.append(f"без телефона   {want['full_name']}: {want['phone']} уже у {phones[want['phone']]['full_name']}")
            else:
                changes["phone"] = want["phone"]
        if not user.get("hired_on") and want["hired_on"]:
            changes["hired_on"] = want["hired_on"]
        if not user.get("gender") and want["gender"]:
            changes["gender"] = want["gender"]
        if not user.get("group") and group:
            changes["group_id"] = group.get("id") or group["name"]
        if not changes:
            continue
        shown = ", ".join(
            f"ФИО: {user['full_name']} → {value}" if field == "full_name"
            else f"группа: {group['name']}" if field == "group_id" else f"{field}: {value}"
            for field, value in changes.items()
        )
        if args.dry_run:
            log.append(f"будет изменён  {user['login']:<16} {shown}")
            continue
        status, answer = api.call("PATCH", f"/admin/users/{user['id']}", body=changes)
        log.append(f"изменён        {user['login']:<16} {shown}" if status == 200
                   else f"ошибка         {user['full_name']}: {error_text(answer)}")

    print("\n".join(log) or "Менять нечего: сайт совпадает с файлом.")
    if credentials:
        with args.out.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle, delimiter=";")
            writer.writerow(["ФИО", "Логин", "Пароль", "Группа", "Итог"])
            writer.writerows(credentials)
        print(f"\nЛогины и пароли созданных сохранены в {args.out.resolve()} — храните файл в надёжном месте.")
    counts = {word: sum(1 for line in log if line.startswith(word)) for word in ("будет", "создан", "изменён", "ошибка")}
    if args.dry_run:
        print(f"\nИтого: запланировано {counts['будет']}, ошибок {counts['ошибка']}.")
    else:
        print(f"\nИтого: создано {counts['создан']}, изменено {counts['изменён']}, ошибок {counts['ошибка']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
