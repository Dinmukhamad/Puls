async function renderRatingOverviewTab(el) {
  const role  = STATE.user?.role || 'operator';
  const isOp  = role === 'operator';
  const canSelectOperator = isAdmin(role);
  let selectedOpId = canSelectOperator ? null : (STATE.user?.operator_id || null);
  let searchVal = '';
  let filterGroup = '';
  let filterLevel = '';
  let operatorSearchVal = '';
  let cmpMetric = 'points';
  let dynType = 'place';
  let personal = { myData: null, myTx: [], myDyn: null, myCmp: null };

  // Skeleton
  el.innerHTML = `
    <div class="rating-page">
      <div class="skel-block rating-skel-header"></div>
      <div class="rating-top-grid">
        <div class="skel-block rating-skel-card"></div>
        <div class="skel-block rating-skel-card"></div>
      </div>
      <div class="rating-mid-grid">
        <div class="skel-block rating-skel-card compact"></div>
        <div class="skel-block rating-skel-card compact"></div>
      </div>
      <div class="skel-block rating-skel-wide"></div>
      <div class="skel-block rating-skel-wide tall"></div>
    </div>`;

  try {
    async function fetchRequired(path) {
      const res = await fetch(api._base() + path, { credentials: 'include' });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const msg = data.detail || data.error || `Ошибка ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return data;
    }

    async function fetchOptional(path, fallback) {
      try {
        const res = await fetch(api._base() + path, { credentials: 'include' });
        if (!res.ok) return fallback;
        return await res.json();
      } catch {
        return fallback;
      }
    }

    // Используем кешированные данные из STATE — без лишних запросов
    let ratingResp = { items: STATE.rating, total: STATE.rating.length, period: '—', updated_at: '' };
    let nominationsResp = STATE.nominations || { items: [] };

    // Если рейтинг пуст — грузим свежие данные (первый вход или инвалидация)
    if (!STATE.rating.length) {
      [ratingResp, nominationsResp] = await Promise.all([
        fetchRequired('/api/rating'),
        fetchOptional('/api/rating/nominations', { items: [] }),
      ]);
      STATE.rating = Array.isArray(ratingResp.items) ? ratingResp.items : [];
      STATE.nominations = nominationsResp;
    }

    const rows = Array.isArray(ratingResp.items) ? ratingResp.items : STATE.rating;
    const total = rows.length;
    const period = ratingResp.period && ratingResp.period !== '—' ? ratingResp.period : 'Период пока не рассчитан';
    const updatedAt = ratingResp.updated_at || '';
    const groups = [...new Set(rows.map(r => r.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const levels = STATE.operatorLevels.length
      ? STATE.operatorLevels
      : [...new Map(rows.map(r => r.level).filter(Boolean).map(l => [l.code, l])).values()];
    const noms = Array.isArray(nominationsResp.items) ? nominationsResp.items : [];
    const operatorChoices = buildOperatorChoices();

    function hasPersonalTarget(opId) {
      return canSelectOperator ? Boolean(opId) : true;
    }

    function pathWithParams(path, params = {}, opId = selectedOpId) {
      const qp = new URLSearchParams(params);
      if (opId) qp.set('operator_id', opId);
      const qs = qp.toString();
      return qs ? `${path}?${qs}` : path;
    }

    async function fetchComparisonData(opId, metric) {
      if (!hasPersonalTarget(opId)) return { metric, items: [] };
      return fetchOptional(pathWithParams('/api/rating/me/comparison', { metric }, opId), { metric, items: [] });
    }

    async function fetchDynamicsData(opId, type) {
      if (!hasPersonalTarget(opId)) return { type, items: [] };
      return fetchOptional(pathWithParams('/api/rating/me/dynamics', { type, weeks: 8 }, opId), { type, items: [] });
    }

    async function fetchTransactionsData(opId) {
      if (!hasPersonalTarget(opId)) return [];
      const data = await fetchOptional(pathWithParams('/api/rating/me/transactions', { limit: 5 }, opId), []);
      return Array.isArray(data) ? data : [];
    }

    // Кеш личных данных — TTL 2 минуты, инвалидируется при смене оператора
    const _personalCacheKey = `rating:personal:${selectedOpId || 'me'}`;

    async function fetchPersonalData(opId) {
      if (!hasPersonalTarget(opId)) return { myData: null, myTx: [], myDyn: null, myCmp: null };

      // Используем SWR кеш — me + transactions загружаем вместе, dynamics отдельно
      const cached = swrReadRaw(_personalCacheKey);
      if (cached) return cached.data;

      const [myData, myTx] = await Promise.all([
        fetchOptional(pathWithParams('/api/rating/me', {}, opId), { no_operator: true }),
        fetchTransactionsData(opId),
      ]);
      const result = { myData, myTx, myDyn: null, myCmp: null };
      swrWriteRaw(_personalCacheKey, { data: result, ts: Date.now() });
      return result;
    }

    personal = await fetchPersonalData(selectedOpId);

    // dynamics и comparison — загружаем в фоне после рендера (не блокируем)
    async function loadPersonalExtras() {
      if (!hasPersonalTarget(selectedOpId)) return;
      const opId = selectedOpId;
      const [myDyn, myCmp] = await Promise.all([
        fetchDynamicsData(opId, dynType),
        fetchComparisonData(opId, cmpMetric),
      ]).catch(() => [null, null]);
      personal.myDyn = myDyn;
      personal.myCmp = myCmp;
      // Обновляем только блоки сравнения и динамики без полного ре-рендера
      const cmpBody = el.querySelector('#cmp-body');
      if (cmpBody) cmpBody.innerHTML = renderComparison(personal.myCmp, cmpMetric);
      loadDynCard();
    }

    function buildOperatorChoices() {
      const map = new Map();
      rows.forEach(r => {
        if (!r.operator_id) return;
        map.set(String(r.operator_id), {
          id: Number(r.operator_id),
          full_name: r.operator_name || 'Без имени',
          group_name: r.group_name || '',
        });
      });
      (STATE.adminOperators || []).forEach(o => {
        if (!o.id) return;
        map.set(String(o.id), {
          id: Number(o.id),
          full_name: o.full_name || 'Без имени',
          group_name: o.group_name || '',
        });
      });
      return [...map.values()].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ru'));
    }

    function isNum(v) {
      return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    }

    function cleanNumber(v, decimals = 0, fallback = 'Нет данных') {
      if (!isNum(v)) return fallback;
      const n = Number(v);
      if (decimals > 0) return n.toFixed(decimals).replace(/\.0$/, '');
      return String(Math.round(n));
    }

    function cleanCoins(v, fallback = 'Нет данных') {
      return isNum(v) ? uiCoin(v) : fallback;
    }

    function cleanDate(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const formatted = uiDate(dt);
      return formatted === 'Нет данных' ? fallback : formatted;
    }

    function cleanDateTime(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const formatted = uiDateTime(dt);
      return formatted === 'Нет данных' ? fallback : formatted;
    }

    function metricDecimals(metric) {
      return metric === 'coins' ? 0 : 1;
    }

    function renderHeader() {
      const myData = personal.myData;
      const bal = myData && !myData.no_operator && isNum(myData.total_balance)
        ? `<div class="rh-balance"><span>Баланс</span><b>${cleanCoins(myData.total_balance)}</b></div>`
        : '';
      return `<div class="rh-card">
        <div>
          <div class="rh-title">Рейтинг операторов</div>
          <div class="rh-meta">Период: ${esc(period)} · Участников: ${total} · Обновлено: ${cleanDateTime(updatedAt)}</div>
        </div>
        ${bal}
      </div>`;
    }

    function operatorOptionsHtml() {
      const q = operatorSearchVal.trim().toLowerCase();
      let visible = operatorChoices.filter(op =>
        !q ||
        String(op.full_name).toLowerCase().includes(q) ||
        String(op.group_name || '').toLowerCase().includes(q)
      );
      if (selectedOpId && !visible.some(op => op.id === selectedOpId)) {
        const selected = operatorChoices.find(op => op.id === selectedOpId);
        if (selected) visible = [selected, ...visible];
      }
      return `<option value="">Не выбран</option>${visible.map(op => `
        <option value="${op.id}" ${op.id === selectedOpId ? 'selected' : ''}>
          ${esc(op.full_name)}${op.group_name ? ` · ${esc(op.group_name)}` : ''}
        </option>`).join('')}`;
    }

    function renderOpSelector() {
      if (!canSelectOperator) return '';
      return `<div class="rating-card rating-card-body rating-selector-card">
        <div>
          <div class="rs-label">Карточка оператора</div>
          <div class="rs-hint">${selectedOpId ? 'Личные блоки показывают данные выбранного оператора' : 'Выберите оператора, чтобы посмотреть индивидуальный результат.'}</div>
        </div>
        <div class="rs-row">
          <input id="rating-op-search" class="form-input" placeholder="Поиск по ФИО" value="${esc(operatorSearchVal)}">
          <select id="rating-op-select" class="form-select">${operatorOptionsHtml()}</select>
        </div>
      </div>`;
    }

    function renderMyResult() {
      const myData = personal.myData;
      if (canSelectOperator && !selectedOpId) {
        return `<div class="rating-card rating-card-body r-my-card">
          <div class="rcard-title">Карточка оператора</div>
          <div class="r-empty-state">
            <div class="r-empty-title">Выберите оператора</div>
            <div class="r-empty-sub">После выбора здесь появятся место, баллы, коины и баланс.</div>
          </div>
        </div>`;
      }
      if (!myData || myData.no_operator) {
        return `<div class="rating-card rating-card-body r-my-card">
          <div class="rcard-title">Мой результат</div>
          <div class="r-empty-state">
            <div class="r-empty-title">Место пока не рассчитано</div>
            <div class="r-empty-sub">Участвуйте в конкурсе, чтобы попасть в рейтинг</div>
          </div>
        </div>`;
      }
      const delta = isNum(myData.place_change) ? Number(myData.place_change) : null;
      const deltaEl = delta === null ? '<span class="rd-neutral">без изменений</span>'
        : delta > 0 ? `<span class="rd-up">↑ +${delta} позиции</span>`
        : delta < 0 ? `<span class="rd-down">↓ ${Math.abs(delta)} позиции</span>`
        : '<span class="rd-neutral">без изменений</span>';

      const place = isNum(myData.place) && Number(myData.place) > 0 ? Number(myData.place) : null;
      const placeTotal = isNum(myData.total_participants) ? Number(myData.total_participants) : total;
      const placeEl = place
        ? `<div class="rmp-place">#${place} <span class="rmp-total">из ${placeTotal || total}</span></div>`
        : `<div class="rmp-noplace"><b>Место пока не рассчитано</b><span>Оператор не участвует в текущем периоде или расчёт ещё не выполнен.</span></div>`;

      return `<div class="rating-card rating-card-body r-my-card">
        <div class="rcard-title">${isOp ? 'Мой результат' : 'Карточка оператора'}</div>
        <div class="rmp-person">
          <b>${esc(myData.full_name || STATE.user?.full_name || 'Оператор')}</b>
          <span>${esc(myData.group_name || 'Группа не указана')}</span>
        </div>
        ${placeEl}
        <div class="rms-list">
          <div class="rms-row"><span class="rms-label">Баллы недели</span><span class="rms-val">${cleanNumber(myData.weekly_points, 1)}</span></div>
          <div class="rms-row"><span class="rms-label">Коины недели</span><span class="rms-val accent">${cleanCoins(myData.weekly_coins)}</span></div>
          <div class="rms-row"><span class="rms-label">Общий баланс</span><span class="rms-val">${cleanCoins(myData.total_balance)}</span></div>
          <div class="rms-row"><span class="rms-label">Динамика</span><span class="rms-val">${deltaEl}</span></div>
        </div>
      </div>`;
    }

    function renderPodium() {
      const top3 = rows.slice(0, 3);
      if (!top3.length) return `<div class="r-empty-state"><div class="r-empty-title">Пока нет данных</div></div>`;
      const medals = ['1', '2', '3'];
      return `<div class="podium-grid">
        ${[0, 1, 2].map(i => {
          const op = top3[i];
          if (!op) return `<div class="pod-card pod-empty">Пока нет данных</div>`;
          const isHighlighted = op.is_current_user || (selectedOpId && Number(op.operator_id) === selectedOpId);
          return `<div class="pod-card pod-${i + 1} ${isHighlighted ? 'pod-me' : ''}">
            <div class="pod-medal">${medals[i]}</div>
            <div class="pod-name">${esc(op.operator_name || 'Оператор')}</div>
            <div class="pod-group">${esc(op.group_name || 'Группа не указана')}</div>
            <div class="pod-pts">${cleanNumber(op.contest_points, 1)} баллов</div>
            <div class="pod-coins">${cleanCoins(op.coins_earned)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }

    function renderComparison(data, metric) {
      if (!data?.items?.length) return `<div class="r-empty-state">
        <div class="r-empty-title">${canSelectOperator && !selectedOpId ? 'Выберите оператора' : 'Сравнение пока недоступно'}</div>
        <div class="r-empty-sub">Данные появятся после расчёта конкурса.</div>
      </div>`;
      const maxVal = Math.max(...data.items.map(i => Number(i.value) || 0), 1);
      return data.items.map(item => {
        const value = Number(item.value) || 0;
        const pct = Math.max(0, Math.min(100, Math.round((value / maxVal) * 100)));
        return `<div class="cmp-row ${item.is_highlight?'cmp-me':''}">
          <div class="cmp-label">${esc(item.label || 'Показатель')}</div>
          <div class="cmp-bar-wrap"><div class="cmp-bar" style="width:${pct}%"></div></div>
          <div class="cmp-value">${cleanNumber(value, metricDecimals(metric))}</div>
        </div>`;
      }).join('');
    }

    /* ── Новый блок динамики оператора (ТЗ §14-19) ──────────────── */
    let dynMode = 'points'; // points | coins | rank
    let dynData = null;

    // expose to global setDynMode
    window._setDynModeInternal = async function(mode) {
      dynMode = mode;
      // Обновляем визуально активную вкладку немедленно
      document.querySelectorAll('.dyn-tab').forEach(btn => {
        const m = btn.getAttribute('onclick')?.match(/setDynMode\('(\w+)'\)/)?.[1];
        if (m) btn.className = 'dyn-tab' + (m === mode ? ' dyn-tab-active' : '');
      });
      await loadDynCard();
    };

    async function loadDynCard() {
      // Для оператора используем его operator_id; для admin/manager — selectedOpId
      const opId = canSelectOperator ? (selectedOpId || null) : (STATE.user?.operator_id || null);
      try {
        const url = `/api/rating/operator-dynamics?mode=${dynMode}&limit=4${opId ? '&operator_id='+opId : ''}`;
        dynData = await api._req('GET', url);
      } catch(e) {
        dynData = null;
      }
      const box = document.getElementById('dyn-body');
      if (box) box.innerHTML = renderDynamics(dynData);
    }

    function renderDynamics(data) {
      if (!data || !data.items) {
        return renderDynEmpty(canSelectOperator && !selectedOpId ? 'Выберите оператора' : 'Нет данных');
      }
      const items = data.items;
      if (!items.length) {
        const reason = (canSelectOperator && !dynData?.operator_id)
          ? 'Выберите оператора для просмотра динамики.'
          : 'Нет данных для построения динамики.<br><small>Динамика появится после загрузки рабочих показателей (Excel-отчёта).</small>';
        return renderDynEmpty(reason);
      }

      // Определяем значения по режиму
      const isRank = dynMode === 'rank';
      const isCoins = dynMode === 'coins';
      const vals = items.map(i =>
        isRank ? (i.rank || 0) : isCoins ? (i.daily_coins || 0) : (i.daily_points || 0)
      );

      const summary = data.summary || {};
      const comps   = data.components_summary || {};

      return `
      <div class="dyn-card">
        <!-- Вкладки режима -->
        <div class="dyn-header">
          <div>
            <div class="dyn-title">Динамика оператора</div>
            <div class="dyn-subtitle">Последние ${items.length} рабочих дня с данными</div>
          </div>
          <div class="dyn-tabs">
            ${['points','coins','rank'].map(m => `
              <button class="dyn-tab${dynMode===m?' dyn-tab-active':''}" onclick="setDynMode('${m}')">
                ${m==='points'?'Баллы':m==='coins'?'Коины':'Место'}
              </button>`).join('')}
          </div>
        </div>

        <!-- График + Summary -->
        <div class="dyn-body-grid">
          <div class="dyn-chart-col">
            ${renderDynChart(items, vals, isRank)}
          </div>
          <div class="dyn-summary-col">
            ${renderDynSummary(summary, dynMode)}
          </div>
        </div>

        <!-- Расшифровка компонентов -->
        ${!isRank ? renderDynBreakdown(comps) : ''}
      </div>`;
    }

    function renderDynEmpty(msg) {
      return `<div class="r-empty-state"><div class="r-empty-title">${msg}</div></div>`;
    }

    function renderDynChart(items, vals, isRank) {
      if (items.length === 1) {
        // Одна точка — показываем без линии
        const v = vals[0];
        const it = items[0];
        return `<div class="dyn-single">
          <div class="dyn-single-val">${isRank ? '#'+v : cleanNumber(v,1)}</div>
          <div class="dyn-single-date">${esc(it.label)} ${esc(it.weekday)}</div>
          <div class="dyn-single-note">Недостаточно данных для сравнения</div>
        </div>`;
      }

      const W = 320, H = 110, PAD = 28, BOTTOM = 36;
      const n = items.length;
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      // Добавляем padding к диапазону чтобы линия не была плоской
      const range = maxV === minV ? Math.max(maxV * 0.2, 5) : (maxV - minV);
      const yPad = range * 0.25;
      const lo = minV - yPad, hi = maxV + yPad;

      const toX = i => PAD + i * (W - PAD*2) / (n - 1);
      const toY = v => isRank
        ? PAD + ((v - minV + yPad) / (range + yPad*2)) * (H - PAD)       // rank: выше = ниже на графике
        : H - PAD - ((v - minV + yPad) / (range + yPad*2)) * (H - PAD);  // points/coins: выше = выше

      const pts = items.map((it, i) => ({ x: toX(i), y: toY(vals[i]), v: vals[i], it }));

      // Smooth bezier path
      function makePath(pts) {
        if (pts.length < 2) return '';
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i-1], cur = pts[i];
          const cx = (prev.x + cur.x) / 2;
          d += ` C ${cx} ${prev.y} ${cx} ${cur.y} ${cur.x} ${cur.y}`;
        }
        return d;
      }

      const linePath  = makePath(pts);
      const fillPath  = linePath + ` L ${pts[pts.length-1].x} ${H+4} L ${pts[0].x} ${H+4} Z`;

      // Y grid lines
      const gridCount = 3;
      const gridLines = Array.from({length: gridCount}, (_, i) => {
        const y = PAD + i * (H - PAD) / (gridCount - 1);
        return `<line x1="${PAD-4}" y1="${y}" x2="${W-PAD+4}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 3"/>`;
      }).join('');

      return `<svg class="dyn-svg" viewBox="0 0 ${W} ${H + BOTTOM}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="dyn-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>

        ${gridLines}

        <!-- Заливка под линией -->
        <path d="${fillPath}" fill="url(#dyn-grad)"/>

        <!-- Линия -->
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round"/>

        <!-- Точки + значения -->
        ${pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          const labelY = Math.max(14, p.y - 10);
          const label  = isRank ? '#' + (p.v||0) : cleanNumber(p.v, isRank ? 0 : 1);
          return `
            <circle cx="${p.x}" cy="${p.y}" r="${isLast?5:4}"
              fill="${isLast?'var(--accent)':'var(--surface)'}"
              stroke="var(--accent)" stroke-width="2"/>
            <text x="${p.x}" y="${labelY}" text-anchor="middle"
              font-size="10" font-weight="${isLast?'700':'500'}"
              fill="${isLast?'var(--accent)':'var(--tx2)'}"
              font-family="Inter,system-ui,sans-serif">${label}</text>
            <text x="${p.x}" y="${H + 14}" text-anchor="middle"
              font-size="10" fill="var(--tx2)"
              font-family="Inter,system-ui,sans-serif">${esc(p.it.label)}</text>
            <text x="${p.x}" y="${H + 26}" text-anchor="middle"
              font-size="9" fill="var(--tx3)"
              font-family="Inter,system-ui,sans-serif">${esc(p.it.weekday)}</text>`;
        }).join('')}
      </svg>`;
    }

    function renderDynSummary(s, mode) {
      const isRank = mode === 'rank';
      const isCoins = mode === 'coins';
      const unit = isRank ? '' : isCoins ? ' ₡' : ' б';
      const todayFmt = s.today_value != null
        ? (isRank ? '#' + s.today_value : cleanNumber(s.today_value, 1) + unit)
        : '—';
      const avgFmt = s.average_4_days != null
        ? (isRank ? '#' + Math.round(s.average_4_days) : cleanNumber(s.average_4_days, 1) + unit)
        : '—';

      let deltaEl = '—';
      if (s.delta != null) {
        const sign = isRank
          ? (s.delta < 0 ? '▲' : s.delta > 0 ? '▼' : '=')   // rank: меньше = лучше
          : (s.delta > 0 ? '▲' : s.delta < 0 ? '▼' : '=');
        const cls  = isRank
          ? (s.delta < 0 ? 'dyn-delta-up' : s.delta > 0 ? 'dyn-delta-dn' : 'dyn-delta-eq')
          : (s.delta > 0 ? 'dyn-delta-up' : s.delta < 0 ? 'dyn-delta-dn' : 'dyn-delta-eq');
        const absDelta = Math.abs(s.delta);
        const pctPart  = s.delta_percent != null ? ` (${s.delta_percent > 0 ? '+' : ''}${cleanNumber(s.delta_percent,1)}%)` : '';
        deltaEl = `<span class="${cls}">${sign} ${isRank ? absDelta + ' поз.' : (s.delta > 0 ? '+' : '') + cleanNumber(s.delta, 1) + unit + pctPart}</span>`;
      }

      return `<div class="dyn-summary">
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">${isRank ? 'Позиция сегодня' : isCoins ? 'Коины сегодня' : 'Баллы сегодня'}</span>
          <span class="dyn-sum-val dyn-sum-main">${todayFmt}</span>
        </div>
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">Изменение</span>
          <span class="dyn-sum-val">${deltaEl}</span>
        </div>
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">Среднее за ${dynData?.items?.length||4} дня</span>
          <span class="dyn-sum-val">${avgFmt}</span>
        </div>
      </div>`;
    }

    function renderDynBreakdown(c) {
      const total = (c.hours_points||0) + (c.kvz||0) + (c.efficiency||0);
      const pct = v => total > 0 ? Math.round(v/total*100) : 0;
      const bar = (v, max, color) => {
        const w = max > 0 ? Math.round(clamp01(v/max)*100) : 0;
        return `<div class="dyn-bar-bg"><div class="dyn-bar-fill" style="width:${w}%;background:${color}"></div></div>`;
      };
      const clamp01 = x => Math.min(1, Math.max(0, x));
      const maxComp = Math.max(c.hours_points||0, c.kvz||0, c.efficiency||0, 0.1);

      return `<div class="dyn-breakdown">
        <div class="dyn-bk-title">Баллы за день формируются без учёта качества, только из:</div>
        <div class="dyn-bk-rows">
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">⏱</span>
            <span class="dyn-bk-lbl">Часы</span>
            ${bar(c.hours_points||0, maxComp, '#3b82f6')}
            <span class="dyn-bk-val">${cleanNumber(c.hours_points,1)}</span>
          </div>
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">📞</span>
            <span class="dyn-bk-lbl">КВЗ</span>
            ${bar(c.kvz||0, maxComp, '#10b981')}
            <span class="dyn-bk-val">${cleanNumber(c.kvz,2)}</span>
          </div>
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">⚡</span>
            <span class="dyn-bk-lbl">Эффективность</span>
            ${bar(c.efficiency||0, maxComp, '#8b5cf6')}
            <span class="dyn-bk-val">${cleanNumber(c.efficiency,1)}%</span>
          </div>
          ${(c.penalty_points||0) > 0 ? `<div class="dyn-bk-row">
            <span class="dyn-bk-icon">⚠</span>
            <span class="dyn-bk-lbl">Штрафы</span>
            ${bar(c.penalty_points||0, maxComp, '#ef4444')}
            <span class="dyn-bk-val dyn-bk-penalty">−${cleanNumber(c.penalty_points,1)}</span>
          </div>` : ''}
        </div>
      </div>`;
    }

    function renderNominations() {
      if (!noms.length) return `<div class="r-empty-state"><div class="r-empty-title">Номинации недели пока не определены.</div></div>`;
      return `<div class="nom-grid-v2">
        ${noms.map(n => `<div class="nom-card-v2 ${n.is_current_user?'nom-me-v2':''}">
          ${n.is_current_user ? '<div class="nom-you">Это вы</div>' : ''}
          <div class="nom-t">${esc(n.title || 'Номинация')}</div>
          <div class="nom-n">${esc(n.winner_name || 'Пока нет победителя')}</div>
          <div class="nom-v">${esc(n.value || 'Нет данных')}</div>
          <div class="nom-c">+${cleanCoins(n.coins_bonus, '0 ₡')}</div>
        </div>`).join('')}
      </div>`;
    }

    function renderTx() {
      const txs = Array.isArray(personal.myTx) ? personal.myTx.slice(0, 5) : [];
      if (canSelectOperator && !selectedOpId) return `<div class="r-empty-state">
        <div class="r-empty-title">Выберите оператора</div>
        <div class="r-empty-sub">Здесь будут последние начисления выбранного оператора.</div>
      </div>`;
      if (!txs.length) return `<div class="r-empty-state"><div class="r-empty-title">Начислений пока нет.</div></div>`;
      return txs.map(t => {
        const amount = Number(t.amount) || 0;
        const comment = t.comment || t.type || 'Операция';
        return `
        <div class="rtx2-row ${amount >= 0 ? 'rtx2-plus' : 'rtx2-minus'}">
          <div class="rtx2-amount">${amount >= 0 ? '+' : ''}${cleanCoins(amount)}</div>
          <div class="rtx2-comment" title="${esc(comment)}">${esc(comment)}</div>
          <div class="rtx2-date">${cleanDate(t.created_at, '')}</div>
        </div>`;
      }).join('');
    }

    function filteredRows() {
      const q = searchVal.trim().toLowerCase();
      return rows.filter(r =>
        (!q || String(r.operator_name || '').toLowerCase().includes(q)) &&
        (!filterGroup || r.group_name === filterGroup) &&
        (!filterLevel || r.level?.code === filterLevel)
      );
    }

    function renderTable() {
      const fr = filteredRows();
      if (!fr.length) return `<div class="r-empty-state">
        <div class="r-empty-title">Рейтинг пока не сформирован.</div>
        <div class="r-empty-sub">Данные появятся после расчёта конкурса.</div>
      </div>`;
      const myData = personal.myData || {};
      const myOpId = myData.operator_id || null;
      return `<div class="table-wrap rating-table-wrap"><table class="data-table rating-table">
        <thead><tr>
          <th scope="col" style="width:72px;text-align:center">Место</th>
          <th scope="col">Оператор</th><th scope="col">Группа</th>
          <th scope="col" style="text-align:right">Баллы</th>
          <th scope="col" style="text-align:right">Коины</th>
          <th scope="col" style="text-align:right">Баланс</th>
          <th scope="col" style="text-align:center">Дин.</th>
        </tr></thead>
        <tbody>
          ${fr.map(r => {
            const isMe = r.is_current_user || (myOpId && r.operator_id == myOpId) || (selectedOpId && r.operator_id == selectedOpId);
            const place = isNum(r.rank_position) && Number(r.rank_position) > 0 ? Number(r.rank_position) : null;
            const d = isNum(r.rank_delta) ? Number(r.rank_delta) : null;
            const dEl = d === null ? '<span class="rd-neutral">без изм.</span>'
              : d > 0 ? `<span class="rd-up">↑${d}</span>`
              : d < 0 ? `<span class="rd-down">↓${Math.abs(d)}</span>`
              : '<span class="rd-neutral">без изм.</span>';
            const badgeText = r.is_current_user ? 'Вы' : (selectedOpId && r.operator_id == selectedOpId ? 'Выбран' : '');
            return `<tr class="${isMe?'rating-my-row':''}">
              <td style="text-align:center">${place ? `<span class="rank-badge ${place <= 3 ? 'rank-top' : ''}">${place}</span>` : '<span class="rank-missing">Нет места</span>'}</td>
              <td class="name-cell">${esc(r.operator_name || 'Оператор')}${levelBadgeHtml(r.level)}${badgeText ? `<span class="me-badge">${badgeText}</span>` : ''}</td>
              <td>${esc(r.group_name || 'Группа не указана')}</td>
              <td style="text-align:right"><b>${cleanNumber(r.contest_points,1)}</b></td>
              <td style="text-align:right"><b class="accent-text">${cleanCoins(r.coins_earned)}</b></td>
              <td style="text-align:right">${cleanCoins(r.total_balance)}</td>
              <td style="text-align:center">${dEl}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      ${isNum(myData.place) && Number(myData.place) > 10 ? `<div class="rating-my-sticky">Ваше место: <b>#${Number(myData.place)}</b> · ${esc(myData.full_name||'')} · ${cleanNumber(myData.weekly_points,1)} баллов · ${cleanCoins(myData.weekly_coins)}</div>` : ''}`;
    }

    function buildPage() {
      el.innerHTML = `
        <div class="rating-page">

          ${renderHeader()}
          ${renderOpSelector()}

          <div class="rating-top-grid">
            ${renderMyResult()}
            <div class="rating-card rating-card-body">
              <div class="rcard-title">Топ-3 недели</div>
              ${renderPodium()}
            </div>
          </div>

          <div class="rating-mid-grid">
            <div class="rating-card rating-card-body">
              <div class="rcard-title-row">
                <span class="rcard-title">Сравнение</span>
                <div class="metric-tabs" id="cmp-tabs">
                  <button class="metric-tab ${cmpMetric === 'points' ? 'active' : ''}" data-metric="points">Баллы</button>
                  <button class="metric-tab ${cmpMetric === 'coins' ? 'active' : ''}" data-metric="coins">Коины</button>
                  <button class="metric-tab ${cmpMetric === 'quality' ? 'active' : ''}" data-metric="quality">Качество</button>
                  <button class="metric-tab ${cmpMetric === 'efficiency' ? 'active' : ''}" data-metric="efficiency">Эффективность</button>
                </div>
              </div>
              <div id="cmp-body">${renderComparison(personal.myCmp, cmpMetric)}</div>
            </div>
            <div class="rating-card rating-card-body">
              <div id="dyn-body">${uiLoadingBlock('Загружаем данные')}</div>
            </div>
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title">Номинации недели</div>
            ${renderNominations()}
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title">${isOp ? 'Мои последние начисления' : 'Последние начисления оператора'}</div>
            ${renderTx()}
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title-row">
              <span class="rcard-title">Общий рейтинг</span>
              <span class="panel-badge">${total} участников</span>
            </div>
            <div class="rating-filters">
              <input id="rating-search" class="form-input" placeholder="Поиск по ФИО…" style="max-width:240px">
              <select id="rating-group-filter" class="form-select" style="max-width:180px">
                <option value="">Все группы</option>
                ${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
              </select>
              <select id="rating-level-filter" class="form-select" style="max-width:170px">
                <option value="">Все уровни</option>
                ${levels.map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('')}
              </select>
            </div>
            <div id="rating-table-body">${renderTable()}</div>
          </div>

        </div>`;

      // Events
      el.querySelector('#rating-search')?.addEventListener('input', e => {
        searchVal = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-group-filter')?.addEventListener('change', e => {
        filterGroup = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-level-filter')?.addEventListener('change', e => {
        filterLevel = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-op-search')?.addEventListener('input', e => {
        operatorSearchVal = e.target.value;
        const select = el.querySelector('#rating-op-select');
        if (select) select.innerHTML = operatorOptionsHtml();
      });

      el.querySelectorAll('#cmp-tabs .metric-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
          el.querySelectorAll('#cmp-tabs .metric-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          cmpMetric = btn.dataset.metric;
          const body = el.querySelector('#cmp-body');
          if (body) body.innerHTML = '<div class="rating-inline-skeleton"></div>';
          // comparison не кешируем — данные специфичны для метрики
          personal.myCmp = await fetchComparisonData(selectedOpId, cmpMetric);
          if (body) body.innerHTML = renderComparison(personal.myCmp, cmpMetric);
        });
      });

      // dyn tabs are inside renderDynamics — handled by setDynMode

      el.querySelector('#rating-op-select')?.addEventListener('change', async e => {
        selectedOpId = e.target.value ? +e.target.value : null;
        // Инвалидируем кеш предыдущего оператора
        swrInvalidate(`rating:personal:${selectedOpId || 'me'}`);
        personal = await fetchPersonalData(selectedOpId);
        buildPage();
        setTimeout(() => loadPersonalExtras(), 50);
      });
    }

    buildPage();
    // Загружаем extras (динамика, сравнение) в фоне — не блокируем рендер
    setTimeout(async () => {
      await loadPersonalExtras();
      _cacheViewHtml('rating'); // кешируем HTML после полной загрузки
    }, 100);

  } catch(err) {
    const content = el.querySelector('.rating-page');
    if (content) content.innerHTML += `<div class="status-line status-error">Не удалось загрузить рейтинг: ${esc(err.message)}</div>`;
    else el.innerHTML += `<div class="status-line status-error">Не удалось загрузить рейтинг: ${esc(err.message)}</div>`;
  }
}

function miniRating(limit, highlightId) {
  const rows = Array.isArray(STATE.rating) ? STATE.rating.slice(0, limit) : [];
  if (!rows.length) return '<div class="empty-line">Нет данных</div>';
  return '<div class="mini-rating">' + rows.map((r, idx) => {
    const rank = r.rank_position || (idx + 1);
    const isMe = r.operator_id === highlightId;
    const topCls = rank <= 3 ? 'rank-top' : '';
    return `<div class="mini-rating-row ${isMe ? 'mini-me' : ''}">
      <span class="rank-badge ${topCls}">${rank}</span>
      <span class="mini-name">${esc(r.operator_name || 'Оператор')} ${levelBadgeHtml(r.level, 'level-badge-mini')}</span>
      <span class="mini-coins">${r.coins_earned || 0} ₡</span>
      <span class="mini-pts">${(r.contest_points || 0).toFixed(1)}</span>
    </div>`;
  }).join('') + '</div>';
}

/* ══════════════════════════════════════
   VIEW: МАГАЗИН
══════════════════════════════════════ */
const SHOP_CATEGORIES = {
  all: { label: 'Все бонусы' },
  quick: { label: 'Быстрые' },
  workday: { label: 'Комфорт на смене' },
  recognition: { label: 'Признание' },
  gifts: { label: 'Подарки' },
  other: { label: 'Другие' },
};
const SHOP_FILTERS = {
  all: 'Все',
  upto400: 'До 400',
  upto700: 'До 700',
  upto1100: 'До 1 100',
  digital: 'Цифровые',
  physical: 'Физические',
  privilege: 'Привилегии',
  in_stock: 'В наличии',
};
let _shopFilter = 'all';
let _shopAffordableOnly = false;
let _shopPurchaseIdempotencyKey = null;

function shopCategory(item) {
  return SHOP_CATEGORIES[item?.category] ? item.category : 'other';
}

function shopSalePrice(item) {
  return Number(item?.effective_price ?? item?.price) || 0;
}

function shopMatchesFilter(item, filter) {
  const price = shopSalePrice(item);
  if (filter === 'upto400') return price <= 400;
  if (filter === 'upto700') return price <= 700;
  if (filter === 'upto1100') return price <= 1100;
  if (filter === 'digital' || filter === 'physical' || filter === 'privilege') return item.prize_type === filter;
  if (filter === 'in_stock') return item.stock_remaining == null || item.stock_remaining > 0;
  return true;
}

function shopOrderStorageKey(itemId) {
  return `puls:shop-order:${itemId}`;
}

function shopOrderIdempotencyKey(itemId) {
  const storageKey = shopOrderStorageKey(itemId);
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const key = `shop-order:${itemId}:${random}`;
    sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return `shop-order:${itemId}:${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function shopCategoryIcon(category) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const paths = {
    quick: '<path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66 4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66 4.24-4.24"/>',
    workday: '<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 15h8"/>',
    recognition: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
    gifts: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8m4.5 0C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8"/>',
    other: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  };
  return `<svg ${common}>${paths[category] || paths.other}</svg>`;
}

function shopItemIcon(item) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const text = `${item?.title || ''} ${item?.category || ''}`.toLowerCase();
  let path = '';
  if (/музык|плейлист/.test(text)) path = '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>';
  else if (/кофе|чай/.test(text)) path = '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2M6 3v2m4-2v2m4-2v2"/>';
  else if (/перерыв|отдых/.test(text)) path = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  else if (/мест|смен/.test(text)) path = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8m-4-4v4"/>';
  else if (/круж/.test(text)) path = '<path d="M5 7h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7Z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/>';
  else if (/обед|пицц|еда/.test(text)) path = '<path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3m7 0v18m0-18c-2 2-3 4-3 7h3"/>';
  else if (/сертификат|подар/.test(text)) path = '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8m4.5 0C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8"/>';
  else if (/благодар|статус|звезд/.test(text)) path = '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>';
  else path = shopCategoryIcon(shopCategory(item)).replace(/^<svg[^>]*>|<\/svg>$/g, '');
  return `<svg ${common}>${path}</svg>`;
}

function shopAvailableCoupons() {
  return (STATE.shopDiscounts || [])
    .filter(coupon => coupon.status === 'available')
    .sort((a, b) => (Number(b.percent) - Number(a.percent)) || (Number(a.id) - Number(b.id)));
}

function shopItemState(item, balance, role = 'operator', coupon = null) {
  const levels = STATE.operatorLevels || [];
  const requiredLevel = item.min_level_id ? levels.find(level => level.id === item.min_level_id) : null;
  const currentLevel = STATE.myLevel?.level || null;
  const levelLocked = role === 'operator' && requiredLevel
    && (!currentLevel || (currentLevel.sort_order || 0) < (requiredLevel.sort_order || 0));
  const now = new Date();
  const notStartedYet = item.starts_at && new Date(item.starts_at) > now;
  const alreadyEnded = item.ends_at && new Date(item.ends_at) < now;
  const outOfStock = item.stock_remaining != null && item.stock_remaining <= 0;
  const personalLimitHit = !!item.operator_limit_reached;
  const blocked = !!(notStartedYet || alreadyEnded || outOfStock || personalLimitHit);
  const salePrice = shopSalePrice(item);
  const regularPrice = Number(item.regular_price ?? item.price) || salePrice;
  const discountPercent = coupon ? Math.max(1, Math.min(90, Number(coupon.percent) || 10)) : 0;
  const discountAmount = Math.floor(salePrice * discountPercent / 100);
  const effectivePrice = Math.max(0, salePrice - discountAmount);
  const canBuy = role === 'operator' && balance >= effectivePrice && !levelLocked && !blocked;
  const needMore = role === 'operator' && balance < effectivePrice ? effectivePrice - balance : 0;
  let label = 'Получить бонус';
  if (levelLocked) label = `С уровня «${requiredLevel.name}»`;
  else if (notStartedYet) label = `Доступно с ${fmtDate(item.starts_at)}`;
  else if (alreadyEnded) label = 'Предложение завершено';
  else if (outOfStock) label = 'Закончилось';
  else if (personalLimitHit) label = 'Лимит использован';
  else if (needMore > 0) label = `Нужно ещё ${needMore} коинов`;
  return {
    requiredLevel, levelLocked, notStartedYet, alreadyEnded, outOfStock,
    personalLimitHit, blocked, canBuy, needMore, label, salePrice, regularPrice,
    isSeasonalPrice: !!item.is_seasonal_price, discountPercent, discountAmount,
    effectivePrice, coupon,
  };
}

function renderShop() {
  const el = document.getElementById('view-shop');
  if (!el) return;
  const items = STATE.shopItems || [];
  const balance = STATE.wallet?.current_balance ?? 0;
  const role = STATE.user?.role;

  // Оператор выбирает бонус, штат ведёт каталог — это разные задачи и
  // разные экраны. Карточки оператора остались без изменений.
  if (role === 'operator') renderOperatorShop(el, items, balance);
  else renderStaffShop(el, items);
}

/* ══════════════════════════════════════════════════════════════
   МАГАЗИН ДЛЯ ШТАТА — управление каталогом

   Оператор и администратор пользуются магазином по-разному: оператор
   выбирает бонус, администратор ведёт каталог. Раньше штату показывалась
   та же сетка карточек, что и оператору, но с кнопкой «Изменить» на каждой:
   на 33 бонусах это 33 одинаковые кнопки без поиска, фильтров и сортировки.

   Карточки оператора не тронуты — renderOperatorShop остался прежним.
   Правила покупки и списания коинов здесь не участвуют: экран только
   читает каталог и открывает форму редактирования.
══════════════════════════════════════════════════════════════ */

const SHOP_ADMIN_SORTABLE = {
  title: { label: 'Бонус', type: 'text' },
  category: { label: 'Категория', type: 'text' },
  price: { label: 'Цена', type: 'number' },
  stock: { label: 'Наличие', type: 'number' },
  status: { label: 'Статус', type: 'text' },
};

const SHOP_PRIZE_TYPES = {
  physical: 'Вещь',
  digital: 'Цифровой',
  privilege: 'Привилегия',
};

function shopAdminState() {
  return STATE.shopAdmin || (STATE.shopAdmin = {
    search: '', category: '', status: '', stock: '',
    sortKey: 'title', sortDir: 'asc',
  });
}

function shopCategoryLabel(value) {
  return SHOP_CATEGORIES[value]?.label || 'Без категории';
}

/** Остаток: null означает «без ограничения», а не ноль. */
function shopStockValue(item) {
  return item.stock_remaining == null ? Infinity : Number(item.stock_remaining);
}

function shopStockLabel(item) {
  if (item.stock_remaining == null) return 'Без лимита';
  return item.stock_remaining > 0 ? `${item.stock_remaining} шт.` : 'Закончился';
}

function shopAdminFiltered(items) {
  const state = shopAdminState();
  const query = state.search.trim().toLowerCase();
  return items.filter(item => {
    const matchSearch = !query
      || (item.title || '').toLowerCase().includes(query)
      || (item.code || '').toLowerCase().includes(query)
      || (item.description || '').toLowerCase().includes(query);
    const matchCategory = !state.category || item.category === state.category;
    const matchStatus = !state.status
      || (state.status === 'active' ? item.is_active : !item.is_active);
    const matchStock = !state.stock || (
      state.stock === 'in' ? shopStockValue(item) > 0
        : state.stock === 'out' ? shopStockValue(item) <= 0
          : item.stock_remaining != null
    );
    return matchSearch && matchCategory && matchStatus && matchStock;
  });
}

function shopAdminSorted(list) {
  const { sortKey, sortDir } = shopAdminState();
  const spec = SHOP_ADMIN_SORTABLE[sortKey];
  if (!spec) return list;
  const value = item => {
    if (sortKey === 'price') return Number(item.effective_price ?? item.price ?? 0);
    if (sortKey === 'stock') return shopStockValue(item);
    if (sortKey === 'category') return shopCategoryLabel(item.category);
    if (sortKey === 'status') return item.is_active ? 'Активен' : 'Скрыт';
    return item.title || '';
  };
  return [...list].sort((a, b) => {
    const av = value(a); const bv = value(b);
    const cmp = spec.type === 'number'
      ? (av === bv ? 0 : av - bv)
      : String(av).localeCompare(String(bv), 'ru');
    return sortDir === 'desc' ? -cmp : cmp;
  });
}

function shopAdminTh(key, extraClass = '') {
  const state = shopAdminState();
  const active = state.sortKey === key;
  const ariaSort = active ? (state.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
  const arrow = active ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  return `<th scope="col" class="${extraClass}" aria-sort="${ariaSort}">`
    + `<button type="button" class="shop-admin-sort" data-shop-sort="${key}">`
    + `${esc(SHOP_ADMIN_SORTABLE[key].label)}<span aria-hidden="true">${arrow}</span></button></th>`;
}

function shopAdminHasFilters() {
  const s = shopAdminState();
  return Boolean(s.search || s.category || s.status || s.stock);
}

function renderStaffShop(el, items) {
  const state = shopAdminState();
  const rows = shopAdminSorted(shopAdminFiltered(items));
  const categories = [...new Set(items.map(item => item.category).filter(Boolean))].sort();
  const hidden = items.filter(item => !item.is_active).length;
  const outOfStock = items.filter(item => shopStockValue(item) <= 0).length;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Магазин</div>
        <h1 class="section-title">Каталог бонусов</h1>
        <p class="shop-admin-subtitle">Управление ассортиментом: состав, цена, наличие и видимость для операторов.</p>
      </div>
      <div class="header-right">
        <button class="btn-primary btn-sm" type="button" onclick="showAddItemModal()">+ Добавить бонус</button>
      </div>
    </div>

    <section class="shop-admin-summary" aria-label="Сводка каталога">
      <div><span>Всего бонусов</span><b>${items.length}</b></div>
      <div><span>Скрыты от операторов</span><b>${hidden}</b></div>
      <div><span>Закончились</span><b>${outOfStock}</b></div>
    </section>

    <div class="shop-admin-toolbar">
      <label class="sr-only" for="shop-admin-search">Поиск по каталогу</label>
      <input id="shop-admin-search" class="form-input" type="search" autocomplete="off"
             placeholder="Название, код или описание…" value="${esc(state.search)}">

      <label class="ui-filter-field">
        <span>Категория</span>
        <select id="shop-admin-category" class="form-select">
          <option value="">Все категории</option>
          ${categories.map(c => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(shopCategoryLabel(c))}</option>`).join('')}
        </select>
      </label>

      <label class="ui-filter-field">
        <span>Видимость</span>
        <select id="shop-admin-status" class="form-select">
          <option value="">Любая</option>
          <option value="active" ${state.status === 'active' ? 'selected' : ''}>Виден операторам</option>
          <option value="hidden" ${state.status === 'hidden' ? 'selected' : ''}>Скрыт</option>
        </select>
      </label>

      <label class="ui-filter-field">
        <span>Наличие</span>
        <select id="shop-admin-stock" class="form-select">
          <option value="">Любое</option>
          <option value="in" ${state.stock === 'in' ? 'selected' : ''}>В наличии</option>
          <option value="out" ${state.stock === 'out' ? 'selected' : ''}>Закончился</option>
          <option value="limited" ${state.stock === 'limited' ? 'selected' : ''}>С ограничением</option>
        </select>
      </label>

      <span class="shop-admin-count" aria-live="polite">Показано: <b>${rows.length}</b> из ${items.length}</span>
      ${shopAdminHasFilters() ? '<button type="button" class="btn-link" id="shop-admin-reset">Сбросить всё</button>' : ''}
    </div>

    <div class="table-wrap shop-admin-wrap">
      <table class="data-table shop-admin-table" data-mobile="cards">
        <thead><tr>
          ${shopAdminTh('title')}
          ${shopAdminTh('category')}
          ${shopAdminTh('price', 'num')}
          ${shopAdminTh('stock', 'num')}
          ${shopAdminTh('status', 'tc')}
          <th scope="col" class="tc shop-admin-actions-col">Действия</th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(item => `
            <tr class="${item.is_active ? '' : 'shop-admin-row-hidden'}">
              <td class="shop-admin-name" data-label="Бонус">
                <b>${esc(item.title)}</b>
                <small>${esc(SHOP_PRIZE_TYPES[item.prize_type] || item.prize_type || '')}${item.code ? ` · ${esc(item.code)}` : ''}</small>
              </td>
              <td data-label="Категория">${esc(shopCategoryLabel(item.category))}</td>
              <td class="num" data-label="Цена">${item.effective_price ?? item.price} ₡${
                item.is_seasonal_price && item.regular_price !== item.effective_price
                  ? `<small class="shop-admin-was">было ${item.regular_price}</small>` : ''}</td>
              <td class="num" data-label="Наличие">${esc(shopStockLabel(item))}</td>
              <td class="tc" data-label="Статус">
                <span class="shop-admin-badge ${item.is_active ? 'is-on' : 'is-off'}">${item.is_active ? 'Виден' : 'Скрыт'}</span>
              </td>
              <td class="tc" data-label="" >
                <button class="edit-item-btn btn-outline btn-sm" data-id="${item.id}"
                  aria-label="Изменить бонус: ${esc(item.title)}">Изменить</button>
              </td>
            </tr>`).join('')
            : `<tr><td colspan="6">${
                shopAdminHasFilters()
                  ? uiNoResultsState('Под фильтры ничего не подошло', 'Измените условия поиска или сбросьте фильтры.', [], true)
                  : uiEmptyState('Каталог пуст', 'Добавьте первый бонус кнопкой «Добавить бонус».', [], true)
              }</td></tr>`}
        </tbody>
      </table>
    </div>`;

  bindStaffShop(el, items);
}

function bindStaffShop(el, items) {
  const state = shopAdminState();
  const rerender = () => renderStaffShop(el, items);

  // Поиск с задержкой: каталог фильтруется на клиенте, но перерисовывать
  // таблицу на каждое нажатие клавиши незачем.
  const search = el.querySelector('#shop-admin-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', event => {
      state.search = event.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        rerender();
        // Возвращаем фокус и каретку в конец строки поиска.
        const field = el.querySelector('#shop-admin-search');
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }, 250);
    });
  }

  [['#shop-admin-category', 'category'], ['#shop-admin-status', 'status'], ['#shop-admin-stock', 'stock']]
    .forEach(([selector, key]) => {
      el.querySelector(selector)?.addEventListener('change', event => {
        state[key] = event.target.value;
        rerender();
        el.querySelector(selector)?.focus();
      });
    });

  el.querySelector('#shop-admin-reset')?.addEventListener('click', () => {
    Object.assign(state, { search: '', category: '', status: '', stock: '' });
    rerender();
  });

  el.querySelectorAll('[data-shop-sort]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.shopSort;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      rerender();
      el.querySelector(`[data-shop-sort="${key}"]`)?.focus();
    });
  });

  el.querySelectorAll('.edit-item-btn').forEach(button => {
    const item = items.find(candidate => candidate.id === Number(button.dataset.id));
    if (item) button.addEventListener('click', () => showEditItemModal(item));
  });
}

function renderOperatorShop(el, items, balance) {
  const purchases = STATE.purchases || [];
  const coupons = shopAvailableCoupons();
  const bestCoupon = coupons[0] || null;
  const states = new Map(items.map(item => [item.id, shopItemState(item, balance, 'operator', bestCoupon)]));
  const affordableCount = items.filter(item => states.get(item.id).canBuy).length;
  const activeRequests = purchases.filter(row => ['new', 'pending', 'approved'].includes(row.status)).length;
  const filteredItems = items.filter(item => shopMatchesFilter(item, _shopFilter));
  const visibleItems = filteredItems.filter(item => !_shopAffordableOnly || states.get(item.id).canBuy);

  el.innerHTML = `
    <div class="view-header shop-v2-header">
      <div>
        <div class="section-kicker">Магазин</div>
        <h1 class="section-title">Бонусы за ваши результаты</h1>
        <p class="shop-v2-subtitle">Обменивайте заработанные коины на полезные бонусы для работы и отдыха.</p>
      </div>
      <div class="shop-v2-header-meta">
        ${coupons.length ? `<div class="shop-v2-coupon-chip"><span>Скидки Wheel of WOW</span><b>${coupons.length} × ${bestCoupon.percent}%</b></div>` : ''}
        <div class="shop-v2-balance"><span>Ваш баланс</span><b>${balance} коинов</b></div>
      </div>
    </div>

    <section class="shop-v2-summary" aria-label="Сводка магазина">
      <div><span>Можно получить сейчас</span><b>${affordableCount}</b><small>по текущему балансу</small></div>
      <div><span>Активные заявки</span><b>${activeRequests}</b><small>ожидают или выполняются</small></div>
      <div><span>Скидки Wheel of WOW</span><b>${coupons.length}</b><small>${coupons.length ? `каждая применяется отдельно, по ${bestCoupon.percent}%` : 'пока нет доступных купонов'}</small></div>
    </section>

    <section class="panel shop-v2-catalog">
      <div class="shop-v2-catalog-head">
        <div><span>Каталог</span><h3>Выберите бонус</h3></div>
        <label class="shop-v2-affordable"><input type="checkbox" id="shop-affordable-only" ${_shopAffordableOnly ? 'checked' : ''}><span>Только доступные</span></label>
      </div>
      <div class="shop-v2-tabs" role="tablist">
        ${Object.entries(SHOP_FILTERS).map(([filter, label]) => {
          const count = items.filter(item => shopMatchesFilter(item, filter)).length;
          return `<button type="button" role="tab" aria-selected="${_shopFilter === filter}" class="shop-v2-tab ${_shopFilter === filter ? 'active' : ''}" data-shop-filter="${filter}">${label}<span>${count}</span></button>`;
        }).join('')}
      </div>
      <div class="shop-v2-grid">
        ${visibleItems.length ? visibleItems.map(item => shopOperatorCard(item, balance, states.get(item.id))).join('') : `
          <div class="shop-v2-empty"><b>В этой категории пока ничего нет</b><span>Снимите фильтр или выберите другой раздел каталога.</span></div>`}
      </div>
    </section>

    <section class="panel shop-v2-history">
      <div class="shop-v2-history-head"><div><span>Мои заказы</span><h3>История заявок</h3></div><b>${purchases.length}</b></div>
      ${shopPurchaseHistory(purchases, items)}
    </section>`;

  el.querySelectorAll('[data-shop-filter]').forEach(button => {
    button.addEventListener('click', () => {
      _shopFilter = button.dataset.shopFilter || 'all';
      renderShop();
    });
  });
  el.querySelector('#shop-affordable-only')?.addEventListener('change', event => {
    _shopAffordableOnly = event.target.checked;
    renderShop();
  });
  el.querySelectorAll('.shop-v2-buy').forEach(button => {
    button.addEventListener('click', () => openShopPurchaseModal(+button.dataset.id));
  });
}

function shopOperatorCard(item, balance, state = shopItemState(item, balance)) {
  const category = shopCategory(item);
  const badges = [];
  if (state.requiredLevel) badges.push(`<span>С уровня «${esc(state.requiredLevel.name)}»</span>`);
  if (item.stock_remaining != null) badges.push(`<span>${state.outOfStock ? 'Нет в наличии' : `В наличии: ${item.stock_remaining}`}</span>`);
  if (item.purchase_limit_per_operator > 0) {
    badges.push(`<span>Получено: ${item.operator_purchased_count || 0}</span>`);
    badges.push(`<span>Лимит: ${item.purchase_limit_per_operator} на сотрудника</span>`);
  }
  if (item.ends_at && !state.alreadyEnded) badges.push(`<span>До ${fmtDate(item.ends_at)}</span>`);
  if (state.isSeasonalPrice) badges.push(`<span>Стартовая цена до ${fmtDate(item.season_ends_at)}</span>`);
  if (item.issue_days) badges.push(`<span>Получение: до ${item.issue_days} дн.</span>`);
  return `<article class="shop-v2-card ${state.canBuy ? 'is-available' : ''} ${state.blocked ? 'is-blocked' : ''}">
    <div class="shop-v2-card-top">
      <span class="shop-v2-icon is-${category}">${shopItemIcon(item)}</span>
      <span class="shop-v2-category">${SHOP_CATEGORIES[category].label}</span>
    </div>
    <div class="shop-v2-card-copy"><h4>${esc(item.title)}</h4><p>${esc(item.description || item.issue_policy || '')}</p></div>
    ${badges.length ? `<div class="shop-v2-card-badges">${badges.join('')}</div>` : ''}
    <div class="shop-v2-card-footer">
      <div class="shop-v2-price-row">
        <div class="shop-v2-price-stack">
          ${state.discountPercent ? `<s>${state.salePrice}</s><b>${state.effectivePrice} <span>коинов</span></b><em>−${state.discountPercent}% по купону</em>` : `<b>${state.salePrice} <span>коинов</span></b>`}
          ${state.isSeasonalPrice ? `<em class="shop-v2-season-price">Стартовая цена · затем ${state.regularPrice}</em>` : ''}
        </div>
        ${state.needMore > 0 ? `<strong class="shop-v2-shortfall">Не хватает ${state.needMore} коинов</strong>` : '<small>спишутся после оформления</small>'}
      </div>
      <button type="button" class="${state.canBuy ? 'btn-primary' : 'btn-disabled'} shop-v2-buy" data-id="${item.id}" ${state.canBuy ? '' : 'disabled'}>${esc(state.label)}</button>
    </div>
  </article>`;
}

function shopPurchaseHistory(purchases, items) {
  if (!purchases.length) return '<div class="shop-v2-history-empty"><b>Заявок пока нет</b><span>Выбранные бонусы и их статусы появятся здесь.</span></div>';
  const statusMeta = {
    new: ['На рассмотрении', 'is-waiting'], pending: ['На рассмотрении', 'is-waiting'],
    approved: ['Одобрено', 'is-approved'], completed: ['Получено', 'is-completed'], rejected: ['Отклонено', 'is-rejected'],
    refunded: ['Возвращено', 'is-refunded'], expired: ['Срок истёк', 'is-expired'],
  };
  return `<div class="shop-v2-order-list">${purchases.slice(0, 8).map(row => {
    const item = items.find(candidate => candidate.id === row.shop_item_id);
    const meta = statusMeta[row.status] || [row.status, ''];
    return `<div class="shop-v2-order">
      <span class="shop-v2-order-icon">${shopItemIcon(item)}</span>
      <div><b>${esc(item?.title || `Бонус #${row.shop_item_id}`)}</b><small>${fmtDate(row.created_at)} · ${row.price} коинов${row.discount_percent ? ` · скидка ${row.discount_percent}%` : ''}${row.reject_reason ? ` · ${esc(row.reject_reason)}` : ''}</small></div>
      <span class="shop-v2-order-status ${meta[1]}">${meta[0]}</span>
    </div>`;
  }).join('')}</div>`;
}

function openShopPurchaseModal(itemId) {
  const item = (STATE.shopItems || []).find(candidate => candidate.id === itemId);
  if (!item) return;
  const balance = STATE.wallet?.current_balance ?? 0;
  const coupon = shopAvailableCoupons()[0] || null;
  const state = shopItemState(item, balance, 'operator', coupon);
  if (!state.canBuy) return;
  _shopPurchaseIdempotencyKey = shopOrderIdempotencyKey(itemId);
  const category = shopCategory(item);
  showModal(`
    <div class="shop-v2-confirm">
      <span class="shop-v2-icon is-${category}">${shopItemIcon(item)}</span>
      <div class="section-kicker">Подтверждение</div>
      <h3 class="modal-title">${esc(item.title)}</h3>
      <p>${esc(item.description || '')}</p>
      ${coupon ? `<label class="shop-v2-discount-option">
        <input type="checkbox" id="shop-use-discount" data-coupon-id="${coupon.id}" data-original-price="${state.salePrice}" data-discounted-price="${state.effectivePrice}" data-balance="${balance}" checked onchange="updateShopDiscountPreview()">
        <span><b>Применить скидку ${coupon.percent}%</b><small>Доступно купонов: ${shopAvailableCoupons().length}. Спишется только один.</small></span>
      </label>` : ''}
      <div class="shop-v2-confirm-price"><span>Стоимость</span><b id="shop-confirm-price">${state.effectivePrice} коинов</b></div>
      <div class="shop-v2-confirm-price"><span>Останется на балансе</span><b id="shop-confirm-rest">${Math.max(0, balance - state.effectivePrice)} коинов</b></div>
      ${state.isSeasonalPrice ? `<small>Стартовое предложение действует до ${fmtDate(item.season_ends_at)}. Обычная цена после сезона — ${state.regularPrice} коинов.</small>` : ''}
      ${item.issue_policy ? `<small><b>Получение:</b> ${esc(item.issue_policy)}</small>` : ''}
      <small>После оформления коины резервируются. Если заявку отклонят, они автоматически вернутся на баланс.</small>
      <div id="shop-buy-error" class="status-line"></div>
      <div class="shop-v2-confirm-actions"><button class="btn-outline" onclick="closeModal()">Отмена</button><button class="btn-primary" id="shop-confirm-buy" onclick="submitShopPurchase(${item.id})">Отправить заявку</button></div>
    </div>`);
}

function updateShopDiscountPreview() {
  const toggle = document.getElementById('shop-use-discount');
  if (!toggle) return;
  const originalPrice = Number(toggle.dataset.originalPrice) || 0;
  const discountedPrice = Number(toggle.dataset.discountedPrice) || originalPrice;
  const balance = Number(toggle.dataset.balance) || 0;
  const price = toggle.checked ? discountedPrice : originalPrice;
  const priceEl = document.getElementById('shop-confirm-price');
  const restEl = document.getElementById('shop-confirm-rest');
  const submit = document.getElementById('shop-confirm-buy');
  if (priceEl) priceEl.textContent = `${price} коинов`;
  if (restEl) restEl.textContent = `${Math.max(0, balance - price)} коинов`;
  if (submit) submit.disabled = balance < price;
}

async function submitShopPurchase(itemId) {
  const item = (STATE.shopItems || []).find(candidate => candidate.id === itemId);
  const button = document.getElementById('shop-confirm-buy');
  const error = document.getElementById('shop-buy-error');
  if (button) { button.disabled = true; button.textContent = 'Оформляем…'; }
  try {
    const couponToggle = document.getElementById('shop-use-discount');
    const couponId = couponToggle?.checked ? Number(couponToggle.dataset.couponId) : null;
    const order = await api.buyItem(itemId, couponId, _shopPurchaseIdempotencyKey);
    try { sessionStorage.removeItem(shopOrderStorageKey(itemId)); } catch {}
    _shopPurchaseIdempotencyKey = null;
    swrInvalidate('shop:');
    const [wallet, purchases, items, discounts] = await Promise.all([api.myWallet(), api.listPurchases(), api.listShopItems(), api.listShopDiscounts()]);
    STATE.wallet = wallet;
    STATE.purchases = purchases;
    STATE.shopItems = items;
    STATE.shopDiscounts = discounts;
    renderShop();
    const orderNumber = order.order_number || `PULS-${String(order.id).padStart(6, '0')}`;
    const workflowLabel = {
      created: 'создан', reserved: 'зарезервирован', ready: 'готов к выдаче',
      issued: 'выдан', cancelled: 'отменён', refunded: 'возвращён', expired: 'истёк',
    }[order.workflow_status] || 'на рассмотрении';
    showModal(`
      <div class="shop-v2-confirm shop-v2-success">
        <div class="section-kicker">Заказ создан</div>
        <h3 class="modal-title">Заказ ${esc(orderNumber)}</h3>
        <p>Статус: ${esc(workflowLabel)}. Коины зарезервированы и вернутся автоматически, если заказ будет отменён.</p>
        ${item?.issue_policy ? `<small><b>Получение:</b> ${esc(item.issue_policy)}</small>` : ''}
        <div class="shop-v2-confirm-actions"><button class="btn-primary" onclick="closeModal()">Понятно</button></div>
      </div>`);
    showToast(`Заказ ${orderNumber} создан`, 'ok');
  } catch (err) {
    if (error) error.textContent = err.message || 'Не удалось оформить заявку';
    if (button) { button.disabled = false; button.textContent = 'Отправить заявку'; }
  }
}

function shopCard(item, balance, role) {
  const state = shopItemState(item, balance, role);
  const { requiredLevel, notStartedYet, alreadyEnded, outOfStock, canBuy } = state;

  const seasonBadges = [];
  if (item.stock_remaining != null) seasonBadges.push(`<span class="shop-badge ${outOfStock ? 'shop-badge-danger' : ''}">В наличии: ${item.stock_remaining}</span>`);
  if (item.purchase_limit_per_operator > 0 && role === 'operator') {
    seasonBadges.push(`<span class="shop-badge">Получено: ${item.operator_purchased_count || 0}</span>`);
    seasonBadges.push(`<span class="shop-badge">Лимит: ${item.purchase_limit_per_operator} на сотрудника</span>`);
  }
  if (notStartedYet) seasonBadges.push(`<span class="shop-badge shop-badge-info">Скоро: с ${fmtDate(item.starts_at)}</span>`);
  else if (item.ends_at && !alreadyEnded) seasonBadges.push(`<span class="shop-badge shop-badge-info">До ${fmtDate(item.ends_at)}</span>`);
  else if (alreadyEnded) seasonBadges.push(`<span class="shop-badge shop-badge-danger">Завершено</span>`);

  return `<div class="shop-card ${canBuy?'shop-card-available':''} ${state.blocked && role==='operator' ? 'shop-card-unavailable' : ''}">
    <div class="shop-card-title">${esc(item.title)}</div>
    <div class="shop-card-desc">${esc(item.description)}</div>
    <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
    ${requiredLevel ? `<div class="shop-card-desc">Доступно с уровня «${esc(requiredLevel.name)}»</div>` : ''}
    ${seasonBadges.length ? `<div class="shop-card-badges">${seasonBadges.join('')}</div>` : ''}
    <div class="shop-card-footer">
      ${role==='operator' ? `<button class="buy-btn ${canBuy?'btn-primary':'btn-disabled'}" data-id="${item.id}" ${canBuy?'':'disabled'}>${state.label}</button>` : ''}
      ${isAdmin(role) ? `<button class="edit-item-btn btn-outline btn-sm" data-id="${item.id}">Изменить</button>` : ''}
    </div>
  </div>`;
}

/* ══════════════════════════════════════
   VIEW: СВОДКА (SUMMARY)
══════════════════════════════════════ */
function renderSummary() {
  return renderManagementSummary();
  /* Старый вариант оставлен ниже как совместимый fallback для старых сборок. */
  const el = document.getElementById('view-summary');
  if (!el) return;
  const d = STATE.dashboard;
  if (!d) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Сводка</div><h1 class="section-title">Рабочая сводка</h1></div></div>
      <div class="empty-state"><p>Загрузка данных…</p></div>`;
    const _summaryGen = STATE.navGen;
    api.getDashboard().then(data => {
      STATE.dashboard = data;
      if (!isNavStale(_summaryGen)) renderSummary();
    }).catch(() => {});
    return;
  }

  const leaders = d.top_5_operators || [];
  const groups = d.group_summary || [];
  const transactions = (d.latest_coin_transactions || []).slice(0, 6);
  const pending = d.pending_purchases_count || 0;
  const inactive = Math.max(0, (d.total_operators || 0) - (d.active_operators || 0));
  const lateness = d.total_lateness_week || 0;
  const violations = d.total_violations_week || 0;
  const disciplineTotal = lateness + violations;
  const maxGroupScore = Math.max(1, ...groups.map(group => Number(group.average_score) || 0));

  const initials = name => String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();

  el.innerHTML = `
    <div class="view-header summary-v2-header">
      <div>
        <div class="section-kicker">Сводка</div>
        <h1 class="section-title">Рабочая сводка</h1>
        <p class="summary-v2-subtitle">Главное за неделю: команда, результаты и вопросы, требующие решения.</p>
      </div>
      <div class="header-right">
        <span class="tx-date">Обновлено: ${fmtDateTime(d.last_updated)}</span>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
      </div>
    </div>

    <section class="summary-v2-kpis" aria-label="Ключевые показатели">
      <button class="summary-v2-kpi summary-v2-kpi-primary" onclick="navigateTo('operators')">
        <span class="summary-v2-kpi-label">Команда на линии</span>
        <strong>${d.active_operators}<small> из ${d.total_operators}</small></strong>
        <span>${inactive ? `${inactive} сейчас неактивны` : 'Все операторы активны'}</span>
      </button>
      <button class="summary-v2-kpi" onclick="navigateTo('rating')">
        <span class="summary-v2-kpi-label">Результат недели</span>
        <strong>${d.coins_earned_this_week}<small> коинов</small></strong>
        <span>Начислено команде</span>
      </button>
      <button class="summary-v2-kpi ${pending ? 'summary-v2-kpi-warning' : ''}" onclick="navigateTo('coins',{tab:'requests'})">
        <span class="summary-v2-kpi-label">Заявки магазина</span>
        <strong>${pending}</strong>
        <span>${pending ? 'Ожидают решения' : 'Новых заявок нет'}</span>
      </button>
      <button class="summary-v2-kpi ${disciplineTotal ? 'summary-v2-kpi-danger' : ''}" onclick="navigateTo('analytics')">
        <span class="summary-v2-kpi-label">Дисциплина</span>
        <strong>${disciplineTotal}</strong>
        <span>${lateness} опозданий · ${violations} нарушений</span>
      </button>
    </section>

    <section class="summary-v2-layout summary-v2-layout-leaders">
      <div class="panel summary-v2-panel summary-v2-leaders">
        <div class="panel-head">
          <div><h3>Лидеры недели</h3><p>Пять лучших результатов команды</p></div>
          <button class="btn-link" onclick="navigateTo('rating')">Открыть рейтинг</button>
        </div>
        ${leaders.length ? `<div class="summary-v2-leader-grid">
          ${leaders.map((op, index) => `
            <button class="summary-v2-leader" onclick="navigateTo('rating')">
              <span class="summary-v2-rank">${op.rank_position || index + 1}</span>
              <span class="summary-v2-avatar">${esc(initials(op.full_name))}</span>
              <span class="summary-v2-leader-name">${esc(op.full_name)}</span>
              <span class="summary-v2-leader-group">${esc(op.group_name || 'Без группы')}</span>
              <strong>${levelNum(op.final_score || 0)} балла</strong>
              <span>${op.coins_earned || 0} коинов</span>
            </button>`).join('')}
        </div>` : '<div class="summary-v2-empty">Рейтинг появится после первого расчёта периода.</div>'}
      </div>

      <div class="panel summary-v2-panel summary-v2-attention">
        <div class="panel-head"><div><h3>Требует внимания</h3><p>Задачи на текущий момент</p></div></div>
        <div class="summary-v2-attention-list">
          <button onclick="navigateTo('coins',{tab:'requests'})">
            <span class="summary-v2-status ${pending ? 'is-warning' : 'is-ok'}"></span>
            <span><strong>Заявки магазина</strong><small>${pending ? `${pending} ожидают решения` : 'Очередь обработана'}</small></span>
            <b>${pending}</b>
          </button>
          <button onclick="navigateTo('operators')">
            <span class="summary-v2-status ${inactive ? 'is-muted' : 'is-ok'}"></span>
            <span><strong>Активность команды</strong><small>${inactive ? `${inactive} операторов неактивны` : 'Вся команда активна'}</small></span>
            <b>${inactive}</b>
          </button>
          <button onclick="navigateTo('analytics')">
            <span class="summary-v2-status ${disciplineTotal ? 'is-danger' : 'is-ok'}"></span>
            <span><strong>Дисциплина недели</strong><small>${disciplineTotal ? 'Есть отклонения' : 'Отклонений нет'}</small></span>
            <b>${disciplineTotal}</b>
          </button>
        </div>
      </div>
    </section>

    <section class="summary-v2-layout">
      <div class="panel summary-v2-panel">
        <div class="panel-head"><div><h3>Группы</h3><p>Средний результат и общий баланс</p></div></div>
        <div class="summary-v2-group-list">
          ${groups.length ? groups.map(group => {
            const score = Number(group.average_score) || 0;
            const width = Math.max(4, Math.round(score / maxGroupScore * 100));
            return `<div class="summary-v2-group-row">
              <div><strong>${esc(group.group_name)}</strong><span>${group.operators_count} операторов</span></div>
              <div class="summary-v2-progress"><i style="width:${width}%"></i></div>
              <b>${levelNum(score)}</b>
              <span>${group.total_balance} коинов</span>
            </div>`;
          }).join('') : '<div class="summary-v2-empty">Группы пока не созданы.</div>'}
        </div>
      </div>

      <div class="panel summary-v2-panel">
        <div class="panel-head">
          <div><h3>Последние начисления</h3><p>Недавние изменения баланса</p></div>
          <button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Вся история</button>
        </div>
        <div class="summary-v2-activity-list">
          ${transactions.length ? transactions.map(t => `
            <div class="summary-v2-activity">
              <span class="summary-v2-avatar">${esc(initials(t.operator_name))}</span>
              <span><strong>${esc(t.operator_name)}</strong><small>${esc(t.comment || 'Операция с балансом')} · ${fmtDate(t.created_at)}</small></span>
              <b class="${t.amount >= 0 ? 'is-positive' : 'is-negative'}">${t.amount >= 0 ? '+' : ''}${t.amount}</b>
            </div>`).join('') : '<div class="summary-v2-empty">Операций пока нет.</div>'}
        </div>
      </div>
    </section>

    <section class="summary-v2-actions" aria-label="Быстрые переходы">
      <div><strong>Нужен подробный разбор?</strong><span>Показатели и динамика находятся в профильных разделах.</span></div>
      <button class="btn-outline" onclick="navigateTo('analytics')">Аналитика</button>
      <button class="btn-outline" onclick="navigateTo('period-report')">Расчёт периода</button>
      <button class="btn-outline" id="admin-summary-detail-toggle" onclick="toggleAdminSummaryDetail()">Расширенная выборка</button>
    </section>
    <div id="admin-summary-extra"></div>`;
}

/* ══════════════════════════════════════
   VIEW: ОПЕРАТОРЫ (ADMIN)
══════════════════════════════════════ */
