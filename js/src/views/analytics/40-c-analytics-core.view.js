/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Состояние, параметры, URL, SWR-кеш и форматирование аналитики. */

const ANALYTICS_TABS = [
  { key: 'overview',   label: 'Сводка',            group: 'primary' },
  { key: 'operators',  label: 'Операторы',         group: 'primary' },
  { key: 'groups',     label: 'Группы',            group: 'primary' },
  { key: 'quality',    label: 'Контроль качества', group: 'primary' },
  { key: 'dynamics',   label: 'По дням',           group: 'primary' },
  { key: 'risks',      label: 'Риски',             group: 'primary' },
  { key: 'matrix',     label: 'Связь показателей', group: 'more' },
  { key: 'penalties',  label: 'Штрафы',            group: 'more' },
  { key: 'points',     label: 'Расчёт баллов',     group: 'more' },
  { key: 'export',     label: 'Выгрузка',          group: 'more' },
];

function getAnalyticsParams() {
  const qs = new URLSearchParams(location.hash.replace(/^#analytics\??/, ''));
  return {
    tab: qs.get('tab') || 'overview',
    start: qs.get('start') || null,
    end: qs.get('end') || null,
    group: qs.get('group') || '',
    operator: qs.get('operator') || '',
    participation: qs.get('participation') || 'all',
    onlyData: qs.get('onlyData') === '1',
  };
}

function setAnalyticsUrl(params) {
  const qs = new URLSearchParams();
  qs.set('tab', params.tab);
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  if (params.group) qs.set('group', params.group);
  if (params.operator) qs.set('operator', params.operator);
  if (params.participation && params.participation !== 'all') qs.set('participation', params.participation);
  if (params.onlyData) qs.set('onlyData', '1');
  history.replaceState(null, '', '#analytics?' + qs.toString());
}

let _analyticsState = {
  tab: 'overview',
  startDate: null,
  endDate: null,
  groupId: '',
  operatorQuery: '',
  participationStatus: 'all',
  onlyWithData: false,
  groups: [],
  availablePeriods: [],
  coverageWithData: null,
  coverageTotal: null,
  lastUpdatedAt: null,
  qualityGridWeekStart: null,
  operatorPage: 1,
  operatorSort: 'final_points',
  operatorSortOrder: 'desc',
};

function analyticsApiUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return api._base() + '/api/analytics/' + path + (qs ? '?' + qs : '');
}

const ANALYTICS_SWR_TTL_MS = 10 * 60_000; // 10 минут — данные построены из PeriodReport, меняются очень редко

async function analyticsFetch(path, params, onUpdate) {
  const key = 'analytics:' + path + ':' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    const res = await fetch(analyticsApiUrl(path, params), { credentials: 'include' });
    // Сначала читаем как текст — backend при 500 может вернуть обычный
    // текст ("Internal Server Error"), а не JSON; res.json() в этом случае
    // падает с "Unexpected token 'I'..." вместо понятной ошибки пользователю.
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text?.slice(0, 200) || `Ошибка ${res.status}`);
    }
    if (!res.ok) {
      const msg = data.detail || data.error || `Ошибка ${res.status}`;
      const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      error.status = res.status;
      throw error;
    }
    return data;
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

async function resolveInitialAnalyticsPeriod(urlParams) {
  let periods = [];
  try {
    const data = await analyticsFetch('available-periods', {});
    periods = Array.isArray(data?.items) ? data.items : [];
  } catch { /* the regular empty state will explain unavailable data */ }

  _analyticsState.availablePeriods = periods;
  const requestedStart = urlParams.start;
  const requestedEnd = urlParams.end;
  const requestedHasData = requestedStart && requestedEnd && periods.some(period =>
    requestedStart <= period.end_date && requestedEnd >= period.start_date
  );

  if (requestedHasData) return { start: requestedStart, end: requestedEnd };
  if (periods.length) return { start: periods[0].start_date, end: periods[0].end_date };
  if (requestedStart && requestedEnd) return { start: requestedStart, end: requestedEnd };

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return { start: weekAgo.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) };
}

function fmtA(v, decimals = 2, suffix = '') {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(decimals) + suffix;
}

// Единая канонизация статусов по всей аналитике (ТЗ §1.3, AC-02): раньше
// «В норме/Наблюдать/Критично/Нет данных» дублировались с разными формулировками
// в разных блоках (местами даже «Стабильные»/«Нужен контроль»). Теперь один
// источник правды — риск (стабильно/наблюдать/критично) не путается с
// отсутствием данных (AC-18).
const RISK_STATUS_LABELS = {
  stable: 'Цель выполнена',
  watch: 'Есть отклонение',
  critical: 'Нужно вмешательство',
  no_data: 'Недостаточно данных',
};
function riskStatusLabel(status) {
  return RISK_STATUS_LABELS[status] || RISK_STATUS_LABELS.no_data;
}

/* ── Единый контекст-бар над всеми вкладками (ТЗ §2) ───────────────── */

const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function analyticsPeriodLabel(startISO, endISO) {
  if (!startISO || !endISO) return '—';
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  if (sy === ey && sm === em) {
    return `${sd}–${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
  }
  if (sy === ey) {
    return `${sd} ${RU_MONTHS_GENITIVE[sm - 1]} – ${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
  }
  return `${sd} ${RU_MONTHS_GENITIVE[sm - 1]} ${sy} – ${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
}

function analyticsScopeLabel() {
  const s = _analyticsState;
  const parts = [];
  if (s.groupId) {
    const group = s.groups.find(g => String(g.id) === String(s.groupId));
    parts.push(group ? `группа «${group.name}»` : 'выбранная группа');
  } else {
    parts.push('вся команда');
  }
  if (s.operatorQuery) parts.push(`поиск «${s.operatorQuery}»`);
  if (s.participationStatus === 'participating') parts.push('только участвующие');
  if (s.participationStatus === 'not_participating') parts.push('не участвующие');
  if (s.onlyWithData) parts.push('только с данными');
  return parts.join(', ');
}

function analyticsCoverageLabel() {
  const s = _analyticsState;
  if (s.coverageTotal == null) return 'охват уточняется…';
  if (!s.coverageTotal) return 'нет операторов в области';
  return `${s.coverageWithData} из ${s.coverageTotal} операторов имеют данные`;
}

function analyticsUpdatedLabel() {
  const t = _analyticsState.lastUpdatedAt;
  if (!t) return 'обновляется…';
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `обновлено ${hh}:${mm}`;
}

function analyticsAvailabilityNote() {
  const periods = _analyticsState.availablePeriods;
  const s = _analyticsState;
  if (!periods.length || !s.startDate || !s.endDate) return '';
  const minStart = periods.reduce((min, p) => p.start_date < min ? p.start_date : min, periods[0].start_date);
  const maxEnd = periods.reduce((max, p) => p.end_date > max ? p.end_date : max, periods[0].end_date);
  if (s.startDate >= minStart && s.endDate <= maxEnd) return '';
  return `Данные доступны с ${analyticsPeriodLabel(minStart, minStart).split(' ').slice(0,2).join(' ')} ${minStart.slice(0,4)} по ${analyticsPeriodLabel(maxEnd, maxEnd).split(' ').slice(0,2).join(' ')} ${maxEnd.slice(0,4)}.`;
}

function renderAnalyticsContextBar() {
  const note = analyticsAvailabilityNote();
  return `<div class="an-context-bar" id="an-context-bar" role="status">
    <span class="an-context-line">Показаны результаты: ${esc(analyticsScopeLabel())} · ${esc(analyticsPeriodLabel(_analyticsState.startDate, _analyticsState.endDate))} · <span id="an-context-coverage">${esc(analyticsCoverageLabel())}</span> · <span id="an-context-updated">${esc(analyticsUpdatedLabel())}</span></span>
    ${note ? `<span class="an-context-note">${esc(note)}</span>` : ''}
  </div>`;
}

function mondayOfWeekISO(iso) {
  const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = понедельник
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function refreshAnalyticsContextBar(el) {
  const cov = el.querySelector('#an-context-coverage');
  const upd = el.querySelector('#an-context-updated');
  if (cov) cov.textContent = analyticsCoverageLabel();
  if (upd) upd.textContent = analyticsUpdatedLabel();
}

async function refreshAnalyticsCoverage(el) {
  try {
    const dashboard = await analyticsFetch('management-dashboard', analyticsOpParams());
    const health = dashboard.team_health || {};
    _analyticsState.coverageWithData = health.operators_with_data ?? 0;
    _analyticsState.coverageTotal = health.operators_count ?? 0;
    _analyticsState.lastUpdatedAt = new Date();
    refreshAnalyticsContextBar(el);
  } catch { /* контекст-бар остаётся с прежними числами до следующей попытки */ }
}

function qualityColor(band) {
  return { green: 'var(--success)', yellow: '#D97706', orange: '#EA580C', red: 'var(--danger)' }[band] || 'var(--text-muted)';
}

function riskBadge(status) {
  const colors = {
    stable: { color: 'var(--success)', bg: 'var(--success-soft)' },
    watch: { color: 'var(--warning)', bg: 'var(--warning-soft)' },
    critical: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
    no_data: { color: 'var(--text-muted)', bg: 'var(--bg-muted)' },
  };
  const c = colors[status] || colors.no_data;
  return `<span class="risk-badge" style="color:${c.color};background:${c.bg}">${riskStatusLabel(status)}</span>`;
}
