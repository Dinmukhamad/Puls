'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_LIMIT = Number(process.env.STATE_BACKUP_LIMIT || 25);
const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_STATE_KEY = process.env.DB_STATE_KEY || 'main';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const PASSWORD_ALGORITHM = 'pbkdf2-sha256';
const PASSWORD_KEYLEN = 32;
const SYSTEM_RESET_VERSION = 'auth-login-v2';

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password'],
}));
app.use(express.json({ limit: '5mb' }));

const sessions = new Map();

// ── Seed users из переменных окружения ───────────────────────
// Пароли никогда не хранятся в коде — только в .env на сервере.
// При первом старте хеши генерируются на лету из env-переменных.
// Формат .env:
//   SEED_ADMIN_LOGIN=admin
//   SEED_ADMIN_PASSWORD=ВашПарольАдмина
//   SEED_ADMIN_NAME=Администратор
//   SEED_TEST_LOGIN=test
//   SEED_TEST_PASSWORD=ВашПарольОператора
//   SEED_TEST_NAME=Тестовый оператор
function buildSeedUsers() {
  const users = [];

  const adminLogin    = process.env.SEED_ADMIN_LOGIN    || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
  const adminName     = process.env.SEED_ADMIN_NAME     || adminLogin;

  if (!adminPassword) {
    console.warn('[seed] SEED_ADMIN_PASSWORD не задан — вход администратора невозможен!');
  } else {
    users.push({
      id:    adminLogin,
      login: adminLogin,
      name:  adminName,
      role:  'admin',
      password: createPasswordRecord(adminPassword),
    });
  }

  const testLogin    = process.env.SEED_TEST_LOGIN    || '';
  const testPassword = process.env.SEED_TEST_PASSWORD || '';
  const testName     = process.env.SEED_TEST_NAME     || testLogin;
  const testOpName   = process.env.SEED_TEST_OPERATOR_NAME || testName;

  if (testLogin && testPassword) {
    users.push({
      id:           testLogin,
      login:        testLogin,
      name:         testName,
      role:         'operator',
      operatorName: testOpName,
      password:     createPasswordRecord(testPassword),
    });
  }

  return users;
}

// SEEDED_USERS инициализируется после определения createPasswordRecord (см. ниже)

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

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function normalizePasswordRecord(password) {
  if (!password || typeof password !== 'object') return null;
  const algorithm = String(password.algorithm || '');
  const iterations = Number(password.iterations);
  const salt = String(password.salt || '');
  const hash = String(password.hash || '');
  if (algorithm !== PASSWORD_ALGORITHM || !Number.isFinite(iterations) || iterations < 100000 || !salt || !hash) {
    return null;
  }
  return { algorithm, iterations, salt, hash };
}

function verifyPassword(password, passwordRecord) {
  const record = normalizePasswordRecord(passwordRecord);
  if (!record) return false;
  const candidate = crypto.pbkdf2Sync(String(password || ''), record.salt, record.iterations, PASSWORD_KEYLEN, 'sha256');
  const stored = Buffer.from(record.hash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, PASSWORD_KEYLEN, 'sha256').toString('hex');
  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations,
    salt,
    hash,
  };
}

// Инициализация seed-пользователей (после определения createPasswordRecord)
const SEEDED_USERS = buildSeedUsers();

function normalizeUser(user) {
  const login = String(user?.login || '').trim();
  const loginKey = normalizeLogin(login);
  const role = user?.role === 'admin' ? 'admin' : 'operator';
  const name = String(user?.name || login || '').trim();
  const password = normalizePasswordRecord(user?.password);
  if (!login || !loginKey || !name || !password) return null;
  const operatorName = String(user?.operatorName || (role === 'operator' ? name : '') || '').trim();
  return {
    id: String(user?.id || loginKey),
    login,
    loginKey,
    name,
    role,
    operatorName,
    operatorKey: normalizeOperatorName(user?.operatorKey || operatorName || name),
    password,
  };
}

function getSeedUsers() {
  return SEEDED_USERS.map(normalizeUser).filter(Boolean);
}

function normalizeUsers(users) {
  const source = Array.isArray(users) ? users : [];
  const normalized = [];
  const seen = new Set();

  source.forEach(user => {
    const normalizedUser = normalizeUser(user);
    if (!normalizedUser || seen.has(normalizedUser.loginKey)) return;
    seen.add(normalizedUser.loginKey);
    normalized.push(normalizedUser);
  });

  return normalized.length ? normalized : getSeedUsers();
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    operatorName: user.operatorName,
    operatorKey: user.operatorKey,
  };
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

function getOperatorForUser(state, user) {
  if (!user || user.role !== 'operator') return null;
  const operatorKey = normalizeOperatorName(user.operatorKey || user.operatorName || user.name);
  return getOperatorDirectory(state).find(item => item.nameKey === operatorKey) || null;
}

function ensureOperatorRow(state, operatorName) {
  const baseName = String(operatorName || '').trim();
  if (!baseName || !normalizeOperatorName(baseName)) throw new Error('Operator name is required');

  const faculties = Array.isArray(state.faculties) ? state.faculties : [];
  if (!faculties.length) throw new Error('No groups available');

  let name = baseName;
  const existingKeys = new Set(getOperatorDirectory(state).map(item => item.nameKey));
  for (let suffix = 2; existingKeys.has(normalizeOperatorName(name)); suffix += 1) {
    name = `${baseName}-${suffix}`;
  }

  const facultyIndex = 0;
  const nameKey = normalizeOperatorName(name);

  const faculty = faculties[facultyIndex];
  if (!Array.isArray(faculty.operators)) faculty.operators = [];
  faculty.operators.push(name);

  if (!Array.isArray(state.weeklyData)) state.weeklyData = [[]];
  if (!Array.isArray(state.weeklyData[0])) state.weeklyData[0] = [];
  if (!Array.isArray(state.weeklyData[0][facultyIndex])) state.weeklyData[0][facultyIndex] = [];
  state.weeklyData[0][facultyIndex].push(Array((state.metrics || []).length).fill(0));

  return {
    key: `${facultyIndex}:${faculty.operators.length - 1}`,
    name,
    nameKey,
    facultyId: String(faculty.id || ''),
    facultyName: String(faculty.name || `Group ${facultyIndex + 1}`),
  };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    user: toPublicUser(user),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(token, session);
  return session;
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getSessionFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });
  req.session = session;
  req.user = session.user;
  next();
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

function getDefaultMetrics() {
  return [
    { label: '\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e', type: 'metric' },
    { label: '\u0412\u044b\u0440\u0430\u0431\u043e\u0442\u043a\u0430', type: 'metric' },
    { label: '\u042d\u0444\u0444. %', type: 'metric' },
    { label: '\u0414\u043e\u043f. \u0431\u0430\u043b\u043b\u044b', type: 'metric' },
    { label: '\u041e\u043f\u043e\u0437\u0434. (\u043c\u0438\u043d)', type: 'penalty' },
    { label: '\u041d\u0430\u0440\u0443\u0448\u0435\u043d\u0438\u044f', type: 'penalty' },
    { label: '\u0421\u0430\u0439\u0442\u044b', type: 'penalty' },
    { label: '\u0418\u0442\u043e\u0433\u043e', type: 'score' },
  ];
}

function getResetState() {
  const metrics = getDefaultMetrics();
  const testOperator = 'test test';
  const faculties = [
    { id: 'group-a', cls: 'dauntless', icon: '1', crest: null, name: '\u0413\u0440\u0443\u043f\u043f\u0430 1', enName: 'Team 1', tagCls: 'tag-dauntless', scoreCls: 'dauntless-score', operators: [testOperator] },
    { id: 'group-b', cls: 'erudite', icon: '2', crest: null, name: '\u0413\u0440\u0443\u043f\u043f\u0430 2', enName: 'Team 2', tagCls: 'tag-erudite', scoreCls: 'erudite-score', operators: [] },
    { id: 'group-c', cls: 'candor', icon: '3', crest: null, name: '\u0413\u0440\u0443\u043f\u043f\u0430 3', enName: 'Team 3', tagCls: 'tag-candor', scoreCls: 'candor-score', operators: [] },
  ];
  return {
    faculties,
    weeklyData: [[[Array(metrics.length).fill(0)], [], []]],
    metrics,
    dailyImport: null,
    gamification: { settings: { coinRate: 5 }, manualLedger: [], requests: [] },
    users: getSeedUsers(),
    system: {
      resetVersion: SYSTEM_RESET_VERSION,
      resetAt: new Date().toISOString(),
    },
  };
}

function normalizeSystem(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    resetVersion: String(source.resetVersion || ''),
    resetAt: String(source.resetAt || ''),
  };
}

function sanitizeStateForClient(state) {
  const normalized = normalizeState(state);
  const { users, ...safeState } = normalized;
  return safeState;
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
    users: normalizeUsers(input.users),
    system: normalizeSystem(input.system),
  };
}

function getEmptyState() {
  return getResetState();
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
  if (current.exists && !current.error) {
    const normalized = normalizeState(current.value);
    if (normalized.system?.resetVersion !== SYSTEM_RESET_VERSION) {
      clearFileBackups();
      writeFileState(getResetState(), { skipBackup: true });
    }
    return;
  }

  if (current.error) {
    const corruptPath = `${storage.dataFile}.corrupt-${Date.now()}`;
    fs.renameSync(storage.dataFile, corruptPath);
    console.error(`State file was corrupt and moved to ${corruptPath}:`, current.error);
  }

  const seed = readJsonFile(LEGACY_DATA_FILE);
  if (seed.exists && !seed.error && seed.value) {
    writeFileState(getResetState(), { skipBackup: true });
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

function clearFileBackups() {
  if (!fs.existsSync(storage.backupDir)) return;
  fs.readdirSync(storage.backupDir)
    .filter(name => /^state-\d+\.json$/.test(name))
    .forEach(name => {
      try {
        fs.unlinkSync(path.join(storage.backupDir, name));
      } catch (error) {
        console.error('Failed to remove backup during reset:', error);
      }
    });
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
  return normalizeState(result.value);
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

  const existing = await database.pool.query('SELECT data FROM app_state WHERE id = $1 LIMIT 1', [DB_STATE_KEY]);
  if (existing.rowCount === 0) {
    const normalized = normalizeState(getResetState());
    await database.pool.query(
      'INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, now())',
      [DB_STATE_KEY, JSON.stringify(normalized)]
    );
    console.log(`Seeded PostgreSQL app_state "${DB_STATE_KEY}" with clean auth state.`);
  } else {
    const current = normalizeState(existing.rows[0].data);
    if (current.system?.resetVersion !== SYSTEM_RESET_VERSION) {
      const resetState = normalizeState(getResetState());
      await database.pool.query(
        'UPDATE app_state SET data = $2::jsonb, updated_at = now() WHERE id = $1',
        [DB_STATE_KEY, JSON.stringify(resetState)]
      );
      await clearDatabaseBackups();
      console.log(`Reset PostgreSQL app_state "${DB_STATE_KEY}" for ${SYSTEM_RESET_VERSION}.`);
    }
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

async function clearDatabaseBackups(client = database.pool) {
  await client.query('DELETE FROM app_state_backups WHERE state_id = $1', [DB_STATE_KEY]);
}

async function readDatabaseState() {
  await ensureDatabaseInitialized();
  const result = await database.pool.query('SELECT data FROM app_state WHERE id = $1', [DB_STATE_KEY]);
  if (result.rowCount === 0) return normalizeState(getEmptyState());
  return normalizeState(result.rows[0].data);
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
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });
  if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  req.session = session;
  req.user = session.user;
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

app.post('/api/auth/login', async (req, res) => {
  try {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const loginKey = normalizeLogin(login);
    if (!loginKey || !password) return res.status(400).json({ error: 'Login and password are required' });

    const state = await readState();
    const user = normalizeUsers(state.users).find(item => item.loginKey === loginKey);
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid login or password' });
    }

    const session = createSession(user);
    res.json({
      ok: true,
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: session.user,
      operator: getOperatorForUser(state, user),
    });
  } catch (error) {
    console.error('Failed to login user:', error);
    res.status(500).json({ error: error.message || 'Failed to login' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const loginKey = normalizeLogin(login);

    if (!loginKey || login.length < 3) {
      return res.status(400).json({ error: 'Логин должен быть не короче 3 символов' });
    }
    if (!/^[a-z0-9._-]+$/i.test(login)) {
      return res.status(400).json({ error: 'Логин может содержать латинские буквы, цифры, точку, дефис и подчёркивание' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }

    const state = await readState();
    const users = normalizeUsers(state.users);
    if (users.some(user => user.loginKey === loginKey)) {
      return res.status(409).json({ error: 'Такой логин уже занят' });
    }

    const operator = ensureOperatorRow(state, login);
    const user = normalizeUser({
      id: loginKey,
      login,
      name: login,
      role: 'operator',
      operatorName: operator.name,
      operatorKey: operator.nameKey,
      password: createPasswordRecord(password),
    });
    if (!user) return res.status(400).json({ error: 'Не удалось создать пользователя' });

    state.users = [...users, user];
    await writeState(state);

    const session = createSession(user);
    res.status(201).json({
      ok: true,
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: session.user,
      operator: getOperatorForUser(state, user),
      state: sanitizeStateForClient(state),
    });
  } catch (error) {
    console.error('Failed to register operator:', error);
    res.status(500).json({ error: error.message || 'Failed to register operator' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const state = await readState();
    res.json({
      ok: true,
      user: req.user,
      operator: getOperatorForUser(state, req.user),
      expiresAt: new Date(req.session.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error('Failed to read session user:', error);
    res.status(500).json({ error: error.message || 'Failed to read session' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.token);
  res.json({ ok: true });
});

app.post('/api/admin/reset-state', requireAdmin, async (req, res) => {
  try {
    await writeState(getResetState(), { skipBackup: true });
    if (database.enabled) {
      await clearDatabaseBackups();
    } else {
      clearFileBackups();
    }
    res.json({ ok: true, state: sanitizeStateForClient(getResetState()) });
  } catch (error) {
    console.error('Failed to reset state:', error);
    res.status(500).json({ error: error.message || 'Failed to reset state' });
  }
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/operator/login', (req, res) => {
  res.status(410).json({ error: 'Use /api/auth/login' });
});

app.post('/api/gamification/request', requireAuth, async (req, res) => {
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
    if (req.user.role !== 'admin') {
      const allowedKey = normalizeOperatorName(req.user.operatorKey || req.user.operatorName || req.user.name);
      if (request.operatorKey !== allowedKey) {
        return res.status(403).json({ error: 'Operator can create requests only for own account' });
      }
      request.operatorName = req.user.operatorName || req.user.name;
    }
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
    res.json({ state: sanitizeStateForClient(await readState()) });
  } catch (error) {
    console.error('Failed to read state:', error);
    res.status(500).json({ error: 'Failed to read state' });
  }
});

app.post('/api/state', requireAdmin, async (req, res) => {
  try {
    const currentState = await readState();
    await writeState({ ...(req.body || {}), users: currentState.users, system: currentState.system });
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
