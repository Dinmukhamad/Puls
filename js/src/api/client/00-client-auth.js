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
      const msg = data.detail || data.error || `Ошибка ${res.status}`;
      const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      error.status = res.status;
      error.path = path;
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
