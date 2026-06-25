/**
 * js/api.js — Клиент для бэкенда Дивергент: Конкурс Операторов
 *
 * Подключите в index.html ДО app.js:
 *   <script src="js/api.js"></script>
 *
 * Затем в app.js установите:
 *   const USE_MOCK = false;
 *   const API_BASE = 'http://localhost:3000'; // или URL вашего сервера
 */

'use strict';

const api = (() => {

  /* Берёт базовый URL из app.js (константа API_BASE) */
  function base() {
    return typeof API_BASE !== 'undefined' ? API_BASE : 'http://localhost:3000';
  }

  /**
   * Загружает состояние с сервера.
   * Возвращает { faculties, weeklyData, metrics } или null если данных нет.
   */
  async function loadState() {
    const res = await fetch(`${base()}/api/state`);
    if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
    const { state } = await res.json();
    return state; // null если данных ещё нет — нормально
  }

  /**
   * Сохраняет состояние на сервере.
   * @param {{ faculties, weeklyData, metrics }} state
   * @param {string} adminPassword
   */
  async function saveState(state, adminPassword) {
    const res = await fetch(`${base()}/api/state`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Admin-Password': adminPassword,
      },
      body: JSON.stringify(state),
    });

    if (res.status === 403) throw new Error('Неверный пароль администратора');
    if (!res.ok)            throw new Error(`Сервер вернул ${res.status}`);

    return res.json();
  }

  /**
   * Проверяет правильность пароля администратора на сервере.
   * Возвращает true если пароль верный, false если нет.
   */
  async function verifyPassword(adminPassword) {
    try {
      const res = await fetch(`${base()}/api/admin/verify`, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'X-Admin-Password': adminPassword,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function createRewardRequest(payload) {
    const res = await fetch(`${base()}/api/gamification/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
    return res.json();
  }

  async function addManualCoins(payload, adminPassword) {
    const res = await fetch(`${base()}/api/gamification/manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 403) throw new Error('Неверный пароль администратора');
    if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
    return res.json();
  }

  async function updateRewardRequest(id, payload, adminPassword) {
    const res = await fetch(`${base()}/api/gamification/request/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 403) throw new Error('Неверный пароль администратора');
    if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
    return res.json();
  }

  return { loadState, saveState, verifyPassword, createRewardRequest, addManualCoins, updateRewardRequest };

})();
