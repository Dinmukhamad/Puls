import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./qrPresentation.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { secondsLeft, clock, runningOut, deviceName, QR_LIFETIME_SECONDS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('the QR counts down whole seconds and never past its five minutes', () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  assert.equal(secondsLeft('2026-10-17T10:05:00Z', now), QR_LIFETIME_SECONDS);
  assert.equal(secondsLeft('2026-10-17T10:04:59.200Z', now), 300, 'a started second still counts');
  assert.equal(secondsLeft('2026-10-17T10:01:05Z', now), 65);
  assert.equal(secondsLeft('2026-10-17T10:09:00Z', now), 300, 'a clock behind the server cannot show more than five minutes');
  assert.equal(secondsLeft('2026-10-17T09:59:00Z', now), 0);
  assert.equal(secondsLeft(null, now), 0);
  assert.equal(secondsLeft('не дата', now), 0);
});

test('the time reads as minutes and seconds, the last minute as running out', () => {
  assert.deepEqual([300, 65, 9, 0].map(clock), ['5:00', '1:05', '0:09', '0:00']);
  assert.deepEqual([300, 61, 60, 1, 0].map(runningOut), [false, false, true, true, false]);
});

test('the staff see the browser and system the QR was made on', () => {
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), 'Chrome · Windows');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge · Windows');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 YaBrowser/25.8 Safari/537.36'), 'Яндекс Браузер · Windows');
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'), 'Safari · iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'), 'Chrome · Android');
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox · macOS');
  assert.equal(deviceName('Неизвестное устройство'), 'Неизвестное устройство');
  assert.equal(deviceName(''), 'Неизвестное устройство');
});
