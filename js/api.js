/* Generated from js/src/api source files. Run npm run build after editing. */
/**
 * Puls — API client v3
 * Auth via HttpOnly cookie (pulse_access_token).
 * JWT is NOT stored in localStorage.
 */
'use strict';

const api = (() => {
  // Clean up legacy localStorage tokens
  localStorage.removeItem('puls_token');

  function base() {
    return typeof API_BASE !== 'undefined' ? API_BASE : '';
  }

  function getToken() {
    // No-op: token lives in HttpOnly cookie, not accessible via JS
    return null;
  }

  function headers() {
    // credentials: 'include' handles cookie automatically
    return { 'Content-Type': 'application/json' };
  }

  // FastAPI отдаёт 422 как data.detail = [{type, loc, msg, ctx}, ...] (Pydantic).
  // Раньше это просто уходило в JSON.stringify(...) и пользователь видел сырой
  // JSON вместо понятной ошибки — баг, влияющий на ЛЮБую форму в приложении,
  // не только на конкретную, где его заметили.
  const FIELD_LABELS_RU = {
    max_spins_per_day: 'Прокруток в день', max_spins_per_week: 'Прокруток в неделю',
    ticket_ttl_days: 'Срок действия билета', title: 'Название', description: 'Описание',
    price: 'Цена', amount: 'Количество', weight: 'Вес', reason: 'Причина', reason_text: 'Причина',
    comment: 'Комментарий', points_per_coin: 'Баллов за коин', quantity: 'Количество',
    operator_id: 'Оператор', operator_ids: 'Операторы', stock_limit: 'Лимит остатка',
    purchase_limit_per_operator: 'Лимит на оператора', starts_at: 'Дата начала', ends_at: 'Дата окончания',
  };

  function _formatValidationError(entry) {
    const field = Array.isArray(entry.loc) ? entry.loc[entry.loc.length - 1] : '';
    const label = FIELD_LABELS_RU[field] || (typeof field === 'string' ? field : '');
    const ctx = entry.ctx || {};
    let msg;
    if (entry.type === 'less_than_equal' && ctx.le != null) msg = `не больше ${ctx.le}`;
    else if (entry.type === 'greater_than_equal' && ctx.ge != null) msg = `не меньше ${ctx.ge}`;
    else if (entry.type === 'less_than' && ctx.lt != null) msg = `меньше ${ctx.lt}`;
    else if (entry.type === 'greater_than' && ctx.gt != null) msg = `больше ${ctx.gt}`;
    else if (entry.type === 'string_too_short' && ctx.min_length != null) msg = `минимум ${ctx.min_length} символов`;
    else if (entry.type === 'string_too_long' && ctx.max_length != null) msg = `максимум ${ctx.max_length} символов`;
    else if (entry.type === 'missing') msg = 'обязательное поле';
    else msg = entry.msg || 'некорректное значение';
    return label ? `${label}: ${msg}` : msg;
  }

  function _errorMessageFromResponse(data, status) {
    const detail = data.detail || data.error;
    if (Array.isArray(detail)) {
      const formatted = detail.map(_formatValidationError).filter(Boolean).join('; ');
      return formatted || `Ошибка ${status}`;
    }
    if (typeof detail === 'string') return detail;
    return `Ошибка ${status}`;
  }

  async function req(method, path, body) {
    const opts = {
      method,
      headers: headers(),
      credentials: 'include',  // Send HttpOnly cookie
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    // Защита от бесконечного "висения": без этого, если сервер реально не
    // отвечает (зависшее соединение к БД, deadlock и т.п.), fetch() ждёт
    // ответа навечно, и UI остаётся в состоянии "Загрузка..." без какой-либо
    // ошибки и без возможности выйти из этого состояния. 20 секунд — щедрый
    // запас для любого штатного запроса; если сервер не ответил за это время,
    // что-то реально не так, и пользователю нужно явное сообщение об ошибке,
    // а не вечный спиннер.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    opts.signal = controller.signal;

    let res;
    try {
      res = await fetch(base() + path, opts);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Сервер не отвечает (превышено время ожидания). Попробуйте обновить страницу.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = _errorMessageFromResponse(data, res.status);
      const error = new Error(msg);
      error.status = res.status;
      error.path = path;
      error.detail = data.detail; // необработанное значение — на случай, если кому-то нужен доступ к исходным данным
      if (res.status === 401 && path !== '/api/auth/me') {
        setTimeout(() => {
          if (typeof window !== 'undefined' && typeof window.handleAuthExpired === 'function') {
            window.handleAuthExpired(error);
          }
        }, 0);
      }
      throw error;
    }
    return data;
  }


  /* ── Auth ────────────────────────────────────────────────── */
  async function login(username, password) {
    if (!username || !password) throw new Error('Введите логин и пароль');
    // Backend sets HttpOnly cookie on success
    return req('POST', '/api/auth/login', { username, password });
  }

  async function me() {
    return req('GET', '/api/auth/me');
  }

  async function logout() {
    try {
      await req('POST', '/api/auth/logout');
    } catch {}
    // No localStorage to clear — cookie is cleared by backend
  }

  /* ── Operators ───────────────────────────────────────────── */
  function listOperators(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/operators' + (qs ? '?' + qs : ''));
  }
  function getOperator(id)         { return req('GET', `/api/operators/${id}`); }
  function myOperator()            { return req('GET', '/api/operators/me'); }
  function createOperator(p)       { return req('POST', '/api/operators', p); }
  function updateOperator(id, p)   { return req('PATCH', `/api/operators/${id}`, p); }
  function resetOperatorPassword(id) { return req('POST', `/api/operators/${id}/reset-password`); }
  function dismissOperator(id)     { return req('POST', `/api/operators/${id}/dismiss`); }
  function restoreOperator(id, p)  { return req('POST', `/api/operators/${id}/restore`, p); }
  function deleteOperator(id)      { return req('DELETE', `/api/operators/${id}`); }
  function operatorHistory(id)     { return req('GET', `/api/operators/${id}/history`); }

  /* ── Weekly results ──────────────────────────────────────── */
  function listWeekly(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/weekly-results' + (qs ? '?' + qs : ''));
  }
  function upsertWeekly(p)         { return req('POST', '/api/weekly-results', p); }

  /* ── Rating ──────────────────────────────────────────────── */
  function getRating(ws, we, limit, offset) {
    const params = {};
    if (ws && we) { params.week_start = ws; params.week_end = we; }
    if (limit != null) params.limit = limit;
    if (offset != null) params.offset = offset;
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/rating' + (qs ? '?' + qs : ''));
  }

  /* ── Wallet ──────────────────────────────────────────────── */
  function myWallet()              { return req('GET', '/api/wallet/me'); }
  function operatorWallet(id)      { return req('GET', `/api/wallet/${id}`); }
  function manualTransaction(p) {
    const amount = Number(p.amount || 0);
    return req('POST', '/api/coins/manual-operation', {
      operator_id: p.operator_id,
      operation: amount < 0 ? 'debit' : 'credit',
      amount: Math.abs(amount),
      reason: p.reason,
      comment: p.comment || '',
    });
  }

  /* ── Shop ────────────────────────────────────────────────── */
  function listShopItems()         { return req('GET', '/api/shop/items'); }
  function createShopItem(p)       { return req('POST', '/api/shop/items', p); }
  function updateShopItem(id, p)   { return req('PATCH', `/api/shop/items/${id}`, p); }
  function listPurchases(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/shop/purchases' + (qs ? '?' + qs : ''));
  }
  function buyItem(itemId)         { return req('POST', '/api/shop/purchases', { shop_item_id: itemId }); }
  function approvePurchase(id)     { return req('POST', `/api/shop/purchases/${id}/approve`); }
  function rejectPurchase(id, r)   { return req('POST', `/api/shop/purchases/${id}/reject`, { reason: r }); }

  /* ── Groups ─────────────────────────────────────────────── */
  function listGroups(activeOnly = false) {
    return req('GET', `/api/groups${activeOnly ? '?active_only=true' : ''}`);
  }
  function createGroup(p)          { return req('POST', '/api/groups', p); }
  function updateGroup(id, p)      { return req('PATCH', `/api/groups/${id}`, p); }
  function enableGroup(id)         { return req('POST', `/api/groups/${id}/enable`); }
  function disableGroup(id)        { return req('POST', `/api/groups/${id}/disable`); }
  function deleteGroup(id)         { return req('DELETE', `/api/groups/${id}`); }

  /* ── Dashboard ───────────────────────────────────────────── */
  function getDashboard()          { return req('GET', '/api/dashboard'); }

  /* ── Users (admin) ───────────────────────────────────────── */
  function createUser(p)           { return req('POST', '/api/users', p); }
  function listUsers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/users' + (qs ? '?' + qs : ''));
  }
  function updateUser(id, p)       { return req('PATCH', `/api/users/${id}`, p); }
  function deactivateUser(id)      { return req('POST', `/api/users/${id}/deactivate`); }
  function changeUserRole(id, p)   { return req('POST', `/api/users/${id}/change-role`, p); }
  function resetUserPassword(id, p){ return req('POST', `/api/users/${id}/reset-password`, p); }

  /* ── Sessions (admin) ───────────────────────────────────────── */
  function listSessions(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/admin/sessions' + (qs ? '?' + qs : ''));
  }
  function revokeSession(sessionId) {
    return req('POST', `/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`);
  }
  function revokeUserSessions(userId, excludeCurrent = true) {
    return req('POST', '/api/admin/sessions/revoke-user', {
      user_id: userId,
      exclude_current: excludeCurrent,
    });
  }

  function _base() { return base(); }


  /* ── Dashboard extras ───────────────────────────────────── */
  async function getDashboardOperators() {
    return req('GET', '/api/dashboard/operators');
  }
  async function getDashboardHistory(limit = 50) {
    return req('GET', `/api/dashboard/history?limit=${limit}`);
  }

  /* ── Account self-service ────────────────────────────────── */
  async function changeMyPassword(payload) {
    return req('PATCH', '/api/auth/me/password', payload);
  }
  async function changeMyLogin(payload) {
    return req('PATCH', '/api/auth/me/login', payload);
  }
  async function changeOperatorPassword(payload) {
    return req('POST', '/api/operators/account/change-password', payload);
  }
  async function changeOperatorUsername(payload) {
    return req('POST', '/api/operators/account/change-username', payload);
  }

  /* ── Shop ────────────────────────────────────────────────── */
  async function completePurchase(purchaseId) {
    return req('POST', `/api/shop/purchases/${purchaseId}/complete`);
  }

  async function getCoinsOverview() {
    return req('GET', '/api/coins/overview');
  }
  async function listCoinRequests(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/coins/requests' + (qs ? '?' + qs : ''));
  }
  async function listCoinTransactions(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/coins/transactions' + (qs ? '?' + qs : ''));
  }
  async function approveCoinRequest(id) {
    return req('POST', `/api/coins/requests/${id}/approve`);
  }
  async function rejectCoinRequest(id, reason) {
    return req('POST', `/api/coins/requests/${id}/reject`, { reason });
  }
  async function completeCoinRequest(id) {
    return req('POST', `/api/coins/requests/${id}/complete`);
  }

  /* ── Period reports ──────────────────────────────────────── */
  async function getPeriodReportStatus() {
    return req('GET', '/api/reports/period-report/status');
  }
  async function uploadPeriodReportFiles(formData) {
    const res = await fetch(base() + '/api/reports/period-report/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData, // FormData — нельзя ставить Content-Type вручную, браузер сам выставит boundary
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
    return data;
  }
  async function savePeriodReport(payload) {
    return req('POST', '/api/reports/period-report/save', payload);
  }

  /* ── Analytics ───────────────────────────────────────────── */
  async function getAvailablePeriods() {
    return req('GET', '/api/analytics/available-periods');
  }

  /* ── Rating ──────────────────────────────────────────────── */
  async function getRatingRace(params) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', '/api/rating/race' + (qs ? '?' + qs : ''));
  }
  async function getMyRatingDynamics(type = 'place', weeks = 8) {
    return req('GET', `/api/rating/me/dynamics?type=${type}&weeks=${weeks}`);
  }

  /* ── Generic path helper for analytics tabs (many distinct query shapes) ── */
  async function analyticsGet(path, params) {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/api/analytics/${path}` + (qs ? '?' + qs : ''));
  }


/* ── Личный кабинет (ТЗ §5) ──────────────────────────────── */
async function getMyCabinet() { return req('GET', '/api/cabinet/me'); }
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

  /* ── Tests (Тесты) — operator side ──────────────────────────── */
  async function myTests() { return req('GET', '/api/tests/my'); }
  async function startTest(testId) { return req('POST', `/api/tests/${testId}/start`); }
  async function saveTestAnswer(attemptId, questionId, selectedAnswerIds) {
    return req('POST', `/api/tests/attempts/${attemptId}/save-answer`, { question_id: questionId, selected_answer_ids: selectedAnswerIds });
  }
  async function finishTest(attemptId) { return req('POST', `/api/tests/attempts/${attemptId}/finish`); }
  async function getTestResult(attemptId) { return req('GET', `/api/tests/attempts/${attemptId}/result`); }

  /* ── Tests (Тесты) — admin/supervisor/manager side ──────────── */
  async function listAdminTests() { return req('GET', '/api/admin/tests'); }
  async function createTest(payload) { return req('POST', '/api/admin/tests', payload); }
  async function updateTest(testId, payload) { return req('PATCH', `/api/admin/tests/${testId}`, payload); }
  async function addTestQuestion(testId, payload) { return req('POST', `/api/admin/tests/${testId}/questions`, payload); }
  async function updateTestQuestion(questionId, payload) { return req('PATCH', `/api/admin/tests/questions/${questionId}`, payload); }
  async function deleteTestQuestion(questionId) { return req('DELETE', `/api/admin/tests/questions/${questionId}`); }
  async function assignTest(testId, payload) { return req('POST', `/api/admin/tests/${testId}/assign`, payload); }
  async function publishTest(testId) { return req('POST', `/api/admin/tests/${testId}/publish`); }
  async function closeTest(testId) { return req('POST', `/api/admin/tests/${testId}/close`); }
  async function getTestResults(testId, params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', `/api/admin/tests/${testId}/results` + (qs ? '?' + qs : ''));
  }
  async function getTestAnalytics(testId) { return req('GET', `/api/admin/tests/${testId}/analytics`); }

  /* ── Operator levels ─────────────────────────────────────── */
  async function listOperatorLevels() { return req('GET', '/api/operator-levels'); }
  async function listAdminOperatorLevels() { return req('GET', '/api/admin/operator-levels'); }
  async function createOperatorLevel(payload) { return req('POST', '/api/admin/operator-levels', payload); }
  async function updateOperatorLevel(levelId, payload) { return req('PATCH', `/api/admin/operator-levels/${levelId}`, payload); }
  async function deleteOperatorLevel(levelId) { return req('DELETE', `/api/admin/operator-levels/${levelId}`); }
  async function addOperatorLevelRule(levelId, payload) { return req('POST', `/api/admin/operator-levels/${levelId}/rules`, payload); }
  async function updateOperatorLevelRule(ruleId, payload) { return req('PATCH', `/api/admin/operator-level-rules/${ruleId}`, payload); }
  async function deleteOperatorLevelRule(ruleId) { return req('DELETE', `/api/admin/operator-level-rules/${ruleId}`); }
  async function myLevel() { return req('GET', '/api/me/level'); }
  async function operatorLevel(operatorId) { return req('GET', `/api/operators/${operatorId}/level`); }
  async function recalculateOperatorLevels(payload) { return req('POST', '/api/admin/operator-levels/recalculate', payload || {}); }
  async function manualOperatorLevel(operatorId, payload) { return req('POST', `/api/admin/operators/${operatorId}/level/manual`, payload); }
  async function listOperatorLevelRewards() { return req('GET', '/api/admin/operator-levels/rewards'); }

  /* ── Wheel of WOW ───────────────────────────────────────── */
  async function getWheelStatus() { return req('GET', '/api/wheel/status'); }
  async function getWheelPrizes() { return req('GET', '/api/wheel/prizes'); }
  async function spinWheel() { return req('POST', '/api/wheel/spin'); }
  async function getWheelMyHistory() { return req('GET', '/api/wheel/my-history'); }
  async function getWheelSpins(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/spins' + (qs ? '?' + qs : ''));
  }
  async function issueWheelTicket(payload) { return req('POST', '/api/admin/wheel/tickets', payload); }
  async function issueWheelTicketsBulk(payload) { return req('POST', '/api/admin/wheel/tickets/bulk', payload); }
  async function getWheelStats(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/stats' + (qs ? '?' + qs : ''));
  }
  async function getWheelRules(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/rules' + (qs ? '?' + qs : ''));
  }
  async function createWheelRule(payload) { return req('POST', '/api/admin/wheel/rules', payload); }
  async function updateWheelRule(id, payload) { return req('PATCH', '/api/admin/wheel/rules/' + id, payload); }
  async function getWheelTokens(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/tokens' + (qs ? '?' + qs : ''));
  }
  async function getWheelEvaluationLogs(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/evaluation-logs' + (qs ? '?' + qs : ''));
  }
  async function grantWheelTokens(payload) { return req('POST', '/api/admin/wheel/tokens/grant', payload); }
  async function getWheelWinnersToday() { return req('GET', '/api/wheel/winners-today'); }
  async function getWheelCampaigns() { return req('GET', '/api/admin/wheel/campaigns'); }
  async function createWheelCampaign(payload) { return req('POST', '/api/admin/wheel/campaigns', payload); }
  async function updateWheelCampaign(id, payload) { return req('PATCH', '/api/admin/wheel/campaigns/' + id, payload); }
  async function getWheelAdminPrizes(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/prizes' + (qs ? '?' + qs : ''));
  }
  async function createWheelPrize(payload) { return req('POST', '/api/admin/wheel/prizes', payload); }
  async function updateWheelPrize(id, payload) { return req('PATCH', '/api/admin/wheel/prizes/' + id, payload); }

  return {
    getToken, login, me, logout,
    listOperators, getOperator, myOperator, createOperator, updateOperator,
    resetOperatorPassword, dismissOperator, restoreOperator, deleteOperator, operatorHistory,
    listWeekly, upsertWeekly,
    getRating,
    myWallet, operatorWallet, manualTransaction,
    listShopItems, createShopItem, updateShopItem,
    listPurchases, buyItem, approvePurchase, rejectPurchase, completePurchase,
    listGroups, createGroup, updateGroup, enableGroup, disableGroup, deleteGroup,
    getDashboard, getDashboardOperators, getDashboardHistory,
    createUser, listUsers, updateUser, deactivateUser, changeUserRole, resetUserPassword,
    listSessions, revokeSession, revokeUserSessions,
    changeMyPassword, changeMyLogin, changeOperatorPassword, changeOperatorUsername,
    getCoinsOverview, listCoinRequests, listCoinTransactions,
    approveCoinRequest, rejectCoinRequest, completeCoinRequest,
    getPeriodReportStatus, uploadPeriodReportFiles, savePeriodReport,
    getAvailablePeriods, analyticsGet,
    getRatingRace, getMyRatingDynamics,
    myTests, startTest, saveTestAnswer, finishTest, getTestResult,
    listAdminTests, createTest, updateTest, addTestQuestion, updateTestQuestion, deleteTestQuestion,
    assignTest, publishTest, closeTest, getTestResults, getTestAnalytics,
    listOperatorLevels, listAdminOperatorLevels, myLevel, operatorLevel,
    createOperatorLevel, updateOperatorLevel, deleteOperatorLevel,
    addOperatorLevelRule, updateOperatorLevelRule, deleteOperatorLevelRule,
    recalculateOperatorLevels, manualOperatorLevel, listOperatorLevelRewards,
    getWheelStatus, getWheelPrizes, spinWheel, getWheelMyHistory, getWheelSpins, issueWheelTicket, issueWheelTicketsBulk,
    getWheelStats, getWheelRules, createWheelRule, updateWheelRule, getWheelTokens, getWheelEvaluationLogs, grantWheelTokens,
    getWheelWinnersToday, getWheelCampaigns, createWheelCampaign, updateWheelCampaign,
    getWheelAdminPrizes, createWheelPrize, updateWheelPrize,
    getMyCabinet, getOperatorCabinet,
    getCoinRulesSettings, updateCoinRulesSettings,
    previewWeeklyAccrual, applyWeeklyAccrual, listAccrualRuns,
    listAchievements, updateAchievement, getMyAchievements, getOperatorAchievements, grantAchievement,
    getAdminSummary, exportUrl,
    listNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
    loginOperator: login,
    _base,
    _req: req,
  };
})();

