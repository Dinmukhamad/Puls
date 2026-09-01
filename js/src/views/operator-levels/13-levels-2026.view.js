/* ══════════════════════════════════════════════════════════════
   Экран «Уровни» (#operator-levels) по ТЗ.

   Объявлен позже 10-levels-cabinet.view.js и переопределяет тамошний
   renderOperatorLevelsSettings. Модалки и мутации пока переиспользуются
   как есть — они переносятся на примитивы отдельным шагом, и до тех пор
   экран не теряет ни одной возможности.

   Вкладка живёт в адресе: раздел объявлен с tabs в ROUTES, поэтому
   #operator-levels?tab=achievements переживает F5 и Back/Forward.
══════════════════════════════════════════════════════════════ */

const LEVELS_TAB_LABELS = {
  levels: { title: 'Уровни', sub: 'Этапы роста и условия' },
  achievements: { title: 'Достижения', sub: 'Награды за отдельные результаты' },
};

/** Уровни всегда показываются в порядке сервера. */
function levelsSorted(list) {
  return [...(list || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** Условие правила словами: цвет и иконка не должны быть единственным носителем смысла. */
function levelRuleText(rule) {
  if (rule.condition_text) return rule.condition_text;
  const label = rule.metric_label || rule.metric_code;
  if (rule.operator === 'between') return `${label}: от ${rule.value_min} до ${rule.value_max}`;
  // Бэкенд для lte сверяется только с value_max: подставлять сюда value_min
  // значило бы показать условие, которого на самом деле нет.
  if (rule.operator === 'lte') return `${label}: не больше ${rule.value_max}`;
  if (rule.operator === 'eq') return `${label}: ровно ${rule.value_min}`;
  return `${label}: от ${rule.value_min}`;
}

function levelRewardText(level) {
  // Серверный reward_label намеренно не используем: он собирается из одного
  // reward_coins и не смотрит на reward_once (router.py: _serialize_level),
  // поэтому у выключенной награды писал бы «N коинов при повышении».
  const parts = [];
  if (level.reward_coins) {
    // service.py: `if not level.reward_once: return None` — при снятом флаге
    // награда не начисляется вообще. Раньше здесь было «при каждом
    // присвоении», то есть подпись обещала обратное тому, что делает сервер.
    parts.push(level.reward_once
      ? `${level.reward_coins} ₡ один раз`
      : `${level.reward_coins} ₡ настроено, но начисление выключено`);
  }
  if (level.coin_multiplier_percent) parts.push(`коины ×${1 + level.coin_multiplier_percent / 100}`);
  if (level.shop_discount_percent) parts.push(`скидка ${level.shop_discount_percent}%`);
  return parts.join(' · ') || 'Без награды за повышение';
}

async function renderOperatorLevelsSettings() {
  const el = document.getElementById('view-operator-levels');
  if (!el) return;

  // Экран только для manager и admin. Раньше здесь была строка
  // «Недостаточно прав» без объяснения и без выхода.
  const role = STATE.user?.role;
  if (role !== 'manager' && role !== 'admin') {
    el.innerHTML = uiForbiddenState(
      'Раздел недоступен',
      'Настройка уровней доступна руководителю и администратору.',
      false,
      [{ id: 'back', label: 'Вернуться' }],
    );
    uiBindStateActions(el, { back: () => navigateTo(fallbackViewForRole(role)) });
    return;
  }

  const tab = normalizeLevelTab(STATE.routeTabs?.['operator-levels']);
  const generation = bumpNavGen();

  el.innerHTML = `
    <div class="lv">
      <header class="view-header lv-head">
        <div>
          <p class="section-kicker">Развитие команды</p>
          <h1 class="section-title">Уровни операторов</h1>
          <p class="section-subtitle">Настройте путь роста, условия каждого этапа и награды за повышение.</p>
        </div>
        <div class="lv-head-actions" id="lv-actions"></div>
      </header>
      <div class="lv-tabs" role="tablist" aria-label="Разделы настройки уровней">
        ${Object.entries(LEVELS_TAB_LABELS).map(([key, meta]) => `
          <button class="lv-tab${tab === key ? ' is-active' : ''}" role="tab"
                  id="lv-tab-${key}" aria-controls="lv-body"
                  aria-selected="${tab === key}"
                  tabindex="${tab === key ? '0' : '-1'}" data-lv-tab="${key}">
            <span class="lv-tab-title">${esc(meta.title)}</span>
            <span class="lv-tab-sub">${esc(meta.sub)}</span>
          </button>`).join('')}
      </div>
      <div id="lv-body" role="tabpanel" aria-labelledby="lv-tab-${tab}" tabindex="-1">
        ${uiPageLoader('Загружаем уровни')}
      </div>
    </div>`;

  const tabButtons = [...el.querySelectorAll('[data-lv-tab]')];
  tabButtons.forEach((btn, index) => {
    // Вкладка уходит в адрес — F5 и Back/Forward возвращают ту же.
    btn.addEventListener('click', () => navigateTo('operator-levels', { tab: btn.dataset.lvTab }));

    // Паттерн ARIA для вкладок: стрелки переводят фокус, но не переключают
    // раздел. Переключение грузит данные, и делать это на каждое нажатие
    // стрелки нельзя — выбор подтверждается Enter или пробелом.
    btn.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      let next = null;
      if (step) next = tabButtons[(index + step + tabButtons.length) % tabButtons.length];
      else if (event.key === 'Home') next = tabButtons[0];
      else if (event.key === 'End') next = tabButtons[tabButtons.length - 1];
      if (!next) return;
      event.preventDefault();
      tabButtons.forEach(item => item.setAttribute('tabindex', '-1'));
      next.setAttribute('tabindex', '0');
      next.focus();
    });
  });

  const body = el.querySelector('#lv-body');
  if (tab === 'achievements') {
    if (typeof renderAchievementsAdminTab === 'function') return renderAchievementsAdminTab(body);
    body.innerHTML = uiEmptyState('Достижения недоступны', 'Модуль достижений не загрузился.');
    return;
  }

  await renderLevelsList(body, el.querySelector('#lv-actions'), generation);
}

async function renderLevelsList(body, actionsHost, generation) {
  let levels = null;
  let rewards = null;
  const failures = [];

  // Награды не блокируют экран: если упали только они, уровни всё равно
  // показываем — ТЗ называет это частичным состоянием.
  const [levelsResult, rewardsResult] = await Promise.allSettled([
    api.listAdminOperatorLevels(),
    api.listOperatorLevelRewards(),
  ]);
  if (isNavStale(generation)) return;

  if (levelsResult.status === 'fulfilled') levels = levelsResult.value;
  else failures.push({ what: 'уровни', error: levelsResult.reason });
  if (rewardsResult.status === 'fulfilled') rewards = rewardsResult.value;
  else failures.push({ what: 'награды', error: rewardsResult.reason });

  // Полная ошибка: без уровней показывать нечего.
  if (!levels) {
    body.innerHTML = uiErrorStateFor(failures[0]?.error, { retryLabel: 'Загрузить снова' });
    uiBindStateActions(body, { retry: () => renderOperatorLevelsSettings() });
    return;
  }

  actionsHost.innerHTML = `
    <button class="btn-tertiary" type="button" data-lv="manual">Назначить вручную</button>
    <button class="btn-outline" type="button" data-lv="recalc">Пересчитать уровни</button>
    <button class="btn-primary" type="button" data-lv="create">Добавить уровень</button>`;
  actionsHost.querySelector('[data-lv="manual"]')
    ?.addEventListener('click', () => showManualAssignModal(levels));
  actionsHost.querySelector('[data-lv="recalc"]')
    ?.addEventListener('click', () => showRecalculateModal());
  actionsHost.querySelector('[data-lv="create"]')
    ?.addEventListener('click', () => showLevelFormModal());

  const sorted = levelsSorted(levels);
  // Отключать и включать уровни бэкенд разрешает только администратору,
  // поэтому руководителю кнопку не показываем, а не ловим 403 после клика.
  const isAdmin = STATE.user?.role === 'admin';
  const active = sorted.filter(l => l.is_active);
  const withRules = sorted.filter(l => (l.rules || []).length);

  // Пусто: ни одного уровня.
  if (!sorted.length) {
    body.innerHTML = uiEmptyState(
      'Уровней пока нет',
      'Заведите первый этап роста — операторы начнут получать его автоматически, как только выполнят условия.',
      [{ id: 'create', label: 'Добавить уровень' }],
    );
    // Та же форма, что и в шапке: раньше пустое состояние вело в старую
    // реализацию, где у полей нет подписей, а ошибка не связана с полем.
    uiBindStateActions(body, { create: () => showLevelFormModal() });
    return;
  }

  body.innerHTML = `
    ${failures.length ? uiPartialNotice(
      `Не удалось загрузить ${failures.map(f => f.what).join(' и ')}. Остальное показано полностью.`) : ''}

    <section class="lv-kpis" aria-label="Сводка по уровням">
      ${uiKpi({ label: 'Этапов роста', value: sorted.length, tone: 'neutral',
                note: `${active.length} участвуют в расчёте` })}
      ${uiKpi({ label: 'Условий перехода', value: sorted.reduce((s, l) => s + (l.rules || []).length, 0),
                tone: withRules.length === sorted.length ? 'ok' : 'warn',
                note: withRules.length === sorted.length
                  ? 'у каждого уровня есть условия'
                  : `${sorted.length - withRules.length} уровней без условий` })}
      ${uiKpi({ label: 'Наград настроено',
                value: sorted.filter(l => l.reward_coins || l.coin_multiplier_percent || l.shop_discount_percent).length,
                tone: 'neutral', note: 'разовый бонус при повышении' })}
    </section>

    <p class="lv-hint">
      Этапы идут сверху вниз. Оператор получает самый высокий уровень, для которого
      выполнены все обязательные условия.
    </p>

    <div class="lv-grid">
      ${sorted.map((level, index) => levelCard(level, index, isAdmin)).join('')}
    </div>`;

  bindLevelCards(body, sorted);
}

function levelCard(level, index, isAdmin) {
  const rules = level.rules || [];
  const inactive = !level.is_active;
  return `
    <article class="lv-card${inactive ? ' is-inactive' : ''}" data-lv-card="${level.id}">
      <header class="lv-card-head">
        <span class="lv-stage"><span class="sr-only">Этап </span>${level.stage_number ?? index + 1}</span>
        <div class="lv-card-title-wrap">
          <h3 class="lv-card-title">
            <span class="lv-dot" style="--lv-color:${esc(level.color || '#64748B')}" aria-hidden="true"></span>
            <span data-level-name>${esc(level.name)}</span>
          </h3>
          <p class="lv-card-code">
            <code>${esc(level.code)}</code>
            <span class="lv-state ${inactive ? 'is-off' : 'is-on'}">
              ${inactive ? 'Не участвует в расчёте' : 'Участвует в расчёте'}
            </span>
          </p>
        </div>
      </header>

      ${level.description ? `<p class="lv-card-desc">${esc(level.description)}</p>` : ''}

      <div class="lv-rules">
        <h4 class="lv-sub">Условия получения</h4>
        ${rules.length ? `<ul class="lv-rule-list">
          ${rules.map(rule => `
            <li class="lv-rule${rule.is_required ? '' : ' is-optional'}">
              <span class="lv-rule-text">${esc(levelRuleText(rule))}</span>
              ${rule.is_required ? '' : '<span class="lv-rule-tag">необязательное</span>'}
            </li>`).join('')}
        </ul>` : `<p class="lv-empty-inline">Условий нет — уровень не будет присвоен автоматически.</p>`}
      </div>

      <div class="lv-reward">
        <h4 class="lv-sub">Награда за повышение</h4>
        <p class="lv-reward-text">${esc(levelRewardText(level))}</p>
      </div>

      <footer class="lv-card-actions">
        <button class="btn-outline btn-sm" type="button" data-lv-edit
                aria-label="Редактировать уровень «${esc(level.name)}»">Редактировать</button>
        <button class="btn-tertiary btn-sm" type="button" data-lv-rules>
          Условия${rules.length ? ` · ${rules.length}` : ''}<span
            class="sr-only"> уровня «${esc(level.name)}»</span>
        </button>
        ${isAdmin ? `<button class="btn-tertiary btn-sm" type="button" data-lv-toggle
                aria-label="${inactive ? 'Включить' : 'Отключить'} уровень «${esc(level.name)}»">
          ${inactive ? 'Включить' : 'Отключить'}
        </button>` : ''}
      </footer>
    </article>`;
}

function bindLevelCards(host, levels) {
  host.querySelectorAll('[data-lv-card]').forEach(card => {
    const id = Number(card.dataset.lvCard);
    // Обработчики получают сам уровень: старый editOperatorLevelUi искал его
    // в STATE.operatorLevels, который этот экран не заполняет, и молча
    // выходил по `if (!level) return`.
    const level = levels.find(item => item.id === id);
    if (!level) return;
    card.querySelector('[data-lv-edit]')?.addEventListener('click', () => showLevelFormModal(level));
    card.querySelector('[data-lv-rules]')?.addEventListener('click', () => showLevelRulesModal(level));
    card.querySelector('[data-lv-toggle]')?.addEventListener('click', () => {
      if (level.is_active) return disableLevelUi(level);
      return enableLevelUi(level);
    });
  });
}

/** Включение — обычный PATCH; отдельный эндпоинт есть только у отключения. */
async function enableLevelUi(level) {
  if (STATE.user?.role !== 'admin') {
    showToast('Включать уровни может только администратор', 'error');
    return;
  }
  try {
    await api.updateOperatorLevel(level.id, { is_active: true });
    swrInvalidate('levels:');
    showToast('Уровень включён', 'success');
    await lvRefreshScreen();
  } catch (error) {
    showToast(error?.message || 'Не удалось включить уровень', 'error');
  }
}
