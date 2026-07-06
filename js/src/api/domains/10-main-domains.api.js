
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
