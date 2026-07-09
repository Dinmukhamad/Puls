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
      return isNum(v) ? `${Math.round(Number(v))} ₡` : fallback;
    }

    function cleanDate(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const date = new Date(dt);
      if (Number.isNaN(date.getTime())) return fallback;
      return date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
    }

    function cleanDateTime(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const date = new Date(dt);
      if (Number.isNaN(date.getTime())) return fallback;
      return date.toLocaleString('ru-RU', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
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
          <th style="width:72px;text-align:center">Место</th>
          <th>Оператор</th><th>Группа</th>
          <th style="text-align:right">Баллы</th>
          <th style="text-align:right">Коины</th>
          <th style="text-align:right">Баланс</th>
          <th style="text-align:center">Дин.</th>
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
              <div id="dyn-body"><div class="loading-state" style="min-height:120px"><div class="loading-spinner"></div></div></div>
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
function renderShop() {
  const el = document.getElementById('view-shop');
  if (!el) return;
  const items = STATE.shopItems;
  const balance = STATE.wallet?.current_balance ?? 0;
  const role = STATE.user?.role;

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Магазин</div><h2 class="section-title">Магазин бонусов</h2></div>
      <div class="header-right">
        ${role === 'operator' ? `<div class="balance-chip">Баланс: <b>${balance} ₡</b></div>` : ''}
        ${isAdmin(role) ? `<button class="btn-primary btn-sm" onclick="showAddItemModal()">+ Добавить бонус</button>` : ''}
      </div>
    </div>
    <div class="shop-grid">
      ${items.length ? items.map(item => shopCard(item, balance, role)).join('') : '<div class="empty-state">Магазин пуст</div>'}
    </div>`;

  el.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === +btn.dataset.id);
      if (!item || !confirm(`Купить «${item.title}» за ${item.price} ₡?`)) return;
      btn.disabled = true; btn.textContent = 'Оформляем…';
      try {
        await api.buyItem(item.id);
        STATE.wallet = await api.myWallet();
        STATE.purchases = await api.listPurchases();
        showToast('Заявка отправлена на рассмотрение', 'ok');
        renderShop();
      } catch(err) { showToast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Купить'; }
    });
  });
  el.querySelectorAll('.edit-item-btn').forEach(btn => {
    const item = items.find(i => i.id === +btn.dataset.id);
    if (item) btn.addEventListener('click', () => showEditItemModal(item));
  });
}

function shopCard(item, balance, role) {
  const levels = STATE.operatorLevels || [];
  const requiredLevel = item.min_level_id ? levels.find(l => l.id === item.min_level_id) : null;
  const currentLevel = STATE.myLevel?.level || null;
  const levelLocked = role === 'operator' && requiredLevel && (!currentLevel || (currentLevel.sort_order || 0) < (requiredLevel.sort_order || 0));
  const canBuy = role === 'operator' && balance >= item.price && !levelLocked;
  const needMore = role === 'operator' && balance < item.price ? item.price - balance : 0;
  return `<div class="shop-card ${canBuy?'shop-card-available':''}">
    <div class="shop-card-title">${esc(item.title)}</div>
    <div class="shop-card-desc">${esc(item.description)}</div>
    <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
    ${requiredLevel ? `<div class="shop-card-desc">Доступно с уровня «${esc(requiredLevel.name)}»</div>` : ''}
    <div class="shop-card-footer">
      ${role==='operator' ? `<button class="buy-btn ${canBuy?'btn-primary':'btn-disabled'}" data-id="${item.id}" ${canBuy?'':'disabled'}>
        ${canBuy ? 'Купить' : (levelLocked ? `Доступно с уровня «${esc(requiredLevel.name)}»` : `Нужно ещё ${needMore} ₡`)}</button>` : ''}
      ${isAdmin(role) ? `<button class="edit-item-btn btn-outline btn-sm" data-id="${item.id}">Изменить</button>` : ''}
    </div>
  </div>`;
}

/* ══════════════════════════════════════
   VIEW: СВОДКА (SUMMARY)
══════════════════════════════════════ */
function renderSummary() {
  const el = document.getElementById('view-summary');
  if (!el) return;
  const d = STATE.dashboard;
  if (!d) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Сводка</div><h2 class="section-title">Панель управления</h2></div></div>
      <div class="empty-state"><p>Загрузка данных…</p></div>`;
    const _summaryGen = STATE.navGen;
    api.getDashboard().then(data => {
      STATE.dashboard = data;
      if (!isNavStale(_summaryGen)) renderSummary();
    }).catch(() => {});
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Сводка</div><h2 class="section-title">Панель управления</h2></div>
      <div class="header-right">
        <span class="tx-date">Обновлено: ${fmtDateTime(d.last_updated)}</span>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
      </div>
    </div>

    <!-- KPI карточки -->
    <div class="kpi-grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Операторов</div>
        <div class="kpi-value">${d.active_operators}<span class="kpi-unit"> / ${d.total_operators}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Коинов за неделю</div>
        <div class="kpi-value">${d.coins_earned_this_week} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card ${d.pending_purchases_count > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Новых заявок</div>
        <div class="kpi-value">${d.pending_purchases_count}</div>
        ${d.pending_purchases_count > 0 ? `<div class="kpi-action"><button class="btn-link" onclick="navigateTo('coins',{tab:'requests'})">Рассмотреть →</button></div>` : ''}
      </div>
      <div class="kpi-card ${d.total_lateness_week > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Опозданий за неделю</div>
        <div class="kpi-value">${d.total_lateness_week}</div>
      </div>
      <div class="kpi-card ${d.total_violations_week > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Нарушений за неделю</div>
        <div class="kpi-value">${d.total_violations_week}</div>
      </div>
    </div>

    <!-- Заявки статусы -->
    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-label">Одобрено заявок</div>
        <div class="kpi-value" style="color:var(--ok)">${d.approved_purchases_count}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Отклонено заявок</div>
        <div class="kpi-value" style="color:var(--danger)">${d.rejected_purchases_count}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Групп</div>
        <div class="kpi-value">${d.group_summary?.length || 0}</div>
      </div>
    </div>

    <!-- Топ-5 + последние транзакции -->
    <div class="two-col-grid">
      <div class="panel">
        <div class="panel-head"><h3>Топ-5 недели</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>Оператор</th><th>Группа</th><th>Коины</th><th>Балл</th></tr></thead>
            <tbody>
              ${d.top_5_operators?.length ? d.top_5_operators.map(op => `
                <tr>
                  <td class="rank-cell"><span class="rank-badge ${op.rank_position<=3?'rank-top':''}">${op.rank_position||'—'}</span></td>
                  <td class="name-cell">${esc(op.full_name)}</td>
                  <td>${esc(op.group_name)}</td>
                  <td><b class="accent-text">${op.coins_earned} ₡</b></td>
                  <td>${op.final_score?.toFixed(1)||0}</td>
                </tr>`).join('') : '<tr><td colspan="5" class="empty-line">Нет данных</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Последние действия</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Все →</button></div>
        <div class="tx-list">
          ${d.latest_coin_transactions?.length ? d.latest_coin_transactions.slice(0,10).map(t => `
            <div class="tx-row ${t.amount>=0?'tx-plus':'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment"><b>${esc(t.operator_name)}</b> — ${esc(t.comment)}</span>
                <span class="tx-date">${esc(t.group_name)} · ${fmtDate(t.created_at)}</span>
              </div>
              <div class="tx-amount">${t.amount>=0?'+':''}${t.amount} ₡</div>
            </div>`).join('') : '<div class="empty-line">Нет данных</div>'}
        </div>
      </div>
    </div>

    <!-- Группы -->
    <div class="panel">
      <div class="panel-head"><h3>Сводка по группам</h3></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Группа</th><th>Операторов</th><th>Средний балл</th><th>Суммарный баланс</th></tr></thead>
          <tbody>
            ${d.group_summary?.map(g => `
              <tr>
                <td class="name-cell">${esc(g.group_name)}</td>
                <td>${g.operators_count}</td>
                <td>${(g.average_score||0).toFixed(1)}</td>
                <td><b>${g.total_balance} ₡</b></td>
              </tr>`).join('') || '<tr><td colspan="4" class="empty-line">Нет данных</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div id="admin-summary-extra"></div>`;

  renderAdminSummaryDetail();
}

/* ══════════════════════════════════════
   VIEW: ОПЕРАТОРЫ (ADMIN)
══════════════════════════════════════ */
