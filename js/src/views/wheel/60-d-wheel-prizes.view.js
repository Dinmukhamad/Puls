/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Вкладка призов. */

let _wheelSelectedPrizeIds = new Set();

async function renderWheelPrizesTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:prizes',
    () => api.getWheelAdminPrizes(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('prizes', renderWheelPrizesTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка секторов');
    return;
  }
  const rows = data.items || [];
  _wheelSelectedPrizeIds = new Set([..._wheelSelectedPrizeIds].filter(id => rows.some(r => r.id === id)));
  const totalWeight = rows.filter(r => r.is_active).reduce((s, r) => s + (r.weight || 0), 0);
  const typeOptions = (val) => WHEEL_PRIZE_TYPES.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
  const chance = (w) => totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
  const typeOrder = new Map(WHEEL_PRIZE_TYPES.map(([value], index) => [value, index]));
  const groupedRows = [...rows]
    .sort((a, b) => {
      const typeDiff = (typeOrder.get(a.prize_type) ?? 999) - (typeOrder.get(b.prize_type) ?? 999);
      if (typeDiff) return typeDiff;
      if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
      const weightDiff = (b.weight || 0) - (a.weight || 0);
      if (weightDiff) return weightDiff;
      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    })
    .reduce((groups, row) => {
      let group = groups.find(item => item.type === row.prize_type);
      if (!group) {
        group = { type: row.prize_type, items: [] };
        groups.push(group);
      }
      group.items.push(row);
      return groups;
    }, []);
  const prizeRowHtml = (r) => `<article class="wheel-prize-card ${r.is_active ? '' : 'is-disabled'}" data-prize-id="${r.id}" style="--wheel-prize-color:${esc(r.color || '#38BDF8')}">
            <div class="wheel-prize-card-head">
              <label class="wheel-prize-select"><input type="checkbox" class="wp-select" ${_wheelSelectedPrizeIds.has(r.id) ? 'checked' : ''}><span>Выбрать</span></label>
              <div class="wheel-prize-card-summary">
                <span class="wheel-chance">${chance(r.is_active ? r.weight : 0)}% шанс</span>
                <span class="badge ${r.is_active ? 'badge-ok' : 'badge-muted'}">${r.is_active ? 'Активен' : 'Выключен'}</span>
              </div>
            </div>
            <div class="wheel-prize-identity">
              <label class="wheel-prize-color"><span class="form-label">Цвет</span><input type="color" class="wp-color" value="${esc(r.color || '#38BDF8')}" title="Цвет сектора"></label>
              <label class="form-group"><span class="form-label">Название приза</span><input type="text" class="form-input wp-title" value="${esc(r.title)}"></label>
            </div>
            <div class="wheel-prize-config">
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Награда</strong><span>Что получит оператор</span></div>
                <div class="wheel-prize-config-fields wheel-prize-reward-fields">
                  <label class="form-group wheel-prize-type"><span class="form-label">Тип</span><select class="form-input wp-type">${typeOptions(r.prize_type)}</select></label>
                  <label class="form-group"><span class="form-label">Количество</span><input type="number" class="form-input wp-amount" value="${r.amount}"></label>
                </div>
              </section>
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Вероятность</strong><span>Доля сектора на колесе</span></div>
                <label class="form-group"><span class="form-label">Вес приза</span><input type="number" class="form-input wp-weight" value="${r.weight}" min="0"></label>
              </section>
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Ограничения</strong><span>0 означает без лимита</span></div>
                <div class="wheel-prize-config-fields">
                  <label class="form-group"><span class="form-label">Всего выдач</span><input type="number" class="form-input wp-maxtotal" value="${r.max_wins_total}" min="0" title="0 — без лимита"></label>
                  <label class="form-group"><span class="form-label">Одному оператору</span><input type="number" class="form-input wp-maxop" value="${r.max_wins_per_operator}" min="0" title="0 — без лимита"></label>
                </div>
              </section>
            </div>
            <div class="wheel-prize-card-foot">
              <label class="wheel-switch-label"><input type="checkbox" class="wp-active" ${r.is_active ? 'checked' : ''}><span>Доступен для розыгрыша</span></label>
              <button class="btn-primary btn-sm wp-save">Сохранить изменения</button>
            </div>
          </article>`;
  const prizeGroupHtml = (group) => {
    const activeItems = group.items.filter(r => r.is_active);
    const groupWeight = activeItems.reduce((sum, r) => sum + (r.weight || 0), 0);
    const groupChance = totalWeight > 0 ? Math.round((groupWeight / totalWeight) * 100) : 0;
    const rawLabel = wheelPrizeTypeLabel(group.type) || group.type || 'Другое';
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    return `<section class="wheel-prize-group">
              <div class="wheel-prize-group-title">
                <div><span class="wheel-prize-group-name">${esc(label)}</span><small>${group.items.length} ${group.items.length === 1 ? 'приз' : 'приза'}</small></div>
                <span class="wheel-prize-group-meta">Активных: ${activeItems.length} · общий шанс: ${groupChance}%</span>
              </div>
              <div class="wheel-prize-card-grid">${group.items.map(prizeRowHtml).join('')}</div>
            </section>`;
  };

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <div><h3>Призы колеса</h3><p class="panel-hint">Каждая карточка — отдельный сектор. Чем больше вес, тем выше вероятность выпадения.</p></div>
        <span class="panel-badge">${rows.length} призов · вес ${totalWeight}</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-bulk-bar ${_wheelSelectedPrizeIds.size ? 'is-visible' : ''}" id="wheel-bulk-bar">
          <span><b id="wheel-bulk-count">${_wheelSelectedPrizeIds.size}</b> выбрано</span>
          <button class="btn-outline btn-sm" id="wheel-bulk-disable">Отключить выбранные</button>
          <button class="btn-outline btn-sm" id="wheel-bulk-enable">Включить выбранные</button>
          <button class="btn-link" id="wheel-bulk-clear">Снять выбор</button>
        </div>
        <label class="wheel-select-all"><input type="checkbox" id="wp-select-all"><span>Выбрать все призы</span></label>
        <div class="wheel-prize-groups">${groupedRows.map(prizeGroupHtml).join('') || '<div class="empty-state wheel-empty"><p>Призов пока нет.</p></div>'}</div>
        <div class="wheel-newprize">
          <h4 class="panel-subtitle">Добавить сектор</h4>
          <div class="form-grid wheel-newprize-grid">
            <label class="wheel-newprize-field"><span class="form-label">Название</span><input type="text" id="np-title" class="form-input" placeholder="Название"></label>
            <label class="wheel-newprize-field"><span class="form-label">Тип</span><select id="np-type" class="form-input">${typeOptions('coins')}</select></label>
            <label class="wheel-newprize-field"><span class="form-label">Кол-во</span><input type="number" id="np-amount" class="form-input" placeholder="Кол-во" value="1"></label>
            <label class="wheel-newprize-field"><span class="form-label">Вес</span><input type="number" id="np-weight" class="form-input" placeholder="Вес" value="10" min="0"></label>
            <label class="wheel-newprize-field"><span class="form-label">Цвет</span><input type="color" id="np-color" value="#38BDF8"></label>
            <button class="btn-primary" id="np-add">Добавить</button>
          </div>
          <div id="np-status" class="status-line" style="margin-top:8px"></div>
        </div>
        <div class="status-line muted" style="margin-top:10px">Сектор «ничего» запрещён (ТЗ п.6.3): минимальный приз — «+1 коин». Чтобы убрать сектор, выключите «Активен» (или выберите несколько и нажмите «Отключить выбранные»).</div>
      </div>
    </div>`;

  function updateBulkBar() {
    const bar = document.getElementById('wheel-bulk-bar');
    const count = document.getElementById('wheel-bulk-count');
    if (!bar || !count) return;
    count.textContent = _wheelSelectedPrizeIds.size;
    bar.classList.toggle('is-visible', _wheelSelectedPrizeIds.size > 0);
  }

  body.querySelectorAll('[data-prize-id]').forEach(card => {
    const id = parseInt(card.dataset.prizeId, 10);
    card.querySelector('.wp-select').onchange = (e) => {
      if (e.target.checked) _wheelSelectedPrizeIds.add(id);
      else _wheelSelectedPrizeIds.delete(id);
      updateBulkBar();
    };
    card.querySelector('.wp-save').onclick = async () => {
      const payload = {
        title: card.querySelector('.wp-title').value.trim(),
        prize_type: card.querySelector('.wp-type').value,
        amount: parseInt(card.querySelector('.wp-amount').value, 10) || 0,
        weight: parseInt(card.querySelector('.wp-weight').value, 10) || 0,
        color: card.querySelector('.wp-color').value,
        max_wins_total: parseInt(card.querySelector('.wp-maxtotal').value, 10) || 0,
        max_wins_per_operator: parseInt(card.querySelector('.wp-maxop').value, 10) || 0,
        is_active: card.querySelector('.wp-active').checked,
      };
      if (!payload.title) { showToast('Укажите название сектора', 'error'); return; }
      try {
        await api.updateWheelPrize(id, payload);
        swrInvalidate('wheel:admin:prizes');
        swrInvalidate('wheel:prizes');
        showToast('Сектор сохранён', 'ok');
        renderWheelPrizesTab(body);
      } catch (err) { showToast(err.message || 'Не удалось сохранить', 'error'); }
    };
  });

  document.getElementById('wp-select-all').onchange = (e) => {
    body.querySelectorAll('[data-prize-id]').forEach(card => {
      const id = parseInt(card.dataset.prizeId, 10);
      card.querySelector('.wp-select').checked = e.target.checked;
      if (e.target.checked) _wheelSelectedPrizeIds.add(id); else _wheelSelectedPrizeIds.delete(id);
    });
    updateBulkBar();
  };

  async function bulkSetActive(isActive) {
    const ids = [..._wheelSelectedPrizeIds];
    if (!ids.length) return;
    if (!isActive) {
      const confirmed = await uiConfirmAction({
        title: 'Отключить выбранные секторы?',
        description: `${ids.length} ${pluralize(ids.length, 'сектор', 'сектора', 'секторов')} перестанут участвовать в Колесе WOW.`,
        confirmLabel: 'Отключить',
      });
      if (!confirmed) return;
    }
    const results = await Promise.allSettled(ids.map(id => api.updateWheelPrize(id, { is_active: isActive })));
    const failed = results.filter(r => r.status === 'rejected').length;
    swrInvalidate('wheel:admin:prizes');
    swrInvalidate('wheel:prizes');
    showToast(failed ? `Готово, но ${failed} не удалось` : `${isActive ? 'Включено' : 'Отключено'}: ${ids.length}`, failed ? 'error' : 'ok');
    _wheelSelectedPrizeIds.clear();
    renderWheelPrizesTab(body);
  }
  document.getElementById('wheel-bulk-disable').onclick = () => bulkSetActive(false);
  document.getElementById('wheel-bulk-enable').onclick = () => bulkSetActive(true);
  document.getElementById('wheel-bulk-clear').onclick = () => { _wheelSelectedPrizeIds.clear(); renderWheelPrizesTab(body); };

  document.getElementById('np-add').onclick = async () => {
    const statusEl = document.getElementById('np-status');
    const payload = {
      title: document.getElementById('np-title').value.trim(),
      prize_type: document.getElementById('np-type').value,
      amount: parseInt(document.getElementById('np-amount').value, 10) || 0,
      weight: parseInt(document.getElementById('np-weight').value, 10) || 0,
      color: document.getElementById('np-color').value,
    };
    if (!payload.title) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите название'; return; }
    try {
      await api.createWheelPrize(payload);
      swrInvalidate('wheel:admin:prizes');
      swrInvalidate('wheel:prizes');
      showToast('Сектор добавлен', 'ok');
      renderWheelPrizesTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось добавить';
    }
  };
}

/* ---------- Стафф: билеты (ТЗ 12.3, 17) ---------- */
