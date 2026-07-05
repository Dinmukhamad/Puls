"""Номинации недели (ТЗ §16, Приоритет 1: rating/nominations.py).

build_nominations — чистая функция: принимает уже посчитанные rating_rows и
строит список номинаций. Кеш номинаций живёт здесь же (перенесён из
services/rating.py дословно). Логика формирования номинаций не изменена.
"""
from __future__ import annotations

import time

# ── Кеш номинаций недели (ТЗ P0.1) ───────────────────────────────────────────
# Номинации строятся из rating_rows и меняются только вместе с рейтингом.
# Кешируется ТОЛЬКО пользователь-независимая часть (winner_operator_id вместо
# is_current_user) — персональный флаг «это вы» вычисляется на каждый запрос,
# иначе кеш отдавал бы чужой флаг всем пользователям.
_NOMINATIONS_CACHE: dict = {}
_NOMINATIONS_TTL = 300  # 5 минут


def nominations_cache_get() -> dict | None:
    entry = _NOMINATIONS_CACHE.get("v")
    if entry and (time.time() - entry["ts"]) < _NOMINATIONS_TTL:
        return entry["data"]
    return None


def nominations_cache_set(data: dict) -> None:
    _NOMINATIONS_CACHE["v"] = {"data": data, "ts": time.time()}


def invalidate_nominations_cache() -> None:
    _NOMINATIONS_CACHE.clear()


def build_nominations(rows: list[dict]) -> dict:
    """Строит номинации из rating_rows. Без персональных полей — результат кешируемый."""
    if not rows:
        return {"items": []}

    nominations = []

    # Best points — top-1
    top = rows[0]
    nominations.append({
        "title": "Лучший результат недели",
        "winner_name": top["operator_name"],
        "winner_operator_id": top["operator_id"],
        "value": f"{top.get('contest_points') or top.get('final_score', 0):.0f} баллов",
        "coins_bonus": 50,
    })

    # Best coins
    by_coins = sorted(rows, key=lambda r: r.get("coins_earned") or 0, reverse=True)
    if by_coins:
        top_c = by_coins[0]
        nominations.append({
            "title": "Больше всего коинов",
            "winner_name": top_c["operator_name"],
            "winner_operator_id": top_c["operator_id"],
            "value": f"{top_c.get('coins_earned', 0)} ₡",
            "coins_bonus": 30,
        })

    # Best progress (biggest rank delta)
    with_delta = [(r, r.get("rank_delta") or 0) for r in rows]
    best_progress = max(with_delta, key=lambda x: x[1], default=(None, 0))
    if best_progress[0] and best_progress[1] > 0:
        bp = best_progress[0]
        nominations.append({
            "title": "Лучший прогресс недели",
            "winner_name": bp["operator_name"],
            "winner_operator_id": bp["operator_id"],
            "value": f"+{best_progress[1]} позиций",
            "coins_bonus": 15,
        })

    return {"items": nominations}
