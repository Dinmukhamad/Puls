/**
 * Backend API client for the operator contest app.
 */

'use strict';

const api = (() => {
  let authToken = '';

  function base() {
    return typeof API_BASE !== 'undefined' ? API_BASE : 'http://localhost:3000';
  }

  function setAuthToken(token) {
    authToken = String(token || '');
  }

  function authHeaders(extra = {}) {
    return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  async function login(loginValue, password) {
    const res = await fetch(`${base()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginValue, password }),
    });
    const data = await readJson(res);
    if (res.status === 401) throw new Error('Неверный логин или пароль');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    setAuthToken(data.token);
    return data;
  }

  async function loadSession() {
    if (!authToken) return null;
    const res = await fetch(`${base()}/api/auth/me`, {
      headers: authHeaders(),
    });
    const data = await readJson(res);
    if (res.status === 401) {
      setAuthToken('');
      return null;
    }
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  async function logout() {
    if (!authToken) return { ok: true };
    const res = await fetch(`${base()}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
    });
    setAuthToken('');
    return res.ok ? readJson(res) : { ok: false };
  }

  async function loadState() {
    const res = await fetch(`${base()}/api/state`, { cache: 'no-store' });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data.state;
  }

  async function saveState(state) {
    const res = await fetch(`${base()}/api/state`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(state),
    });
    const data = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Требуется вход администратора');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  async function verifyPassword() {
    if (!authToken) return false;
    try {
      const res = await fetch(`${base()}/api/admin/verify`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function createRewardRequest(payload) {
    const res = await fetch(`${base()}/api/gamification/request`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Требуется вход в систему');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  async function addManualCoins(payload) {
    const res = await fetch(`${base()}/api/gamification/manual`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Требуется вход администратора');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  async function updateRewardRequest(id, payload) {
    const res = await fetch(`${base()}/api/gamification/request/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Требуется вход администратора');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  async function resetState() {
    const res = await fetch(`${base()}/api/admin/reset-state`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
    const data = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Требуется вход администратора');
    if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);
    return data;
  }

  return {
    setAuthToken,
    login,
    loginOperator: login,
    loadSession,
    logout,
    loadState,
    saveState,
    verifyPassword,
    createRewardRequest,
    addManualCoins,
    updateRewardRequest,
    resetState,
  };
})();
