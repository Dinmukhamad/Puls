/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Группы: список и CRUD. */

/* ══════════════════════════════════════
   VIEW: ГРУППЫ
══════════════════════════════════════ */
async function renderGroups() {
  const el = document.getElementById('view-groups');
  if (!el) return;
  const myNavGen = STATE.navGen;

  if (!canManageGroups()) {
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      </div>
      <div class="empty-state"><p>Недостаточно прав для управления группами</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderGroups()">Обновить</button>
        <button class="btn-primary btn-sm" onclick="showAddGroupModal()">Создать группу</button>
      </div>
    </div>
    <div class="panel">
      <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка групп…</p></div>
    </div>`;

  try {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
        <button class="btn-outline btn-sm" onclick="renderGroups()">Повторить</button>
      </div>
      <div class="status-line status-error" style="padding:20px">Не удалось загрузить список групп</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return; // ушли с "Групп" пока ждали ответ сервера

  const rows = STATE.groups;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderGroups()">Обновить</button>
        <button class="btn-primary btn-sm" onclick="showAddGroupModal()">Создать группу</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Список групп</h3>
        <span class="panel-badge">${rows.length} групп</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Название группы</th>
            <th>Статус</th>
            <th>Количество операторов</th>
            <th>Действия</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(g => `
              <tr>
                <td class="name-cell">${esc(g.name)}</td>
                <td>${groupStatusBadge(g.status)}</td>
                <td>${g.operator_count || 0}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn-outline btn-sm" onclick="showEditGroupModal(${g.id})">Изменить</button>
                  <button class="btn-outline btn-sm" onclick="toggleGroupStatus(${g.id}, '${g.status === 'active' ? 'inactive' : 'active'}')">
                    ${g.status === 'active' ? 'Отключить' : 'Включить'}
                  </button>
                  ${STATE.user?.role === 'admin'
                    ? `<button class="btn-outline btn-sm danger-text" onclick="confirmDeleteGroup(${g.id})">Удалить</button>`
                    : ''}
                </td>
              </tr>`).join('') : '<tr><td colspan="4" class="empty-line">Группы не созданы</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function groupStatusBadge(status) {
  const isActive = status === 'active';
  return `<span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? 'Активна' : 'Отключена'}</span>`;
}

function showAddGroupModal() {
  showModal(`
    <h3 class="modal-title">Создание группы</h3>
    <div class="form-group">
      <label class="form-label">Название группы</label>
      <input id="group-name" class="form-input" placeholder="Группа звонков">
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select id="group-status" class="form-select">
        <option value="active" selected>Активна</option>
        <option value="inactive">Отключена</option>
      </select>
    </div>
    <div id="group-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddGroup()">Создать группу</button>`);
}

async function submitAddGroup() {
  const name = document.getElementById('group-name')?.value?.trim();
  const status = document.getElementById('group-status')?.value || 'active';
  const err = document.getElementById('group-err');
  if (!name) {
    err.textContent = 'Название группы обязательно';
    err.className = 'status-line status-error';
    return;
  }
  try {
    await api.createGroup({ name, status });
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа создана', 'ok');
    await renderGroups();
  } catch(e) {
    err.textContent = e.message;
    err.className = 'status-line status-error';
  }
}

function showEditGroupModal(id) {
  const group = STATE.groups.find(g => g.id === id);
  if (!group) return showToast('Группа не найдена', 'error');
  showModal(`
    <h3 class="modal-title">Редактировать группу</h3>
    <div class="form-group">
      <label class="form-label">Название группы</label>
      <input id="edit-group-name" class="form-input" value="${esc(group.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select id="edit-group-status" class="form-select">
        <option value="active" ${group.status === 'active' ? 'selected' : ''}>Активна</option>
        <option value="inactive" ${group.status === 'inactive' ? 'selected' : ''}>Отключена</option>
      </select>
    </div>
    <div id="edit-group-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditGroup(${id})">Сохранить</button>`);
}

async function submitEditGroup(id) {
  const name = document.getElementById('edit-group-name')?.value?.trim();
  const status = document.getElementById('edit-group-status')?.value || 'active';
  const err = document.getElementById('edit-group-err');
  if (!name) {
    err.textContent = 'Название группы обязательно';
    err.className = 'status-line status-error';
    return;
  }
  try {
    await api.updateGroup(id, { name, status });
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа обновлена', 'ok');
    await renderGroups();
  } catch(e) {
    err.textContent = e.message;
    err.className = 'status-line status-error';
  }
}

async function toggleGroupStatus(id, nextStatus) {
  if (nextStatus === 'inactive') {
    showModal(`
      <h3 class="modal-title">Отключить группу?</h3>
      <p style="color:var(--tx2);line-height:1.6">
        Новые операторы не смогут быть добавлены в эту группу, но текущие данные сохранятся.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn-danger" onclick="applyGroupStatus(${id}, 'inactive')">Отключить</button>
      </div>`);
    return;
  }
  await applyGroupStatus(id, nextStatus);
}

async function applyGroupStatus(id, nextStatus) {
  try {
    if (nextStatus === 'active') {
      await api.enableGroup(id);
    } else {
      await api.disableGroup(id);
    }
    swrInvalidate('groups:');
    closeModal();
    showToast(nextStatus === 'active' ? 'Группа включена' : 'Группа отключена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function confirmDeleteGroup(id) {
  if (STATE.user?.role !== 'admin') return showToast('Удалять группы может только администратор', 'error');
  const group = STATE.groups.find(g => g.id === id);
  if (!group) return showToast('Группа не найдена', 'error');
  showModal(`
    <h3 class="modal-title">Удалить группу?</h3>
    <p style="color:var(--tx2);line-height:1.6">
      Группу можно удалить только если в ней нет операторов и исторических данных.
      Это действие нельзя отменить.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-danger" onclick="deleteGroup(${id})">Удалить</button>
    </div>`);
}

async function deleteGroup(id) {
  try {
    await api.deleteGroup(id);
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа удалена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function ensureGroupsLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
  }
  return STATE.groups;
}

function groupOptionsForOperator(groups, selectedId) {
  return groups
    .filter(g => g.status === 'active' || g.id === selectedId)
    .map(g => `
      <option value="${g.id}" ${g.id === selectedId ? 'selected' : ''}>
        ${esc(g.name)}${g.status !== 'active' ? ' (отключена)' : ''}
      </option>`)
    .join('');
}
