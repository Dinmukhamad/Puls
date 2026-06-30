"""
Простой in-memory TTL-кеш для эндпоинтов аналитики.

Ключ кеша = endpoint + все значимые query-параметры запроса.
TTL — 5 минут по умолчанию (см. ТЗ п.2).

Кеш сбрасывается целиком при:
  - загрузке новых Excel-файлов (Monthly Report / Report);
  - сохранении нового расчёта периода (POST /period-report/save).

Это process-local кеш (не Redis) — для Railway Free с одним инстансом
этого достаточно и не требует дополнительной инфраструктуры.

Использование внутри эндпоинта:

    @router.get("/summary")
    def get_summary(start_date: date, end_date: date, ..., db: Session = Depends(get_db)):
        key = cache_key("summary", start_date=start_date, end_date=end_date, group_id=group_id)
        hit = cache_get(key)
        if hit is not None:
            return hit
        result = {...}  # тяжёлый расчёт
        cache_set(key, result)
        return result
"""
from __future__ import annotations

import time
from threading import Lock
from typing import Any, Dict, Optional, Tuple

_CACHE: Dict[str, Tuple[float, Any]] = {}
_LOCK = Lock()
DEFAULT_TTL_SECONDS = 300  # 5 минут


def cache_key(endpoint: str, **params) -> str:
    parts = [endpoint] + [f"{k}={v}" for k, v in sorted(params.items()) if v is not None]
    return "|".join(parts)


def cache_get(key: str) -> Optional[Any]:
    with _LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.time() > expires_at:
            del _CACHE[key]
            return None
        return value


def cache_set(key: str, value: Any, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
    with _LOCK:
        _CACHE[key] = (time.time() + ttl_seconds, value)


def cache_clear_all() -> None:
    """Вызывается после загрузки новых файлов или сохранения расчёта периода —
    все ранее закешированные результаты аналитики становятся неактуальными."""
    with _LOCK:
        _CACHE.clear()
