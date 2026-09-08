import re


def normalize_phone(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    compact = re.sub(r"[\s().-]", "", value)
    if re.fullmatch(r"7[0-9]{10}", compact):
        compact = "+" + compact
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", compact):
        raise ValueError("Укажите номер с кодом страны, например +7 700 123 45 67")
    return compact
