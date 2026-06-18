/**
 * server.js — Бэкенд для Конкурса Факультетов
 *
 * Запуск:
 *   cd backend
 *   npm install
 *   node server.js
 *
 * Сервер запустится на http://localhost:3000
 * Данные хранятся в backend/data.json (создаётся автоматически)
 *
 * Для продакшна (Railway, Render, VPS):
 *   - Задайте переменную PORT (по умолчанию 3000)
 *   - Задайте ADMIN_PASSWORD (по умолчанию hogwarts2026)
 *   - Задайте CORS_ORIGIN — URL вашего сайта
 */

'use strict';

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const PORT           = process.env.PORT           || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hogwarts2026';
const CORS_ORIGIN    = process.env.CORS_ORIGIN    || '*';
const DATA_FILE      = process.env.DATA_FILE      || path.join(__dirname, 'data.json');

/* ── Хранилище данных (JSON-файл) ───────────────────────── */
function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/* ── Express ─────────────────────────────────────────────── */
const app = express();

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Password'],
}));
app.use(express.json({ limit: '2mb' }));

/* ── Middleware: проверка пароля администратора ─────────── */
function requireAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (pw !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Неверный пароль администратора' });
  }
  next();
}

/* ── GET /api/state ────────────────────────────────────────
   Возвращает текущее состояние (faculties, weeklyData, metrics).
   Если данных ещё нет — возвращает null (фронт использует MOCK_DATA). */
app.get('/api/state', (req, res) => {
  const state = readState();
  res.json({ state });
});

/* ── POST /api/state ───────────────────────────────────────
   Сохраняет состояние. Требует заголовок X-Admin-Password. */
app.post('/api/state', requireAdmin, (req, res) => {
  const { faculties, weeklyData, metrics, dailyImport = null } = req.body;

  if (!Array.isArray(faculties) || !Array.isArray(weeklyData) || !Array.isArray(metrics)) {
    return res.status(400).json({ error: 'Неверная структура данных' });
  }

  writeState({ faculties, weeklyData, metrics, dailyImport });
  res.json({ ok: true });
});

/* ── Health check ───────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', file: DATA_FILE, time: new Date().toISOString() });
});

/* ── Ошибки ─────────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🏰 Трекер Факультетов запущен → http://localhost:${PORT}`);
  console.log(`   Данные: ${DATA_FILE}`);
  console.log(`   CORS: ${CORS_ORIGIN}\n`);
});
