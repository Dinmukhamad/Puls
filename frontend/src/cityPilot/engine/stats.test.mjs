import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./stats.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { CityStats } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('timing reflects 120, 60 and 30 Hz rendering, not the number of callbacks alone', () => {
  for (const fps of [120, 60, 30]) {
    const stats = new CityStats();
    for (let i = 0; i <= 120; i++) stats.record(i * 1000 / fps, 2, 40, 90_000);
    const measured = stats.snapshot();
    close(measured.fps, fps);
    close(measured.fpsP1, fps);
    close(measured.elapsedMs, 120 * 1000 / fps);
    close(measured.maxFrameMs, 1000 / fps);
    assert.equal(measured.frames, 120);
    assert.equal(measured.cpuMs, 2);
    assert.equal(measured.drawCalls, 40);
    assert.equal(measured.triangles, 90_000);
  }
});

test('average FPS is based on total frame time, not an inflated mean of instantaneous FPS', () => {
  const stats = new CityStats();
  stats.record(0, 99, 999, 9999);
  stats.record(10, 2, 20, 200);
  stats.record(50, 8, 80, 800);
  const measured = stats.snapshot();
  assert.equal(measured.fps, 40);
  assert.equal(measured.fpsP1, 25);
  assert.equal(measured.cpuMs, 5);
  assert.equal(measured.drawCalls, 50);
  assert.equal(measured.triangles, 500);
});

test('visible loading and jank count in elapsed time, p99 and worst frame', () => {
  const stats = new CityStats();
  let time = 0;
  stats.record(time, 0, 0, 0);
  for (let i = 0; i < 98; i++) stats.record(time += 10, 1, 10, 100);
  stats.record(time += 250, 50, 20, 200);
  stats.record(time += 1000, 100, 40, 400);
  const measured = stats.snapshot();
  assert.equal(measured.frames, 100);
  assert.equal(measured.elapsedMs, 2230);
  close(measured.fps, 100_000 / 2230);
  // 99th of 100 values is 250 ms; the single 1,000 ms stall is still in max and FPS.
  assert.equal(measured.fpsP1, 4);
  assert.equal(measured.maxFrameMs, 1000);
});

test('explicit suspension excludes hidden time and keeps measurements collected before it', () => {
  const stats = new CityStats();
  stats.record(0, 0, 0, 0);
  stats.record(20, 2, 20, 200);
  stats.suspend();
  stats.record(300_000, 99, 999, 9999);
  stats.record(300_020, 4, 40, 400);
  assert.deepEqual(stats.snapshot(), { fps: 50, fpsP1: 50, cpuMs: 3, drawCalls: 30, triangles: 300, frames: 2, elapsedMs: 40, maxFrameMs: 20 });
});

test('bounded window discards old stalls and associated CPU/geometry counters after wraparound', () => {
  const stats = new CityStats(3);
  stats.record(0, 0, 0, 0);
  stats.record(1000, 100, 1000, 10000);
  for (let i = 1; i <= 10_000; i++) stats.record(1000 + i * 10, i, i * 2, i * 3);
  assert.deepEqual(stats.snapshot(), { fps: 100, fpsP1: 100, cpuMs: 9999, drawCalls: 19998, triangles: 29997, frames: 3, elapsedMs: 30, maxFrameMs: 10 });
});

test('reset removes earlier runs and their clock baseline even after ring wraparound', () => {
  const stats = new CityStats(2);
  for (let i = 0; i < 5; i++) stats.record(i * 500, 500, 500, 500);
  stats.reset();
  assert.deepEqual(stats.snapshot(), { fps: 0, fpsP1: 0, cpuMs: 0, drawCalls: 0, triangles: 0, frames: 0, elapsedMs: 0, maxFrameMs: 0 });
  stats.record(20, 0, 0, 0);
  stats.record(30, 1, 2, 3);
  assert.deepEqual(stats.snapshot(), { fps: 100, fpsP1: 100, cpuMs: 1, drawCalls: 2, triangles: 3, frames: 1, elapsedMs: 10, maxFrameMs: 10 });
});

test('invalid and repeated timestamps do not poison the clock; invalid counters become zero', () => {
  const stats = new CityStats();
  stats.record(NaN, 1, 1, 1);
  stats.record(0, 1, 1, 1);
  stats.record(10, 1, 2, 3);
  stats.record(10, 999, 999, 999);
  stats.record(5, 999, 999, 999);
  stats.record(Infinity, 999, 999, 999);
  stats.record(20, NaN, -1, Infinity);
  assert.deepEqual(stats.snapshot(), { fps: 100, fpsP1: 100, cpuMs: .5, drawCalls: 1, triangles: 1.5, frames: 2, elapsedMs: 20, maxFrameMs: 10 });
});

test('capacity is explicitly bounded and rejects invalid allocation requests', () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, 300_001]) assert.throws(() => new CityStats(size), RangeError);
  const stats = new CityStats(1);
  stats.record(0, 1, 1, 1);
  stats.record(10, 2, 2, 2);
  stats.record(30, 3, 3, 3);
  assert.deepEqual(stats.snapshot(), { fps: 50, fpsP1: 50, cpuMs: 3, drawCalls: 3, triangles: 3, frames: 1, elapsedMs: 20, maxFrameMs: 20 });
});

test('long-run capacity retains a complete twenty-minute measurement at 144 Hz', () => {
  const stats = new CityStats(180_000);
  const frames = 144 * 60 * 20;
  for (let i = 0; i <= frames; i++) stats.record(i * 1000 / 144, 2, 40, 90_000);
  const measured = stats.snapshot();
  assert.equal(measured.frames, frames);
  close(measured.elapsedMs, 20 * 60 * 1000);
  close(measured.fps, 144);
  close(measured.fpsP1, 144);
  assert.doesNotThrow(() => new CityStats(300_000));
});
