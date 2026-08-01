/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Модальное окно управления пользователем и статусные хелперы. */

function userManagementInitials(fullName) {
  return String(fullName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();
}

function setUserManagementTab(tab) {
  document.querySelectorAll('.user-manage-tab').forEach(button => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.user-manage-panel').forEach(panel => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

async function showUserManagementModal(userId) {
  const user = STATE.users.find(item => item.id === userId);
  if (!user) return showToast('Пользователь не найден', 'error');

  showModal('<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка карточки пользователя…</p></div>', {
    className: 'modal-user-manage',
  });

  let groups = STATE.groups || [];
  try {
    if (!groups.length) groups = await ensureGroupsLoaded();
  } catch(e) {
    groups = [];
  }

  const isOperator = user.role === 'operator' && user.operator_id;
  const groupOptions = groups.map(group => `
    <option value="${group.id}" ${Number(user.group_id) === Number(group.id) ? 'selected' : ''}>
      ${esc(group.name)}${group.status !== 'active' ? ' (отключена)' : ''}
    </option>`).join('');
  const levelName = user.level?.name || 'Не назначен';
  const startDate = user.start_date || '';
  const statusOptions = [
    ['active', 'Активен'],
    ['inactive', 'Неактивен'],
    ['blocked', 'Заблокирован'],
    ['dismissed', 'Уволен'],
  ].map(([value, label]) => `<option value="${value}" ${user.status === value ? 'selected' : ''}>${label}</option>`).join('');

  showModal(`
    <div class="user-manage-header">
      <span class="user-manage-avatar">${esc(userManagementInitials(user.full_name))}</span>
      <div>
        <div class="section-kicker">Карточка сотрудника</div>
        <h3 class="modal-title">${esc(user.full_name)}</h3>
        <p>${roleLabel(user.role)}${user.group_name ? ` · ${esc(user.group_name)}` : ''}</p>
      </div>
      ${userStatusBadge(user.status)}
    </div>

    <div class="user-manage-tabs" role="tablist" aria-label="Разделы карточки">
      <button class="user-manage-tab is-active" data-tab="main" onclick="setUserManagementTab('main')">Основное</button>
      <button class="user-manage-tab" data-tab="work" onclick="setUserManagementTab('work')">Работа</button>
      <button class="user-manage-tab" data-tab="access" onclick="setUserManagementTab('access')">Доступ</button>
    </div>

    <div class="user-manage-body">
      <div class="user-manage-form">
        <section class="user-manage-panel" data-panel="main">
          <div class="user-manage-section-head"><h4>Личные данные</h4><p>Информация, которая отображается в Puls.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">ФИО</label>
              <input id="manage-user-name" class="form-input" value="${esc(user.full_name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Роль</label>
              <div class="user-manage-readonly">${roleBadge(user.role)}</div>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input id="manage-user-email" class="form-input" type="email" value="${esc(user.email || '')}" placeholder="user@company.com">
            </div>
            <div class="form-group">
              <label class="form-label">Телефон</label>
              <input id="manage-user-phone" class="form-input" value="${esc(user.phone || '')}" placeholder="+7...">
            </div>
          </div>
        </section>

        <section class="user-manage-panel" data-panel="work" hidden>
          <div class="user-manage-section-head"><h4>Рабочие параметры</h4><p>Группа, статус и параметры расчёта сотрудника.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Группа</label>
              <select id="manage-user-group" class="form-select">
                <option value="">Без группы</option>
                ${groupOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Статус аккаунта</label>
              <select id="manage-user-status" class="form-select">${statusOptions}</select>
            </div>
            ${isOperator ? `
              <div class="form-group">
                <label class="form-label">Должность</label>
                <select id="manage-user-position" class="form-select">
                  <option value="operator" ${(user.position || 'operator') === 'operator' ? 'selected' : ''}>Оператор</option>
                  <option value="chat_manager" ${user.position === 'chat_manager' ? 'selected' : ''}>Чат-менеджер</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Участие в рейтинге</label>
                <select id="manage-user-participation" class="form-select">
                  <option value="participating" ${user.participation_status !== 'not_participating' ? 'selected' : ''}>Участвует</option>
                  <option value="not_participating" ${user.participation_status === 'not_participating' ? 'selected' : ''}>Не участвует</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Ставка</label>
                <select id="manage-user-rate" class="form-select">
                  <option value="">Не указана</option>
                  <option value="0.5" ${Number(user.rate) === 0.5 ? 'selected' : ''}>0.5 ставки</option>
                  <option value="0.75" ${Number(user.rate) === 0.75 ? 'selected' : ''}>0.75 ставки</option>
                  <option value="1" ${Number(user.rate) === 1 ? 'selected' : ''}>1.0 ставка</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Дата начала работы</label>
                <input id="manage-user-start-date" class="form-input" type="date" value="${esc(startDate)}">
              </div>` : ''}
          </div>
          ${isOperator ? `<div class="user-manage-level-row">
            <div><span>Текущий уровень</span><strong>${esc(levelName)}</strong></div>
            <button class="btn-outline btn-sm" type="button" onclick="manualOperatorLevelUi(${user.operator_id})">Изменить уровень</button>
          </div>` : ''}
        </section>

        <section class="user-manage-panel" data-panel="access" hidden>
          <div class="user-manage-section-head"><h4>Доступ к системе</h4><p>Логин и служебные действия с аккаунтом.</p></div>
          <div class="form-group">
            <label class="form-label">Логин</label>
            <input id="manage-user-login" class="form-input" value="${esc(user.login || user.username || '')}">
          </div>
          <div class="user-manage-service-actions">
            <button class="btn-outline" type="button" onclick="showUserResetPasswordModal(${user.id})">Сбросить пароль</button>
            ${isOperator ? `<button class="btn-outline" type="button" onclick="showOperatorHistoryModal(${user.operator_id})">История изменений</button>` : ''}
          </div>
          ${user.status === 'active' ? `<div class="user-manage-danger-zone">
            <div><strong>Отключение аккаунта</strong><span>Пользователь потеряет доступ до повторной активации.</span></div>
            <button class="btn-outline" type="button" onclick="closeModal();deactivateUserUi(${user.id})">Деактивировать</button>
          </div>` : ''}
          ${STATE.user?.role === 'admin' && isOperator ? `<div class="user-manage-danger-zone">
            <div><strong>Удаление оператора</strong><span>Профиль, история расчётов, коины и учётная запись будут удалены без возможности восстановления.</span></div>
            <button class="btn-danger" type="button" onclick="confirmDeleteOperator(${user.operator_id})">Удалить оператора</button>
          </div>` : ''}
        </section>
      </div>
    </div>

    <div id="manage-user-error" class="status-line"></div>
    <div class="user-manage-footer">
      <button class="btn-outline" type="button" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" id="manage-user-save" type="button" onclick="submitUserManagement(${user.id})">Сохранить изменения</button>
    </div>
  `, { className: 'modal-user-manage' });
}

async function submitUserManagement(userId) {
  const user = STATE.users.find(item => item.id === userId);
  const error = document.getElementById('manage-user-error');
  const button = document.getElementById('manage-user-save');
  if (!user || !error || !button) return;

  const fullName = document.getElementById('manage-user-name')?.value?.trim() || '';
  const login = document.getElementById('manage-user-login')?.value?.trim() || '';
  const email = document.getElementById('manage-user-email')?.value?.trim() || null;
  const phone = document.getElementById('manage-user-phone')?.value?.trim() || null;
  const groupValue = document.getElementById('manage-user-group')?.value || '';
  const status = document.getElementById('manage-user-status')?.value || user.status;
  if (fullName.length < 2) {
    error.textContent = 'Укажите корректное ФИО';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (!login) {
    error.textContent = 'Логин не может быть пустым';
    error.className = 'status-line status-error';
    setUserManagementTab('access');
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    error.textContent = 'Введите корректный email';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (user.role === 'operator' && user.operator_id && !groupValue) {
    error.textContent = 'Выберите рабочую группу оператора';
    error.className = 'status-line status-error';
    setUserManagementTab('work');
    return;
  }

  const payload = {
    full_name: fullName,
    login,
    email,
    phone,
    group_id: groupValue ? Number(groupValue) : null,
    status,
  };
  if (user.role === 'operator' && user.operator_id) {
    const rateValue = document.getElementById('manage-user-rate')?.value || '';
    payload.position = document.getElementById('manage-user-position')?.value || 'operator';
    payload.participation_status = document.getElementById('manage-user-participation')?.value || 'participating';
    payload.start_date = document.getElementById('manage-user-start-date')?.value || null;
    payload.rate = rateValue ? Number(rateValue) : null;
  }

  button.disabled = true;
  button.textContent = 'Сохраняем…';
  error.textContent = '';
  try {
    const updated = await api.updateUser(userId, payload);
    STATE.users = STATE.users.map(item => item.id === userId ? updated : item);
    swrInvalidate('users:list');
    swrInvalidate('dashboard:operators');
    closeModal();
    renderAdminOperators();
    showToast('Данные пользователя обновлены', 'ok');
  } catch(e) {
    error.textContent = e.message;
    error.className = 'status-line status-error';
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
  }
}

function showUserResetPasswordModal(userId) {
  const user = STATE.users.find(u => u.id === userId);
  showModal(`
    <h3 class="modal-title">Сбросить пароль</h3>
    <div class="status-line" style="padding:0;color:var(--tx2)">Пользователь: <b>${esc(user?.full_name || '')}</b></div>
    <div class="form-group">
      <label class="form-label">Новый временный пароль</label>
      <input id="reset-user-password" class="form-input" type="password" placeholder="TempPassword123">
    </div>
    <div id="reset-user-password-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitUserResetPassword(${userId})">Сохранить</button>
  `);
}

async function submitUserResetPassword(userId) {
  const password = document.getElementById('reset-user-password')?.value || '';
  const err = document.getElementById('reset-user-password-error');
  if (password.length < 8 || !/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
    if (err) { err.textContent = 'Пароль должен быть минимум 8 символов и содержать буквы и цифры'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.resetUserPassword(userId, { new_password: password, must_change_password: true });
    closeModal();
    showToast('Пароль сброшен', 'ok');
  } catch(e) {
    if (err) { err.textContent = e.message; err.className = 'status-line status-error'; }
  }
}

function copyCredentials(name, login, password) {
  const text = `Оператор: ${name}\nЛогин: ${login}\nВременный пароль: ${password}`;
  navigator.clipboard.writeText(text).then(() => showToast('Скопировано!', 'ok'));
}

function participationStatusLabel(s) {
  return { participating: 'Участвует', not_participating: 'Не участвует' }[s] || s || '';
}

function isOperatorDismissed(o) {
  return (o?.employment_status || (o?.status === 'dismissed' ? 'dismissed' : 'active')) === 'dismissed';
}

function operatorStatusBadge(o) {
  if (isOperatorDismissed(o)) {
    return '<span class="status-badge status-archive">Уволен</span>';
  }
  const participates = (o?.participation_status || 'participating') === 'participating';
  return `<span class="status-badge ${participates ? 'status-active' : 'status-inactive'}">${participationStatusLabel(o?.participation_status || 'participating')}</span>`;
}

function positionLabel(s) {
  return { operator: 'Оператор', chat_manager: 'Чат-менеджер' }[s] || s || '';
}
