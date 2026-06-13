'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hogwarts2026';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Password'],
}));
app.use(express.json({ limit: '5mb' }));

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read state:', error);
    return null;
  }
}

function writeState(state) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, dataFile: DATA_FILE, time: new Date().toISOString() });
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', (req, res) => {
  res.json({ state: readState() });
});

app.post('/api/state', requireAdmin, (req, res) => {
  const { faculties, weeklyData, metrics } = req.body || {};

  if (!Array.isArray(faculties) || !Array.isArray(weeklyData) || !Array.isArray(metrics)) {
    return res.status(400).json({ error: 'Invalid state shape' });
  }

  writeState({ faculties, weeklyData, metrics });
  res.json({ ok: true });
});

/* JS и CSS — без кэша (версионируются через ?v=… в index.html).
   Картинки — кэш на час: они меняются редко. */
const codeNoCache = { maxAge: 0, etag: true, index: false, dotfiles: 'deny' };
const assetCache  = { maxAge: '1h', index: false, dotfiles: 'deny' };
app.use('/assets', express.static(path.join(__dirname, 'assets'), assetCache));
app.use('/css', express.static(path.join(__dirname, 'css'), codeNoCache));
app.use('/js', express.static(path.join(__dirname, 'js'), codeNoCache));

/* Сам index.html тоже не кэшируем — он определяет, какие версии скриптов
   браузер загрузит, поэтому всегда должен быть свежим. */
function sendIndex(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
}

app.get('/', sendIndex);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  sendIndex(req, res);
});

app.listen(PORT, () => {
  console.log(`Дивергент: Конкурс Операторов запущен on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});