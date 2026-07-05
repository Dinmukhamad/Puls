"""Compat-shim: аналитические расчёты перенесены в
app/modules/analytics/calculators.py (ТЗ Этап 5). Оставлено для обратной
совместимости импортов; новый код импортируйте из app.modules.analytics.calculators.
"""
from app.modules.analytics.calculators import *  # noqa: F401,F403
