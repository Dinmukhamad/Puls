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
const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_STATE_KEY = process.env.DB_STATE_KEY || 'main';

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Password'],
}));
app.use(express.json({ limit: '5mb' }));

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

const database = {
  enabled: !!DATABASE_URL,
  pool: null,
  warning: null,
};

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null, raw: null, error: null };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { exists: true, value: JSON.parse(raw), raw, error: null };
  } catch (error) {
    return { exists: true, value: null, raw: null, error };
  }
}

function normalizeOperatorName(name) {
  return String(name || '').trim().toLowerCase().replace(/С‘/g, 'Рµ').replace(/\s+/g, ' ');
}

function getOperatorDirectory(state) {
  const rows = [];
  const faculties = Array.isArray(state?.faculties) ? state.faculties : [];

  faculties.forEach((faculty, facIdx) => {
    const operators = Array.isArray(faculty?.operators) ? faculty.operators : [];
    operators.forEach((name, opIdx) => {
      const operatorName = String(name || '').trim();
      const nameKey = normalizeOperatorName(operatorName);
      if (!nameKey) return;
      rows.push({
        key: `${facIdx}:${opIdx}`,
        name: operatorName,
        nameKey,
        facultyId: String(faculty?.id || ''),
        facultyName: String(faculty?.name || `Group ${facIdx + 1}`),
      });
    });
  });

  return rows;
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

function normalizeDailyImport(input) {
  if (!input || typeof input !== 'object' || !input.operators || typeof input.operators !== 'object') {
    return null;
  }

  const operators = {};
  Object.entries(input.operators).forEach(([key, value]) => {
    if (!value || typeof value !== 'object' || !Array.isArray(value.dates)) return;
    const safeKey = String(key || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    if (!safeKey) return;
    operators[safeKey] = {
      operator: String(value.operator || '').trim(),
      dates: value.dates.map(day => ({
        key: String(day?.key || '').trim(),
        label: String(day?.label || '').trim(),
        baseWorked: Number.isFinite(Number(day?.baseWorked)) ? Number(day.baseWorked) : 0,
        extraHours: Number.isFinite(Number(day?.extraHours)) ? Number(day.extraHours) : 0,
        actualFact: Number.isFinite(Number(day?.actualFact)) ? Number(day.actualFact) : 0,
        effectiveHours: Number.isFinite(Number(day?.effectiveHours)) ? Number(day.effectiveHours) : 0,
      })).filter(day => day.key),
    };
  });

  return {
    period: String(input.period || '').trim(),
    dateKeys: Array.isArray(input.dateKeys) ? input.dateKeys.map(value => String(value).trim()).filter(Boolean) : [],
    generatedAt: String(input.generatedAt || '').trim(),
    operators,
  };
}

function normalizeGamification(input) {
  const source = input && typeof input === 'object' ? input : {};
  const settingsSource = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const coinRate = Number(settingsSource.coinRate);

  const manualLedger = Array.isArray(source.manualLedger)
    ? source.manualLedger.map(item => ({
        id: String(item?.id || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        operatorKey: String(item?.operatorKey || '').trim().toLowerCase().replace(/ё/g, 'е'),
        operatorName: String(item?.operatorName || '').trim(),
        amount: Number.isFinite(Number(item?.amount)) ? Math.trunc(Number(item.amount)) : 0,
        comment: String(item?.comment || '').trim(),
        author: String(item?.author || '').trim() || 'Администратор',
        createdAt: String(item?.createdAt || '').trim() || new Date().toISOString(),
      })).filter(item => item.operatorKey && item.amount !== 0 && item.comment)
    : [];

  const requests = Array.isArray(source.requests)
    ? source.requests.map(item => ({
        id: String(item?.id || `request-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        operatorKey: String(item?.operatorKey || '').trim().toLowerCase().replace(/ё/g, 'е'),
        operatorName: String(item?.operatorName || '').trim(),
        rewardId: String(item?.rewardId || '').trim(),
        rewardTitle: String(item?.rewardTitle || '').trim(),
        price: Number.isFinite(Number(item?.price)) ? Math.max(0, Math.trunc(Number(item.price))) : 0,
        status: ['new', 'approved', 'rejected', 'done'].includes(item?.status) ? item.status : 'new',
        reason: String(item?.reason || '').trim(),
        createdAt: String(item?.createdAt || '').trim() || new Date().toISOString(),
        updatedAt: String(item?.updatedAt || '').trim() || String(item?.createdAt || '').trim() || new Date().toISOString(),
      })).filter(item => item.operatorKey && item.rewardId && item.rewardTitle && item.price > 0)
    : [];

  return {
    settings: {
      coinRate: Number.isFinite(coinRate) && coinRate > 0 ? coinRate : 5,
    },
    manualLedger,
    requests,
  };
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
    dailyImport: normalizeDailyImport(input.dailyImport),
    gamification: normalizeGamification(input.gamification),
  };
}

function getEmptyState() {
  return { faculties: [], weeklyData: [[]], metrics: [] };
}

function getSeedState() {
  const current = readJsonFile(storage.dataFile);
  if (current.exists && !current.error && current.value) return current.value;

  const seed = readJsonFile(LEGACY_DATA_FILE);
  if (seed.exists && !seed.error && seed.value) return seed.value;

  return getEmptyState();
}

function ensureFileStorageInitialized() {
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
    writeFileState(seed.value, { skipBackup: true });
    return;
  }

  writeFileState(getEmptyState(), { skipBackup: true });
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

function readFileState() {
  ensureFileStorageInitialized();
  const result = readJsonFile(storage.dataFile);
  if (result.error) throw result.error;
  return result.value;
}

function writeFileState(state, options = {}) {
  const normalized = normalizeState(state);
  const dataDir = path.dirname(storage.dataFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storage.backupDir)) fs.mkdirSync(storage.backupDir, { recursive: true });
  if (!options.skipBackup) backupCurrentState();

  const tmpFile = `${storage.dataFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmpFile, storage.dataFile);
}

function getDatabaseSslConfig() {
  if (!DATABASE_URL) return undefined;
  if (/localhost|127\.0\.0\.1/i.test(DATABASE_URL) || process.env.PGSSL === 'disable') return false;
  return { rejectUnauthorized: false };
}

async function ensureDatabaseInitialized() {
  if (!database.enabled) return;
  if (!database.pool) {
    const { Pool } = require('pg');
    database.pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: getDatabaseSslConfig(),
    });
  }

  await database.pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await database.pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_backups (
      backup_id bigserial PRIMARY KEY,
      state_id text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const existing = await database.pool.query('SELECT 1 FROM app_state WHERE id = $1 LIMIT 1', [DB_STATE_KEY]);
  if (existing.rowCount === 0) {
    const normalized = normalizeState(getSeedState());
    await database.pool.query(
      'INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, now())',
      [DB_STATE_KEY, JSON.stringify(normalized)]
    );
    console.log(`Seeded PostgreSQL app_state "${DB_STATE_KEY}" from JSON storage.`);
  }
}

async function cleanupDatabaseBackups(client = database.pool) {
  if (!Number.isFinite(BACKUP_LIMIT) || BACKUP_LIMIT <= 0) return;
  await client.query(`
    DELETE FROM app_state_backups
    WHERE backup_id IN (
      SELECT backup_id
      FROM app_state_backups
      WHERE state_id = $1
      ORDER BY created_at DESC, backup_id DESC
      OFFSET $2
    )
  `, [DB_STATE_KEY, BACKUP_LIMIT]);
}

async function readDatabaseState() {
  await ensureDatabaseInitialized();
  const result = await database.pool.query('SELECT data FROM app_state WHERE id = $1', [DB_STATE_KEY]);
  if (result.rowCount === 0) return normalizeState(getEmptyState());
  return result.rows[0].data;
}

async function writeDatabaseState(state, options = {}) {
  await ensureDatabaseInitialized();
  const normalized = normalizeState(state);
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    if (!options.skipBackup) {
      await client.query(`
        INSERT INTO app_state_backups (state_id, data)
        SELECT id, data FROM app_state WHERE id = $1
      `, [DB_STATE_KEY]);
    }
    await client.query(`
      INSERT INTO app_state (id, data, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `, [DB_STATE_KEY, JSON.stringify(normalized)]);
    await cleanupDatabaseBackups(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureStorageInitialized() {
  if (database.enabled) {
    await ensureDatabaseInitialized();
    return;
  }
  ensureFileStorageInitialized();
}

async function readState() {
  if (database.enabled) return readDatabaseState();
  return readFileState();
}

async function writeState(state, options = {}) {
  if (database.enabled) return writeDatabaseState(state, options);
  return writeFileState(state, options);
}

async function databaseStateExists() {
  if (!database.enabled) return false;
  await ensureDatabaseInitialized();
  const result = await database.pool.query('SELECT 1 FROM app_state WHERE id = $1 LIMIT 1', [DB_STATE_KEY]);
  return result.rowCount > 0;
}

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  next();
}

app.get('/api/health', async (req, res) => {
  try {
    const stateExists = database.enabled ? await databaseStateExists() : fs.existsSync(storage.dataFile);
    res.json({
      ok: true,
      dataFile: database.enabled ? `postgres:app_state/${DB_STATE_KEY}` : storage.dataFile,
      time: new Date().toISOString(),
      storage: {
        mode: database.enabled ? 'postgres' : 'file',
        source: storage.source,
        persistent: database.enabled ? true : storage.persistent,
        warning: database.enabled ? database.warning : storage.warning,
        backupDir: database.enabled ? 'postgres:app_state_backups' : storage.backupDir,
        stateExists,
        legacyDataFile: LEGACY_DATA_FILE,
        database: database.enabled ? {
          table: 'app_state',
          backupTable: 'app_state_backups',
          stateKey: DB_STATE_KEY,
        } : null,
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Health check failed',
      storage: {
        mode: database.enabled ? 'postgres' : 'file',
        dataFile: storage.dataFile,
      },
    });
  }
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.post('/api/operator/login', async (req, res) => {
  try {
    const login = String(req.body?.login || req.body?.name || '').trim();
    const loginKey = normalizeOperatorName(login);
    if (!loginKey) return res.status(400).json({ error: 'Login is required' });

    const operators = getOperatorDirectory(await readState());
    const operator = operators.find(item => item.nameKey === loginKey);
    if (!operator) return res.status(404).json({ error: 'Operator not found' });

    res.json({ ok: true, operator });
  } catch (error) {
    console.error('Failed to login operator:', error);
    res.status(500).json({ error: error.message || 'Failed to login operator' });
  }
});

app.post('/api/gamification/request', async (req, res) => {
  try {
    const state = await readState();
    const gamification = normalizeGamification(state.gamification);
    const body = req.body || {};
    const request = normalizeGamification({
      requests: [{
        ...body,
        id: `request-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    }).requests[0];
    if (!request) return res.status(400).json({ error: 'Invalid request' });
    gamification.requests.unshift(request);
    await writeState({ ...state, gamification });
    res.json({ ok: true, request, gamification });
  } catch (error) {
    console.error('Failed to create gamification request:', error);
    res.status(400).json({ error: error.message || 'Failed to create request' });
  }
});

app.post('/api/gamification/manual', requireAdmin, async (req, res) => {
  try {
    const state = await readState();
    const gamification = normalizeGamification(state.gamification);
    const body = req.body || {};
    const entry = normalizeGamification({
      manualLedger: [{
        ...body,
        id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
      }],
    }).manualLedger[0];
    if (!entry) return res.status(400).json({ error: 'Invalid manual entry' });
    gamification.manualLedger.unshift(entry);
    await writeState({ ...state, gamification });
    res.json({ ok: true, entry, gamification });
  } catch (error) {
    console.error('Failed to add manual gamification entry:', error);
    res.status(400).json({ error: error.message || 'Failed to add manual entry' });
  }
});

app.post('/api/gamification/request/:id', requireAdmin, async (req, res) => {
  try {
    const state = await readState();
    const gamification = normalizeGamification(state.gamification);
    const request = gamification.requests.find(item => item.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    const status = req.body?.status;
    if (!['approved', 'rejected', 'done', 'new'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    request.status = status;
    request.reason = String(req.body?.reason || request.reason || '').trim();
    request.updatedAt = new Date().toISOString();
    await writeState({ ...state, gamification });
    res.json({ ok: true, request, gamification });
  } catch (error) {
    console.error('Failed to update gamification request:', error);
    res.status(400).json({ error: error.message || 'Failed to update request' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ state: await readState() });
  } catch (error) {
    console.error('Failed to read state:', error);
    res.status(500).json({ error: 'Failed to read state' });
  }
});

app.post('/api/state', requireAdmin, async (req, res) => {
  try {
    await writeState(req.body || {});
    res.json({
      ok: true,
      storage: {
        mode: database.enabled ? 'postgres' : 'file',
        persistent: database.enabled ? true : storage.persistent,
        warning: database.enabled ? database.warning : storage.warning,
      },
    });
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

async function startServer() {
  await ensureStorageInitialized();

  app.listen(PORT, () => {
    console.log(`Divergent contest started on port ${PORT}`);
    if (database.enabled) {
      console.log(`Data storage: PostgreSQL app_state/${DB_STATE_KEY}`);
    } else {
      console.log(`Data file: ${storage.dataFile}`);
      if (storage.warning) console.warn(storage.warning);
    }
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
