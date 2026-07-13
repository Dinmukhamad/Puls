/* ── Личный кабинет (ТЗ §5) ──────────────────────────────── */
async function getMyCabinet() { return req('GET', '/api/cabinet/me'); }
async function getMyCabinetV2() { return req('GET', '/api/cabinet/me'); }
async function getOperatorCabinet(operatorId) { return req('GET', `/api/cabinet/operator/${operatorId}`); }

/* ── Настройки начислений (ТЗ §4) ────────────────────────── */
async function getCoinRulesSettings() { return req('GET', '/api/settings/coin-rules'); }
async function updateCoinRulesSettings(payload) { return req('PUT', '/api/settings/coin-rules', payload); }

/* ── Автоматический еженедельный расчёт (ТЗ §3) ──────────── */
async function previewWeeklyAccrual(periodStart, periodEnd) {
  return req('GET', `/api/weekly-results/preview?period_start=${periodStart}&period_end=${periodEnd}`);
}
async function applyWeeklyAccrual(payload) { return req('POST', '/api/weekly-results/apply', payload); }
async function listAccrualRuns() { return req('GET', '/api/weekly-results/runs'); }

/* ── Бейджи и достижения (ТЗ §7) ──────────────────────────── */
async function listAchievements() { return req('GET', '/api/achievements'); }
async function updateAchievement(id, payload) { return req('PATCH', `/api/achievements/${id}`, payload); }
async function getMyAchievements() { return req('GET', '/api/achievements/me'); }
async function getOperatorAchievements(operatorId) { return req('GET', `/api/achievements/operator/${operatorId}`); }
async function grantAchievement(id, payload) { return req('POST', `/api/achievements/${id}/grant`, payload); }

/* ── Админская сводка (ТЗ §9) ─────────────────────────────── */
async function getAdminSummary(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return req('GET', '/api/dashboard/admin-summary' + (qs ? '?' + qs : ''));
}

/* ── Экспорт CSV/XLSX (ТЗ §8) ─────────────────────────────── */
// Файловые ответы — не через req() (не JSON), просто собираем URL для
// window.open()/ссылки-скачивания. Куки уходят автоматически, т.к. это
// GET-навигация в пределах того же origin.
function exportUrl(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return base() + path + (qs ? '?' + qs : '');
}

/* ── Уведомления (ТЗ P2) ──────────────────────────────────── */
async function listNotifications(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return req('GET', '/api/notifications' + (qs ? '?' + qs : ''));
}
async function getUnreadNotificationCount() { return req('GET', '/api/notifications/unread-count'); }
async function markNotificationRead(id) { return req('POST', `/api/notifications/${id}/read`); }
async function markAllNotificationsRead() { return req('POST', '/api/notifications/read-all'); }

/* ── Розыгрыши (ТЗ P2) ──────────────────────────────────── */
async function getMyRaffles() { return req('GET', '/api/raffles'); }
async function enterRaffle(id, tickets) { return req('POST', `/api/raffles/${id}/enter`, { tickets }); }
async function listRafflesAdmin() { return req('GET', '/api/admin/raffles'); }
async function createRaffle(payload) { return req('POST', '/api/admin/raffles', payload); }
async function drawRaffle(id) { return req('POST', `/api/admin/raffles/${id}/draw`); }
async function cancelRaffle(id) { return req('POST', `/api/admin/raffles/${id}/cancel`); }
