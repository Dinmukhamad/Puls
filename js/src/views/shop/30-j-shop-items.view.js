/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Товары магазина: создание и редактирование. */

function showAddItemModal() {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
  showModal(`
    <h3 class="modal-title">Добавить бонус в магазин</h3>
    <div class="form-group"><label class="form-label">Код приза</label>
      <input id="ni-code" class="form-input" maxlength="80" placeholder="coffee-500"></div>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ni-title" class="form-input" placeholder="Сертификат на кофе"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ni-desc" class="form-input" placeholder="Подарочная карта в кофейню"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ni-category" class="form-select">
        <option value="quick">Быстрые бонусы</option>
        <option value="workday">Комфорт на смене</option>
        <option value="recognition">Признание</option>
        <option value="gifts">Подарки</option>
        <option value="other">Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Тип приза</label>
      <select id="ni-prize-type" class="form-select">
        <option value="physical">Физический</option>
        <option value="digital">Цифровой</option>
        <option value="privilege">Привилегия</option>
      </select></div>
    <div class="form-group"><label class="form-label">Условия получения</label>
      <input id="ni-issue-policy" class="form-input" maxlength="500" placeholder="После подтверждения руководителем"></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Срок выдачи, дней</label>
        <input id="ni-issue-days" class="form-input" type="number" min="1" value="14"></div>
      <div class="form-group"><label class="form-label">URL изображения</label>
        <input id="ni-image-url" class="form-input" type="url" placeholder="https://..."></div>
    </div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ni-price" class="form-input" type="number" min="1" placeholder="120"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ni-min-level" class="form-select">
        <option value="">Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ni-starts" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ni-ends" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-stock" class="form-input" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-oplimit" class="form-input" type="number" min="0" value="0"></div>
    </div>
    <div id="ni-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddItem()">Добавить</button>`);
}
async function submitAddItem() {
  const code = document.getElementById('ni-code')?.value?.trim() || null;
  const title = document.getElementById('ni-title')?.value?.trim();
  const desc  = document.getElementById('ni-desc')?.value?.trim() || '';
  const category = document.getElementById('ni-category')?.value || 'other';
  const prize_type = document.getElementById('ni-prize-type')?.value || 'physical';
  const issue_policy = document.getElementById('ni-issue-policy')?.value?.trim() || null;
  const issue_days = +(document.getElementById('ni-issue-days')?.value || 14);
  const image_url = document.getElementById('ni-image-url')?.value?.trim() || null;
  const price = +document.getElementById('ni-price')?.value;
  const minLevelRaw = document.getElementById('ni-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const starts_at = document.getElementById('ni-starts')?.value || null;
  const ends_at = document.getElementById('ni-ends')?.value || null;
  const stock_limit = +(document.getElementById('ni-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ni-oplimit')?.value || 0);
  const err   = document.getElementById('ni-err');
  if (!title || !price) { err.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ code, title, description: desc, category, prize_type, image_url, issue_policy, issue_days, price, min_level_id, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

function showEditItemModal(item) {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}" ${item.min_level_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`)
    .join('');
  const toLocalInput = (iso) => iso ? String(iso).slice(0, 16) : '';
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group"><label class="form-label">Код приза</label>
      <input id="ei-code" class="form-input" maxlength="80" value="${esc(item.code || '')}"></div>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ei-title" class="form-input" value="${esc(item.title)}"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ei-desc" class="form-input" value="${esc(item.description)}"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ei-category" class="form-select">
        <option value="quick" ${item.category === 'quick' ? 'selected' : ''}>Быстрые бонусы</option>
        <option value="workday" ${item.category === 'workday' ? 'selected' : ''}>Комфорт на смене</option>
        <option value="recognition" ${item.category === 'recognition' ? 'selected' : ''}>Признание</option>
        <option value="gifts" ${item.category === 'gifts' ? 'selected' : ''}>Подарки</option>
        <option value="other" ${!item.category || item.category === 'other' ? 'selected' : ''}>Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Тип приза</label>
      <select id="ei-prize-type" class="form-select">
        <option value="physical" ${item.prize_type === 'physical' ? 'selected' : ''}>Физический</option>
        <option value="digital" ${item.prize_type === 'digital' ? 'selected' : ''}>Цифровой</option>
        <option value="privilege" ${item.prize_type === 'privilege' ? 'selected' : ''}>Привилегия</option>
      </select></div>
    <div class="form-group"><label class="form-label">Условия получения</label>
      <input id="ei-issue-policy" class="form-input" maxlength="500" value="${esc(item.issue_policy || '')}"></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Срок выдачи, дней</label>
        <input id="ei-issue-days" class="form-input" type="number" min="1" value="${item.issue_days ?? 14}"></div>
      <div class="form-group"><label class="form-label">URL изображения</label>
        <input id="ei-image-url" class="form-input" type="url" value="${esc(item.image_url || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ei-price" class="form-input" type="number" value="${item.price}"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ei-min-level" class="form-select">
        <option value="" ${!item.min_level_id ? 'selected' : ''}>Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="form-group"><label class="form-label">Статус</label>
      <select id="ei-active" class="form-select">
        <option value="true" ${item.is_active?'selected':''}>Активен</option>
        <option value="false" ${!item.is_active?'selected':''}>Отключён</option>
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ei-starts" class="form-input" type="datetime-local" value="${toLocalInput(item.starts_at)}"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ei-ends" class="form-input" type="datetime-local" value="${toLocalInput(item.ends_at)}"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-stock" class="form-input" type="number" min="0" value="${item.stock_limit ?? 0}"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-oplimit" class="form-input" type="number" min="0" value="${item.purchase_limit_per_operator ?? 0}"></div>
    </div>
    ${item.stock_remaining != null ? `<div class="status-line">Сейчас остаток: ${item.stock_remaining}</div>` : ''}
    <div id="ei-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditItem(${item.id})">Сохранить</button>`);
}
async function submitEditItem(id) {
  const code = document.getElementById('ei-code')?.value?.trim() || null;
  const title     = document.getElementById('ei-title')?.value?.trim();
  const description = document.getElementById('ei-desc')?.value?.trim() || '';
  const category  = document.getElementById('ei-category')?.value || 'other';
  const prize_type = document.getElementById('ei-prize-type')?.value || 'physical';
  const issue_policy = document.getElementById('ei-issue-policy')?.value?.trim() || null;
  const issue_days = +(document.getElementById('ei-issue-days')?.value || 14);
  const image_url = document.getElementById('ei-image-url')?.value?.trim() || null;
  const price     = +document.getElementById('ei-price')?.value;
  const minLevelRaw = document.getElementById('ei-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const is_active = document.getElementById('ei-active')?.value === 'true';
  const starts_at = document.getElementById('ei-starts')?.value || null;
  const ends_at = document.getElementById('ei-ends')?.value || null;
  const stock_limit = +(document.getElementById('ei-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ei-oplimit')?.value || 0);
  const err       = document.getElementById('ei-err');
  if (!title || !price) { err.textContent = 'Заполните поля'; return; }
  try {
    await api.updateShopItem(id, { code, title, description, category, prize_type, image_url, issue_policy, issue_days, price, min_level_id, is_active, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус обновлён', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}
