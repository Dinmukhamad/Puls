/**
 * iCore — FastAPI client
 * Все методы возвращают Promise. При ошибке бросают Error с текстом от сервера.
 */
'use strict';

const api = (() => {
  let _token = localStorage.getItem('icore_token') || '';

  function base() {
    return typeof API_BASE !== 'undefined' ? API_BASE : '';
  }

  function setToken(t) {
    _token = t || '';
    if (_token) localStorage.setItem('icore_token', _token);
    else localStorage.removeItem('icore_token');
  }

  function getToken() { return _token; }

  function headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  async function req(method, path, body) {
    const opts = { method, headers: headers() };
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

  /* ── Auth ─────────────────────────────────────────────── */
  async function login(username, password) {
    const data = await req('POST', '/api/auth/login', { username, password });
    setToken(data.access_token);
    return data;
  }

  async function me() {
    return req('GET', '/api/auth/me');
  }

  function logout() {
    setToken('');
  }

  /* ── Operators ────────────────────────────────────────── */
  function listOperators() { return req('GET', '/api/operators'); }
  function getOperator(id) { return req('GET', `/api/operators/${id}`); }
  function myOperator()    { return req('GET', '/api/operators/me'); }
  function createOperator(payload) { return req('POST', '/api/operators', payload); }
  function updateOperator(id, payload) { return req('PATCH', `/api/operators/${id}`, payload); }

  /* ── Weekly results ───────────────────────────────────── */
  function listWeekly()    { return req('GET', '/api/weekly-results'); }
  function upsertWeekly(payload) { return req('POST', '/api/weekly-results', payload); }

  /* ── Rating ───────────────────────────────────────────── */
  function getRating(weekStart, weekEnd) {
    let url = '/api/rating';
    if (weekStart && weekEnd) url += `?week_start=${weekStart}&week_end=${weekEnd}`;
    return req('GET', url);
  }

  /* ── Wallet ───────────────────────────────────────────── */
  function myWallet()           { return req('GET', '/api/wallet/me'); }
  function operatorWallet(id)   { return req('GET', `/api/wallet/${id}`); }
  function manualTransaction(payload) { return req('POST', '/api/wallet/transactions', payload); }

  /* ── Shop ─────────────────────────────────────────────── */
  function listShopItems()      { return req('GET', '/api/shop/items'); }
  function createShopItem(payload) { return req('POST', '/api/shop/items', payload); }
  function updateShopItem(id, payload) { return req('PATCH', `/api/shop/items/${id}`, payload); }
  function listPurchases()      { return req('GET', '/api/shop/purchases'); }
  function buyItem(itemId)      { return req('POST', '/api/shop/purchases', { shop_item_id: itemId }); }
  function approvePurchase(id)  { return req('POST', `/api/shop/purchases/${id}/approve`); }
  function rejectPurchase(id, reason) { return req('POST', `/api/shop/purchases/${id}/reject`, { reason }); }

  /* ── Dashboard ────────────────────────────────────────── */
  function getDashboard()       { return req('GET', '/api/dashboard'); }

  /* ── Auth helpers ─────────────────────────────────────── */
  function createUser(payload)  { return req('POST', '/api/auth/users', payload); }
  function listUsers()          { return req('GET', '/api/auth/users'); }

  return {
    setToken, getToken, login, me, logout,
    listOperators, getOperator, myOperator, createOperator, updateOperator,
    listWeekly, upsertWeekly,
    getRating,
    myWallet, operatorWallet, manualTransaction,
    listShopItems, createShopItem, updateShopItem,
    listPurchases, buyItem, approvePurchase, rejectPurchase,
    getDashboard,
    createUser, listUsers,
    // legacy compat
    loginOperator: login,
    registerOperator: async (p) => login(p.login || p.username, p.password),
    loadSession: me,
  };
})();
