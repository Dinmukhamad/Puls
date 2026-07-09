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
