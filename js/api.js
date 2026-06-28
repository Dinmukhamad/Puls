/**
 * Puls — FastAPI client
 * FastAPI: POST /api/auth/login { username, password } → { access_token }
 *          GET  /api/auth/me → { id, username, full_name, role, operator_id }
 */
'use strict';

const api = (() => {
  let _token = localStorage.getItem('puls_token') || '';

  function base() {
    return typeof API_BASE !== 'undefined' ? API_BASE : '';
  }

  function setToken(t) {
    _token = t || '';
    if (_token) localStorage.setItem('puls_token', _token);
    else localStorage.removeItem('puls_token');
  }

  function getToken() { return _token; }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  async function req(method, path, body) {
    const opts = { method, headers: authHeaders() };
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
    // FastAPI ожидает { username, password }
    const data = await req('POST', '/api/auth/login', { username, password });
    // FastAPI возвращает { access_token, token_type }
    setToken(data.access_token);
    return data;
  }

  async function me() {
    // FastAPI возвращает { id, username, full_name, role, operator_id, is_active }
    return req('GET', '/api/auth/me');
  }

  function logout() { setToken(''); }

  /* ── Operators ───────────────────────────────────────────── */
  function listOperators()         { return req('GET', '/api/operators'); }
  function getOperator(id)         { return req('GET', `/api/operators/${id}`); }
  function myOperator()            { return req('GET', '/api/operators/me'); }
  function createOperator(p)       { return req('POST', '/api/operators', p); }
  function updateOperator(id, p)   { return req('PATCH', `/api/operators/${id}`, p); }

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
  function manualTransaction(p)    { return req('POST', '/api/wallet/transactions', p); }

  /* ── Shop ────────────────────────────────────────────────── */
  function listShopItems()         { return req('GET', '/api/shop/items'); }
  function createShopItem(p)       { return req('POST', '/api/shop/items', p); }
  function updateShopItem(id, p)   { return req('PATCH', `/api/shop/items/${id}`, p); }
  function listPurchases()         { return req('GET', '/api/shop/purchases'); }
  function buyItem(itemId)         { return req('POST', '/api/shop/purchases', { shop_item_id: itemId }); }
  function approvePurchase(id)     { return req('POST', `/api/shop/purchases/${id}/approve`); }
  function rejectPurchase(id, r)   { return req('POST', `/api/shop/purchases/${id}/reject`, { reason: r }); }

  /* ── Dashboard ───────────────────────────────────────────── */
  function getDashboard()          { return req('GET', '/api/dashboard'); }

  /* ── Users (admin) ───────────────────────────────────────── */
  function createUser(p)           { return req('POST', '/api/auth/users', p); }
  function listUsers()             { return req('GET', '/api/auth/users'); }

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
    loginOperator: login,
  };
})();
