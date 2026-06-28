/**
 * iCore — API client
 * Совместим с Node.js server.js (текущий прод) и FastAPI (будущий).
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
  // server.js принимает { login, password } и возвращает { token, user: { role, name, ... } }
  async function login(username, password) {
    if (!username || !password) throw new Error('Введите логин и пароль');
    const res = await fetch(base() + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: username, password }),
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || data.detail || `Ошибка ${res.status}`);
    // Node.js → { token, user }   FastAPI → { access_token }
    const token = data.token || data.access_token || '';
    setToken(token);
    return data;
  }

  // Получить текущего пользователя
  // Node.js → { ok, user: { id, login, name, role, operatorName }, operator }
  // FastAPI → { id, username, full_name, role, operator_id }
  async function me() {
    const data = await req('GET', '/api/auth/me');
    const u = data.user || data;
    return {
      id:           u.id,
      username:     u.login        || u.username    || '',
      full_name:    u.name         || u.full_name   || u.login || '',
      role:         u.role         || 'operator',
      operator_id:  u.operator_id  || null,
      operatorName: u.operatorName || u.name        || '',
      _operator:    data.operator  || null,
    };
  }

  function logout() { setToken(''); }

  /* ── Operators ───────────────────────────────────────────── */
  function listOperators()          { return req('GET', '/api/operators'); }
  function getOperator(id)          { return req('GET', `/api/operators/${id}`); }
  function myOperator()             { return req('GET', '/api/operators/me'); }
  function createOperator(payload)  { return req('POST', '/api/operators', payload); }
  function updateOperator(id, p)    { return req('PATCH', `/api/operators/${id}`, p); }

  /* ── Weekly results ──────────────────────────────────────── */
  function listWeekly()             { return req('GET', '/api/weekly-results'); }
  function upsertWeekly(payload)    { return req('POST', '/api/weekly-results', payload); }

  /* ── Rating ──────────────────────────────────────────────── */
  function getRating(ws, we) {
    let url = '/api/rating';
    if (ws && we) url += `?week_start=${ws}&week_end=${we}`;
    return req('GET', url);
  }

  /* ── Wallet ──────────────────────────────────────────────── */
  function myWallet()               { return req('GET', '/api/wallet/me'); }
  function operatorWallet(id)       { return req('GET', `/api/wallet/${id}`); }
  function manualTransaction(p)     { return req('POST', '/api/wallet/transactions', p); }

  /* ── Shop ────────────────────────────────────────────────── */
  function listShopItems()          { return req('GET', '/api/shop/items'); }
  function createShopItem(p)        { return req('POST', '/api/shop/items', p); }
  function updateShopItem(id, p)    { return req('PATCH', `/api/shop/items/${id}`, p); }
  function listPurchases()          { return req('GET', '/api/shop/purchases'); }
  function buyItem(itemId)          { return req('POST', '/api/shop/purchases', { shop_item_id: itemId }); }
  function approvePurchase(id)      { return req('POST', `/api/shop/purchases/${id}/approve`); }
  function rejectPurchase(id, reason) { return req('POST', `/api/shop/purchases/${id}/reject`, { reason }); }

  /* ── Dashboard ───────────────────────────────────────────── */
  function getDashboard()           { return req('GET', '/api/dashboard'); }

  /* ── Users (admin) ───────────────────────────────────────── */
  function createUser(p)            { return req('POST', '/api/auth/users', p); }
  function listUsers()              { return req('GET', '/api/auth/users'); }

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
    registerOperator: (p) => login(p.login || p.username, p.password),
    loadSession: me,
  };
})();
