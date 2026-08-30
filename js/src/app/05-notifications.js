/* ══════════════════════════════════════
   УВЕДОМЛЕНИЯ (ТЗ P2) — колокольчик в сайдбаре, модалка со списком
══════════════════════════════════════ */

let _notificationPollTimer = null;
const NOTIFICATION_POLL_MS = 30000; // 30с — не хуже других SWR-опросов в приложении

function startNotificationPolling() {
  if (_notificationPollTimer) return; // reloadData() может вызвать loadData() повторно — не плодим таймеры
  _notificationPollTimer = setInterval(refreshNotificationBadge, NOTIFICATION_POLL_MS);
}

async function refreshNotificationBadge() {
  const badge = document.getElementById('side-bell-badge');
  if (!badge) return;
  try {
    const { unread_count } = await api.getUnreadNotificationCount();
    if (unread_count > 0) {
      badge.textContent = unread_count > 99 ? '99+' : String(unread_count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // не авторизован / сеть — тихо пропускаем, это фоновый опрос
  }
}

const _notificationTypeIcons = {
  achievement: '🏆', purchase_approved: '✅', purchase_rejected: '❌', purchase_completed: '🎁',
  weekly_accrual: '📊', wheel_prize: '🎡', manual_operation: '✍️',
};

function _notificationLinkTarget(link) {
  const known = ['cabinet', 'shop', 'wheel', 'rating', 'coins', 'summary'];
  return known.includes(link) ? link : null;
}

async function showNotificationsModal() {
  showModal(`
    <h3 class="modal-title">Уведомления</h3>
    <div class="notif-modal-actions">
      <button class="btn-link" id="notif-mark-all">Отметить все прочитанными</button>
    </div>
    <div id="notif-list-host">${uiListSkeleton(4)}</div>`);

  document.getElementById('notif-mark-all').onclick = async () => {
    try {
      await api.markAllNotificationsRead();
      await _loadNotificationsIntoModal();
      refreshNotificationBadge();
    } catch (e) { showToast(e.message, 'error'); }
  };

  await _loadNotificationsIntoModal();
  refreshNotificationBadge();
}

async function _loadNotificationsIntoModal() {
  const host = document.getElementById('notif-list-host');
  if (!host) return;
  let data;
  try {
    data = await api.listNotifications({ limit: 30 });
  } catch (e) {
    host.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  const items = data.items || [];
  host.innerHTML = items.length ? items.map(n => `
    <div class="notif-row ${n.is_read ? '' : 'is-unread'}" data-notif-id="${n.id}">
      <div class="notif-icon">${_notificationTypeIcons[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        ${n.body ? `<div class="notif-text">${esc(n.body)}</div>` : ''}
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
      ${!n.is_read ? '<span class="notif-dot" title="Не прочитано"></span>' : ''}
    </div>`).join('') : '<div class="empty-state">Пока нет уведомлений</div>';

  host.querySelectorAll('.notif-row').forEach(row => {
    row.addEventListener('click', async () => {
      const id = parseInt(row.dataset.notifId, 10);
      const notif = items.find(n => n.id === id);
      if (notif && !notif.is_read) {
        try {
          await api.markNotificationRead(id);
          row.classList.remove('is-unread');
          const dot = row.querySelector('.notif-dot');
          if (dot) dot.remove();
          refreshNotificationBadge();
        } catch { /* тихо — клик по уведомлению не должен ломать модалку */ }
      }
      const target = notif ? _notificationLinkTarget(notif.link) : null;
      if (target) { closeModal(); navigateTo(target); }
    });
  });
}
