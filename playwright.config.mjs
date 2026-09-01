/**
 * Визуальные базлайны маршрутов (ТЗ, «Порядок изменений в репозитории»:
 * screenshot test на 1536×1024, 1024×768 и 390×844).
 *
 * Приложение поднимается как статика, а API подменяется фикстурами прямо
 * в тесте. Так снимок не зависит ни от живого бэкенда, ни от того, кто и
 * когда менял данные: иначе базлайн ломался бы после каждого импорта
 * операторов, а не после правки вёрстки.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PULS_E2E_PORT || 8930);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.artifacts',
  // Платформа в имени намеренно: сглаживание шрифтов у Windows и Linux
  // разное, и один общий базлайн либо падал бы в CI, либо был бы там
  // бесполезно терпимым. Разные платформы — разные снимки.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Анимации в снимках дают ложные расхождения между прогонами.
    screenshot: 'off',
    trace: 'off',
  },
  expect: {
    toHaveScreenshot: {
      // Сглаживание шрифтов различается между машинами: небольшой допуск
      // отсекает шум, но не пропустит реальный сдвиг вёрстки.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } } },
    { name: 'tablet',  use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'mobile',  use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    // Свой статик-сервер на node вместо python из .venv: путь к нему был
    // записан в windows-виде и в CI на ubuntu не запустился бы.
    command: `node scripts/static-server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
