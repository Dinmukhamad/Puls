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

  async function req(method, path, body) {
    const opts = {
      method,
      headers: headers(),
      credentials: 'include',  // Send HttpOnly cookie
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(base() + path, opts);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = data.detail || data.error || `Ошибка ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
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
  function listOperators()         { return req('GET', '/api/operators'); }
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
  function listWeekly()            { return req('GET', '/api/weekly-results'); }
  function upsertWeekly(p)         { return req('POST', '/api/weekly-results', p); }

  /* ── Rating ──────────────────────────────────────────────── */
  function getRating(ws, we) {
    let url = '/api/rating';
    if (ws && we) url += `?week_start=${ws}&week_end=${we}`;
    return req('GET', url);
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
  function listPurchases()         { return req('GET', '/api/shop/purchases'); }
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
  function createUser(p)           { return req('POST', '/api/auth/users', p); }
  function listUsers()             { return req('GET', '/api/auth/users'); }

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
    createUser, listUsers,
    changeMyPassword, changeMyLogin, changeOperatorPassword, changeOperatorUsername,
    getCoinsOverview, listCoinRequests, listCoinTransactions,
    approveCoinRequest, rejectCoinRequest, completeCoinRequest,
    getPeriodReportStatus, uploadPeriodReportFiles, savePeriodReport,
    getAvailablePeriods, analyticsGet,
    getRatingRace, getMyRatingDynamics,
    myTests, startTest, saveTestAnswer, finishTest, getTestResult,
    listAdminTests, createTest, updateTest, addTestQuestion, updateTestQuestion, deleteTestQuestion,
    assignTest, publishTest, closeTest, getTestResults, getTestAnalytics,
    loginOperator: login,
    _base,
  };
})();
