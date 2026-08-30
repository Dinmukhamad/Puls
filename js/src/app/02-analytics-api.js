/* ══════════════════════════════════════════════════════════════
   ЗАПРОСЫ К АНАЛИТИКЕ

   Эти три помощника потерялись при разрезании вьюхи-монолита на модули —
   ровно как RATING_TABS. Потребители остались, объявления исчезли:

     · analyticsFetch        — «Сводка» (2 вызова)
     · ANALYTICS_SWR_TTL_MS  — «Гонка баллов» в рейтинге
     · analyticsApiUrl       — сборка адреса для analyticsFetch

   Из-за этого «Сводка» падала с ReferenceError на каждой загрузке, а её
   пустой catch превращал отказ в одно и то же «Не удалось загрузить
   сводку» независимо от причины.
══════════════════════════════════════════════════════════════ */

// Данные аналитики строятся из сохранённых PeriodReport и меняются редко.
const ANALYTICS_SWR_TTL_MS = 10 * 60_000; // 10 минут

function analyticsApiUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return api._base() + '/api/analytics/' + path + (qs ? '?' + qs : '');
}

/**
 * GET к аналитике через stale-while-revalidate кеш.
 *
 * Ошибку доносим целиком: статус нужен, чтобы отличить «нет прав» от
 * «нет данных» и от сбоя сервера, а код обращения — чтобы пользователь мог
 * назвать конкретный запрос в поддержке.
 */
async function analyticsFetch(path, params, onUpdate) {
  const key = 'analytics:' + path + ':' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    const res = await fetch(analyticsApiUrl(path, params), { credentials: 'include' });
    // Сначала читаем как текст: при 500 backend может вернуть обычный текст,
    // и res.json() упал бы с «Unexpected token» вместо понятного сообщения.
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(text?.slice(0, 200) || `Ошибка ${res.status}`);
      error.status = res.status;
      error.requestId = res.headers.get('X-Request-ID') || '';
      throw error;
    }
    if (!res.ok) {
      const msg = data.message || data.detail || data.error || `Ошибка ${res.status}`;
      const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      error.status = res.status;
      error.requestId = data.request_id || res.headers.get('X-Request-ID') || '';
      throw error;
    }
    return data;
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

/* ══════════════════════════════════════════════════════════════
   ФОРМАТИРОВАНИЕ ПОКАЗАТЕЛЕЙ

   Ещё четыре потерянных при рефакторинге помощника, без которых
   «Сводка» падала уже на отрисовке — даже если запрос проходил.
══════════════════════════════════════════════════════════════ */

/**
 * Единая канонизация статусов по всей аналитике: риск (норма / отклонение /
 * вмешательство) не путается с отсутствием данных — это разные ситуации.
 */
const RISK_STATUS_LABELS = {
  stable: 'Цель выполнена',
  watch: 'Есть отклонение',
  critical: 'Нужно вмешательство',
  no_data: 'Недостаточно данных',
};

function riskStatusLabel(status) {
  return RISK_STATUS_LABELS[status] || RISK_STATUS_LABELS.no_data;
}

function analyticsStatusLabel(status) {
  return riskStatusLabel(status);
}

/** Число с единицей измерения. Отсутствие значения — прочерк, а не ноль. */
function fmtA(v, decimals = 2, suffix = '') {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(decimals) + suffix;
}

function analyticsMetricValue(value, unit) {
  return value == null ? '—' : `${fmtA(value, value % 1 ? 1 : 0)}${unit || ''}`;
}
