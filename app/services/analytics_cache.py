"""Compat-shim: TTL-кеш аналитики перенесён в app/modules/analytics/cache.py
(ТЗ Этап 5). Оставлено для обратной совместимости импортов.
"""
from app.modules.analytics.cache import (  # noqa: F401
    DEFAULT_TTL_SECONDS,
    cache_clear_all,
    cache_get,
    cache_key,
    cache_set,
)
