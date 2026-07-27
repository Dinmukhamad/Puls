
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
    const csrf = document.cookie
      .split('; ')
      .find((item) => item.startsWith('pulse_csrf_token='))
      ?.split('=')[1];
    const res = await fetch(base() + '/api/reports/period-report/upload', {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
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

