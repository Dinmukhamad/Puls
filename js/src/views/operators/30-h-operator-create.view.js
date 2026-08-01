/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Создание оператора и деактивация учётной записи. */

async function showAddOperatorModal() {
  let groups = [];
  let groupsError = '';
  try {
    groups = await swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS);
  } catch(e) {
    groupsError = 'Не удалось загрузить список групп';
  }

  const groupOptions = groups.length
    ? groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')
    : '';

  const groupField = groupsError
    ? `<div class="status-line status-error" style="padding:8px">${esc(groupsError)}</div>`
    : groups.length
      ? `<select id="new-op-group-id" class="form-select">
          <option value="">Выберите группу…</option>
          ${groupOptions}
        </select>`
      : `<div class="status-line" style="padding:8px;color:var(--tx3)">
          Группы не найдены. Создайте группу в разделе «Группы».
         </div>`;
  const canCreateRoles = STATE.user?.role === 'admin'
    ? ['operator','supervisor','manager','admin']
    : ['operator','supervisor'];
  const roleHint = {
    operator: 'Оператор — обычный пользователь системы',
    supervisor: 'Супервайзер — управление операторами своей группы',
    manager: 'Менеджер — управление операторами и супервайзерами',
    admin: 'Администратор — полный доступ',
  };

  showModal(`
    <h3 class="modal-title">Новый пользователь</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">ФИО <span style="color:var(--danger)">*</span></label>
        <input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович">
      </div>
      <div class="form-group">
        <label class="form-label">Логин <span style="color:var(--danger)">*</span></label>
        <input id="new-user-login" class="form-input" placeholder="ivanov_a">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="new-op-email" class="form-input" type="email" placeholder="ivanov@company.com">
      </div>
      <div class="form-group">
        <label class="form-label">Телефон</label>
        <input id="new-user-phone" class="form-input" placeholder="+7...">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Роль <span style="color:var(--danger)">*</span></label>
        <select id="new-user-role" class="form-select">
          ${canCreateRoles.map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
        </select>
        <div id="new-role-hint" class="form-hint">${esc(roleHint[canCreateRoles[0]])}</div>
      </div>
      <div class="form-group" id="new-user-group-field">
        <label class="form-label">Группа <span id="new-group-required" style="color:var(--danger)">*</span></label>
        ${groupField}
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Пароль <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password" class="form-input" type="password" placeholder="TempPassword123">
      </div>
      <div class="form-group">
        <label class="form-label">Повтор пароля <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password-confirm" class="form-input" type="password" placeholder="TempPassword123">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group" id="new-user-rate-field" style="display:none">
        <label class="form-label">Ставка <span style="color:var(--danger)">*</span></label>
        <select id="new-user-rate" class="form-select">
          <option value="">— не указана —</option>
          <option value="0.5">0.5 ставки</option>
          <option value="0.75">0.75 ставки</option>
          <option value="1.0">1.0 ставка</option>
        </select>
        <div class="form-hint">Используется для расчёта выполнения нормы часов</div>
      </div>
      <div class="form-group">
        <label class="form-label">Статус</label>
        <select id="new-user-status" class="form-select">
          <option value="active" selected>Активен</option>
          <option value="inactive">Неактивен</option>
          <option value="blocked">Заблокирован</option>
        </select>
      </div>
    </div>
    <div id="new-op-err" class="status-line"></div>
    <button id="create-operator-btn" class="btn-primary create-user-submit" onclick="submitAddOperator()" disabled>Создать пользователя</button>
    <div style="font-size:11px;color:var(--tx3);margin-top:6px">Пароль сохранится только в виде hash, при первом входе пользователь сменит его.</div>
  `, { className: 'modal-user-create' });

  const updateButton = () => {
    const btn = document.getElementById('create-operator-btn');
    const name = document.getElementById('new-op-name')?.value?.trim();
    const login = document.getElementById('new-user-login')?.value?.trim();
    const groupId = document.getElementById('new-op-group-id')?.value;
    const role = document.getElementById('new-user-role')?.value || 'operator';
    const pwd = document.getElementById('new-user-password')?.value || '';
    const confirm = document.getElementById('new-user-password-confirm')?.value || '';
    const needsGroup = role === 'operator' || role === 'supervisor';
    const isOperator = role === 'operator';
    const field = document.getElementById('new-user-group-field');
    const required = document.getElementById('new-group-required');
    const rateField = document.getElementById('new-user-rate-field');
    if (field) field.style.display = needsGroup ? '' : 'none';
    if (required) required.style.display = needsGroup ? '' : 'none';
    if (rateField) rateField.style.display = isOperator ? '' : 'none';
    setText('new-role-hint', roleHint[role] || '');
    if (btn) btn.disabled = !(name && name.length >= 2 && login && pwd.length >= 8 && pwd === confirm && (!needsGroup || groupId));
  };
  ['new-op-name', 'new-user-login', 'new-op-group-id', 'new-user-role', 'new-user-password', 'new-user-password-confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateButton);
    document.getElementById(id)?.addEventListener('change', updateButton);
  });
  updateButton();
}

async function submitAddOperator() {
  const name     = document.getElementById('new-op-name')?.value?.trim();
  const login    = document.getElementById('new-user-login')?.value?.trim();
  const groupId  = document.getElementById('new-op-group-id')?.value;
  const role     = document.getElementById('new-user-role')?.value || 'operator';
  const status   = document.getElementById('new-user-status')?.value || 'active';
  const email    = document.getElementById('new-op-email')?.value?.trim() || null;
  const phone    = document.getElementById('new-user-phone')?.value?.trim() || null;
  const password = document.getElementById('new-user-password')?.value || '';
  const confirm  = document.getElementById('new-user-password-confirm')?.value || '';
  const rateVal  = document.getElementById('new-user-rate')?.value || '';
  const rate     = rateVal ? parseFloat(rateVal) : null;
  const err      = document.getElementById('new-op-err');
  const btn      = document.getElementById('create-operator-btn');

  const setErr = msg => { err.textContent = msg; err.className = 'status-line status-error'; };

  if (!name || name.length < 2) return setErr('Укажите ФИО пользователя');
  if (!login) return setErr('Укажите логин');
  if ((role === 'operator' || role === 'supervisor') && !groupId) return setErr('Выберите группу');
  if (password.length < 8) return setErr('Пароль должен быть минимум 8 символов');
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) return setErr('Пароль должен содержать буквы и цифры');
  if (password !== confirm) return setErr('Пароли не совпадают');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Введите корректный email');

  err.textContent = 'Создаём…'; err.className = 'status-line';
  if (btn) btn.disabled = true;

  try {
    const result = await api.createUser({
      full_name: name,
      login,
      email: email || null,
      phone: phone || null,
      role,
      group_id: groupId ? +groupId : null,
      password,
      confirm_password: confirm,
      status,
    });

    // Сохраняем ставку если указана и это оператор
    if (role === 'operator' && rate && result.operator_id) {
      try {
        await api._req('PATCH', `/api/work-norms/operators/${result.operator_id}/rate`, { rate });
      } catch(e) {
        console.warn('Не удалось сохранить ставку:', e.message);
      }
    }

    const credentialText = `Пользователь: ${result.full_name}\nРоль: ${roleLabel(result.role)}\nЛогин: ${result.login || result.username}\nВременный пароль: ${password}`;

    showModal(
      '<h3 class="modal-title" style="color:var(--ok)">Пользователь создан</h3>' +
      '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:16px;display:grid;gap:8px;font-size:14px">' +
        '<div><span style="color:var(--tx3)">ФИО:</span> <b>' + esc(result.full_name) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Роль:</span> <b>' + esc(roleLabel(result.role)) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Группа:</span> <b>' + esc(result.group_name || '—') + '</b></div>' +
        '<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">' +
          '<span style="color:var(--tx3)">Логин:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(result.login || result.username) + '</b>' +
        '</div>' +
        '<div><span style="color:var(--tx3)">Временный пароль:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(password) + '</b></div>' +
      '</div>' +
      '<button id="copy-created-credentials" class="btn-outline" style="width:100%">Скопировать данные для входа</button>' +
      '<button class="btn-primary" style="width:100%" onclick="closeModal()">Готово</button>'
    );
    document.getElementById('copy-created-credentials')?.addEventListener('click', () => {
      navigator.clipboard.writeText(credentialText).then(() => showToast('Скопировано!', 'ok'));
    });
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) {
    setErr(e.message);
    if (btn) btn.disabled = false;
  }
}

async function deactivateUserUi(userId) {
  const user = STATE.users.find(u => u.id === userId);
  const confirmed = await uiConfirmAction({
    title: 'Деактивировать пользователя?',
    description: `${user?.full_name || 'Пользователь'} потеряет доступ к системе до повторной активации.`,
    confirmLabel: 'Деактивировать',
  });
  if (!confirmed) return;
  try {
    await api.deactivateUser(userId);
    showToast('Пользователь деактивирован', 'ok');
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}
