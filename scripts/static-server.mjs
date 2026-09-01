/**
 * Статика для e2e-прогонов.
 *
 * Раньше Playwright поднимал `.venv\Scripts\python.exe -m http.server` —
 * путь с обратными слэшами существует только на Windows, поэтому в CI на
 * ubuntu конфиг не запустился бы вовсе. Здесь тот же сервер на голом
 * node:http: одинаково работает на обеих платформах и не требует Python.
 *
 * Использование: node scripts/static-server.mjs [порт] [корень]
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const port = Number(process.argv[2] || process.env.PULS_E2E_PORT || 8930);
const root = resolve(process.argv[3] || process.cwd());

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // Нормализуем и держим путь внутри корня: сервер поднимается локально,
  // но выходить за пределы репозитория ему незачем.
  const target = resolve(join(root, normalize(requested)));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let file = target;
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }

  let size;
  try { size = statSync(file).size; } catch {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': size,
    // Снимки не должны зависеть от того, что осталось в кеше от прошлого прогона.
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`static server: http://127.0.0.1:${port} (${root})`);
});
