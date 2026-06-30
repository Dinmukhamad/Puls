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
  function manualTransaction(p)    { return req('POST', '/api/wallet/transactions', p); }

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

  return {
    getToken, login, me, logout,
    listOperators, getOperator, myOperator, createOperator, updateOperator,
    resetOperatorPassword, dismissOperator, restoreOperator, deleteOperator, operatorHistory,
    listWeekly, upsertWeekly,
    getRating,
    myWallet, operatorWallet, manualTransaction,
    listShopItems, createShopItem, updateShopItem,
    listPurchases, buyItem, approvePurchase, rejectPurchase,
    listGroups, createGroup, updateGroup, enableGroup, disableGroup, deleteGroup,
    getDashboard,
    createUser, listUsers,
    loginOperator: login,
    _base,
  };
})();
