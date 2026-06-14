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
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_LIMIT = Number(process.env.STATE_BACKUP_LIMIT || 25);

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Password'],
}));
app.use(express.json({ limit: '5mb' }));

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(String(value || ''));
}

function existingDir(dir) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function resolveDataFile() {
  const explicitFile = process.env.DATA_FILE;
  const persistentDir =
    process.env.PERSISTENT_DATA_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    process.env.RAILWAY_VOLUME_PATH;
  const preferredFallbackFile = process.platform === 'win32'
    ? path.join(__dirname, 'runtime-data', 'data.json')
    : path.join('/data', 'data.json');

  if (explicitFile && path.isAbsolute(explicitFile)) {
    return {
      dataFile: explicitFile,
      source: 'DATA_FILE',
      persistent: true,
      warning: null,
    };
  }

  if (persistentDir) {
    return {
      dataFile: path.join(persistentDir, 'data.json'),
      source: 'persistent directory env',
      persistent: true,
      warning: null,
    };
  }

  if (existingDir('/data')) {
    return {
      dataFile: path.join('/data', 'data.json'),
      source: '/data volume path',
      persistent: true,
      warning: null,
    };
  }

  if (explicitFile) {
    return {
      dataFile: preferredFallbackFile,
      source: 'relative DATA_FILE ignored',
      persistent: false,
      warning: 'DATA_FILE is relative and unsafe for Railway redeploys. Mount a Railway Volume at /data and set DATA_FILE=/data/data.json.',
    };
  }

  return {
    dataFile: preferredFallbackFile,
    source: 'preferred /data fallback',
    persistent: false,
    warning: 'No persistent storage configured. Mount a Railway Volume at /data or set DATA_FILE=/data/data.json.',
  };
}

const storage = resolveDataFile();
storage.backupDir = path.join(path.dirname(storage.dataFile), 'backups');

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null, raw: null, error: null };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { exists: true, value: JSON.parse(raw), raw, error: null };
  } catch (error) {
    return { exists: true, value: null, raw: null, error };
  }
}

function normalizeMetric(metric) {
  return {
    label: String(metric?.label || '').trim() || 'Metric',
    type: ['metric', 'penalty', 'score'].includes(metric?.type) ? metric.type : 'metric',
  };
}

function normalizeRow(row, metricCount) {
  const source = Array.isArray(row) ? row : [];
  const normalized = [];
  for (let i = 0; i < metricCount; i += 1) {
    const value = Number(source[i]);
    normalized.push(Number.isFinite(value) ? value : 0);
  }
  return normalized;
}

function normalizeState(input) {
  if (!input || !Array.isArray(input.faculties) || !Array.isArray(input.weeklyData) || !Array.isArray(input.metrics)) {
    throw new Error('Invalid state shape');
  }

  const metrics = input.metrics.map(normalizeMetric);
  if (!metrics.some(metric => metric.type === 'score')) {
    metrics.push({ label: 'Итого', type: 'score' });
  }

  const metricCount = metrics.length;
  const sourceSlot = Array.isArray(input.weeklyData[0]) ? input.weeklyData[0] : [];
  const faculties = input.faculties.map(faculty => ({
    ...faculty,
    operators: Array.isArray(faculty.operators)
      ? faculty.operators.map(name => String(name).trim()).filter(Boolean)
      : [],
  }));

  const weeklyRows = faculties.map((faculty, facultyIndex) => {
    const sourceRows = Array.isArray(sourceSlot[facultyIndex]) ? sourceSlot[facultyIndex] : [];
    return faculty.operators.map((_, operatorIndex) => normalizeRow(sourceRows[operatorIndex], metricCount));
  });

  return {
    faculties,
    weeklyData: [weeklyRows],
    metrics,
  };
}

function ensureStorageInitialized() {
  const dataDir = path.dirname(storage.dataFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storage.backupDir)) fs.mkdirSync(storage.backupDir, { recursive: true });

  const current = readJsonFile(storage.dataFile);
  if (current.exists && !current.error) return;

  if (current.error) {
    const corruptPath = `${storage.dataFile}.corrupt-${Date.now()}`;
    fs.renameSync(storage.dataFile, corruptPath);
    console.error(`State file was corrupt and moved to ${corruptPath}:`, current.error);
  }

  const seed = readJsonFile(LEGACY_DATA_FILE);
  if (seed.exists && !seed.error && seed.value) {
    writeState(seed.value, { skipBackup: true });
    return;
  }

  writeState({ faculties: [], weeklyData: [[]], metrics: [] }, { skipBackup: true });
}

function cleanupBackups() {
  if (!Number.isFinite(BACKUP_LIMIT) || BACKUP_LIMIT <= 0) return;
  const backups = fs.readdirSync(storage.backupDir)
    .filter(name => /^state-\d+\.json$/.test(name))
    .map(name => ({ name, fullPath: path.join(storage.backupDir, name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  while (backups.length > BACKUP_LIMIT) {
    const old = backups.shift();
    try {
      fs.unlinkSync(old.fullPath);
    } catch (error) {
      console.error('Failed to remove old backup:', error);
    }
  }
}

function backupCurrentState() {
  if (!fs.existsSync(storage.dataFile)) return;
  const backupPath = path.join(storage.backupDir, `state-${Date.now()}.json`);
  fs.copyFileSync(storage.dataFile, backupPath);
  cleanupBackups();
}

function readState() {
  ensureStorageInitialized();
  const result = readJsonFile(storage.dataFile);
  if (result.error) throw result.error;
  return result.value;
}

function writeState(state, options = {}) {
  const normalized = normalizeState(state);
  const dataDir = path.dirname(storage.dataFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storage.backupDir)) fs.mkdirSync(storage.backupDir, { recursive: true });
  if (!options.skipBackup) backupCurrentState();

  const tmpFile = `${storage.dataFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmpFile, storage.dataFile);
}

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  next();
}

app.get('/api/health', (req, res) => {
  const stateExists = fs.existsSync(storage.dataFile);
  res.json({
    ok: true,
    dataFile: storage.dataFile,
    time: new Date().toISOString(),
    storage: {
      source: storage.source,
      persistent: storage.persistent,
      warning: storage.warning,
      backupDir: storage.backupDir,
      stateExists,
      legacyDataFile: LEGACY_DATA_FILE,
    },
  });
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ state: readState() });
  } catch (error) {
    console.error('Failed to read state:', error);
    res.status(500).json({ error: 'Failed to read state' });
  }
});

app.post('/api/state', requireAdmin, (req, res) => {
  try {
    writeState(req.body || {});
    res.json({ ok: true, storage: { persistent: storage.persistent, warning: storage.warning } });
  } catch (error) {
    console.error('Failed to write state:', error);
    res.status(400).json({ error: error.message || 'Failed to write state' });
  }
});

const codeNoCache = { maxAge: 0, etag: true, index: false, dotfiles: 'deny' };
const assetCache = { maxAge: '1h', index: false, dotfiles: 'deny' };
app.use('/assets', express.static(path.join(__dirname, 'assets'), assetCache));
app.use('/css', express.static(path.join(__dirname, 'css'), codeNoCache));
app.use('/js', express.static(path.join(__dirname, 'js'), codeNoCache));

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

ensureStorageInitialized();

app.listen(PORT, () => {
  console.log(`Divergent contest started on port ${PORT}`);
  console.log(`Data file: ${storage.dataFile}`);
  if (storage.warning) console.warn(storage.warning);
});
