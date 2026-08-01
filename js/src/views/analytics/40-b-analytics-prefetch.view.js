/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Фоновый прогрев кеша аналитики. */

/* ══════════════════════════════════════
   VIEW: АНАЛИТИКА — с горизонтальными табами
══════════════════════════════════════ */
/* ══════════════════════════════════════
   ФОНОВЫЙ ПРОГРЕВ КЕША АНАЛИТИКИ
   Запускается через 3с после входа admin/manager.
   Загружает данные в sessionStorage-кеш тихо, в фоне.
   Когда пользователь откроет Аналитику — данные уже там.
══════════════════════════════════════ */
async function prefetchAnalyticsInBackground() {
  // Не запускаем если сейчас открыта Аналитика — там и так грузятся данные
  if (STATE.currentView === 'analytics') return;

  // Определяем период: берём последний доступный из already-loaded данных
  // или стандартно — последние 30 дней
  let startDate, endDate;
  try {
    const periods = await fetch(api._base() + '/api/analytics/available-periods', {
      credentials: 'include'
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (periods?.items?.length) {
      _analyticsState.availablePeriods = periods.items;
      // Берём самый свежий период из уже рассчитанных
      const latest = periods.items[0];
      startDate = latest.start_date;
      endDate   = latest.end_date;
    } else {
      // Нет готовых расчётов — берём текущий месяц
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      startDate = new Date(y, m, 1).toISOString().slice(0, 10);
      endDate   = now.toISOString().slice(0, 10);
    }
  } catch {
    return; // Не удалось получить периоды — тихо выходим
  }

  // Обновляем _analyticsState чтобы при открытии Аналитики даты совпали
  if (!_analyticsState.startDate) {
    _analyticsState.startDate = startDate;
    _analyticsState.endDate   = endDate;
  }

  const base = { start_date: startDate, end_date: endDate };
  const full = { ...base };

  // Грузим все основные вкладки параллельно, тихо — ошибки игнорируем
  // Приоритет: сначала Обзор (самая частая), потом остальные
  const prefetchQueue = [
    () => analyticsFetch('management-dashboard', full),
    () => analyticsFetch('operators-combined',  full),
    () => analyticsFetch('groups-comparison',   base),
    () => analyticsFetch('matrix-combined',     base),
    () => analyticsFetch('quality-combined',    base),
    () => analyticsFetch('risk-pyramid',        base),
    () => analyticsFetch('penalties',           base),
    () => analyticsFetch('points',              full),
  ];

  // Запускаем с небольшими задержками — не грузим сервер сразу всеми запросами
  for (let i = 0; i < prefetchQueue.length; i++) {
    // Прерываем если пользователь ушёл — его данные уже загружает renderAnalytics
    if (STATE.currentView === 'analytics') break;
    await new Promise(r => setTimeout(r, 400)); // 400мс между запросами
    prefetchQueue[i]().catch(() => {}); // тихо, без throw
  }
}
