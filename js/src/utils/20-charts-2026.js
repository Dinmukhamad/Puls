/* ══════════════════════════════════════════════════════════════
   Графики для экранов редизайна 2026.

   Всё рисуется инлайновым SVG: внешних библиотек в проекте нет и
   тащить их ради пяти диаграмм незачем — бандл и так 890 КБ.

   Общие правила, чтобы диаграммы читались как одна система:
   · цвет берётся из токенов, а не задаётся числом;
   · линии 2px, точки не мельче 8px, скругления на концах;
   · подписи и значения — обычным текстом рядом, не только цветом,
     иначе диаграмма нечитаема при дальтонизме и на печати;
   · у каждой диаграмме есть текстовая альтернатива в aria-label.
══════════════════════════════════════════════════════════════ */

/** Точки → строка полилинии, вписанная в w×h с полями. */
function chartPoints(values, w, h, pad = 3) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (nums.length - 1);
  return nums.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
}

/**
 * Спарклайн: маленький график тренда внутри KPI-карточки.
 * tone: ok | warn | danger | neutral — совпадает со статусом карточки.
 */
function chartSparkline(values, { w = 240, h = 44, tone = 'neutral', label = '' } = {}) {
  const pts = chartPoints(values, w, h, 4);
  if (!pts) return '';
  const line = pts.map(p => p.join(',')).join(' ');
  const area = `${pts[0][0]},${h} ${line} ${pts[pts.length - 1][0]},${h}`;
  const last = pts[pts.length - 1];
  return `
    <svg class="ch-spark ch-tone-${tone}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
         role="img" aria-label="${esc(label || 'Динамика показателя')}">
      <polygon class="ch-spark-area" points="${area}"/>
      <polyline class="ch-spark-line" points="${line}" fill="none"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle class="ch-spark-dot" cx="${last[0]}" cy="${last[1]}" r="3"/>
    </svg>`;
}

/**
 * Кольцевой индикатор «Состояние команды»: значение из 100.
 * Цвет — по статусу, а не по числу: пороги живут на бэкенде.
 */
function chartGauge(value, { max = 100, tone = 'neutral', size = 132, caption = '' } = {}) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const share = Math.max(0, Math.min(1, (Number(value) || 0) / max));
  const mid = size / 2;
  return `
    <svg class="ch-gauge ch-tone-${tone}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
         role="img" aria-label="${esc(caption || `${value} из ${max}`)}">
      <circle class="ch-gauge-track" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="10"/>
      <circle class="ch-gauge-value" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="10"
              stroke-linecap="round" stroke-dasharray="${c}"
              stroke-dashoffset="${c * (1 - share)}"
              transform="rotate(-90 ${mid} ${mid})"/>
      <text class="ch-gauge-num" x="${mid}" y="${mid - 2}" text-anchor="middle" dominant-baseline="middle">${esc(String(value))}</text>
      <text class="ch-gauge-max" x="${mid}" y="${mid + 20}" text-anchor="middle">/${max}</text>
    </svg>`;
}

/**
 * Линейный график: текущий период сплошной линией, предыдущий пунктиром.
 * Точки подписаны значениями выборочно — не на каждой, иначе каша.
 */
function chartLine(series, { w = 760, h = 220, labels = [], unit = '', title = '' } = {}) {
  const current = series.current || [];
  const previous = series.previous || [];
  const all = [...current, ...previous].filter(v => Number.isFinite(v));
  if (all.length < 2) return `<p class="ch-empty">Недостаточно данных для графика</p>`;
  const padL = 42; const padR = 12; const padT = 18; const padB = 26;
  const min = Math.min(...all); const max = Math.max(...all);
  const lo = Math.floor(min - (max - min || 1) * 0.15);
  const hi = Math.ceil(max + (max - min || 1) * 0.15);
  const span = hi - lo || 1;
  const x = i => padL + (i * (w - padL - padR)) / Math.max(1, current.length - 1);
  const y = v => padT + (1 - (v - lo) / span) * (h - padT - padB);
  const path = vals => vals.map((v, i) => `${Math.round(x(i) * 10) / 10},${Math.round(y(v) * 10) / 10}`).join(' ');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];

  return `
    <svg class="ch-line" viewBox="0 0 ${w} ${h}" role="img"
         aria-label="${esc(title || 'Динамика показателя')}">
      ${ticks.map(t => `
        <line class="ch-grid" x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="ch-axis" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${t}${esc(unit)}</text>`).join('')}
      ${previous.length ? `<polyline class="ch-line-prev" points="${path(previous)}" fill="none"
        stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"/>` : ''}
      <polyline class="ch-line-cur" points="${path(current)}" fill="none"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${current.map((v, i) => `<circle class="ch-line-dot" cx="${x(i)}" cy="${y(v)}" r="4"><title>${esc(labels[i] || '')}: ${v}${esc(unit)}</title></circle>`).join('')}
      ${labels.map((l, i) => i % Math.ceil(labels.length / 7) === 0
        ? `<text class="ch-axis" x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>` : '').join('')}
    </svg>`;
}

/**
 * Кольцевая диаграмма распределения. Сегменты разделены зазором в 2px,
 * чтобы соседние доли не сливались; рядом обязательна легенда с числами.
 */
function chartDonut(items, { size = 168, thickness = 22, centerValue = '', centerLabel = '' } = {}) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  if (!total) return `<p class="ch-empty">Нет данных</p>`;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  let offset = 0;
  const arcs = items.map((item, idx) => {
    const share = (Number(item.value) || 0) / total;
    const len = Math.max(0, c * share - 2);   // 2px зазор между долями
    const el = `<circle class="ch-donut-arc ch-seq-${idx + 1}" cx="${mid}" cy="${mid}" r="${r}"
      fill="none" stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})"><title>${esc(item.label)}: ${item.value}</title></circle>`;
    offset += c * share;
    return el;
  }).join('');
  return `
    <svg class="ch-donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
         aria-label="${esc(items.map(i => `${i.label}: ${i.value}`).join(', '))}">
      <circle class="ch-donut-track" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${thickness}"/>
      ${arcs}
      ${centerValue ? `<text class="ch-donut-num" x="${mid}" y="${mid - 2}" text-anchor="middle" dominant-baseline="middle">${esc(centerValue)}</text>` : ''}
      ${centerLabel ? `<text class="ch-donut-cap" x="${mid}" y="${mid + 18}" text-anchor="middle">${esc(centerLabel)}</text>` : ''}
    </svg>`;
}

/** Легенда к кольцу: цвет + подпись + значение. Цвет никогда не единственный носитель смысла. */
function chartLegend(items) {
  return `<ul class="ch-legend">${items.map((i, idx) => `
    <li class="ch-legend-item">
      <span class="ch-legend-dot ch-seq-${idx + 1}" aria-hidden="true"></span>
      <span class="ch-legend-label">${esc(i.label)}</span>
      <span class="ch-legend-value">${esc(String(i.display ?? i.value))}</span>
    </li>`).join('')}</ul>`;
}

/** Полоса «где мы на шкале 0–100» с отметкой текущего значения. */
function chartScaleBar(value, { max = 100, tone = 'neutral', label = '' } = {}) {
  const share = Math.max(0, Math.min(1, (Number(value) || 0) / max));
  return `
    <div class="ch-scale ch-tone-${tone}" role="img"
         aria-label="${esc(label || `${value} из ${max}`)}">
      <div class="ch-scale-track"><span class="ch-scale-mark" style="left:${(share * 100).toFixed(1)}%"></span></div>
      <div class="ch-scale-ends"><span>0</span><span>${max}</span></div>
    </div>`;
}

/** Статус с бэкенда → тон диаграммы. Пороги считает сервер, фронт их не выдумывает. */
function chartTone(status) {
  if (status === 'stable' || status === 'ok' || status === 'good') return 'ok';
  if (status === 'critical') return 'danger';
  if (status === 'watch' || status === 'attention') return 'warn';
  return 'neutral';
}
