"""Compat-shim: логика рейтинга перенесена в app/modules/rating/ (ТЗ Этап 4).

Модуль оставлен, чтобы не менять ~11 внешних импортёров
(from app.services.rating import ...). Реэкспортирует публичные имена из
нового расположения. Новый код импортируйте напрямую из app.modules.rating.*.
"""
from app.modules.rating.nominations import (  # noqa: F401
    _NOMINATIONS_CACHE,
    _NOMINATIONS_TTL,
    build_nominations,
    invalidate_nominations_cache,
    nominations_cache_get,
    nominations_cache_set,
)
from app.modules.rating.service import (  # noqa: F401
    latest_period,
    rating_cache_invalidate,
    rating_rows,
    recalculate_period_ranks,
)
