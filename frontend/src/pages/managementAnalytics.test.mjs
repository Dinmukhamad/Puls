import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function load(search, role = 'supervisor') {
  const queries = [], updates = [];
  const mocks = {
    '@tanstack/react-query': { useQuery: options => { queries.push(options); return { data: undefined, isLoading: false, isError: false }; } },
    'react-router-dom': { useSearchParams: () => [new URLSearchParams(search), next => updates.push(next)] },
    AuthContext: { useAuth: () => ({ user: { id: 42, role } }) },
  };
  const built = await build({
    entryPoints: [fileURLToPath(new URL('./ManagementAnalyticsPage.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, write: false,
    plugins: [{ name: 'fixtures', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, ({ path }) => {
        const key = Object.keys(mocks).find(name => path === name || path.endsWith(`/${name}`));
        return key ? { path: `test:${key}`, external: true } : undefined;
      });
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => name.startsWith('test:') ? mocks[name.slice(5)] : require(name), module, module.exports);
  let result;
  function Probe() { result = module.exports.useManagementAnalytics(); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  return { ...module.exports, queries, updates, result };
}

test('default queries use four completed weeks and isolate the cache by authenticated user', async () => {
  const { queries, result } = await load('');
  assert.equal(result.mode, 'weeks');
  const main = queries.find(q => q.queryKey[0] === 'management-analytics');
  assert.equal(main.queryKey[1], 42);
  assert.equal(main.queryKey[3], 'supervisor');
  assert.equal(main.queryKey[2].grain, 'week');
  const from = new Date(`${main.queryKey[2].date_from}T00:00:00Z`);
  const to = new Date(`${main.queryKey[2].date_to}T00:00:00Z`);
  assert.equal(from.getUTCDay(), 1);
  assert.equal(to.getUTCDay(), 0);
  assert.equal((to - from) / 864e5, 27);
  assert.equal(queries.find(q => q.queryKey[0] === 'management-weeks').enabled, false);
});

test('an old date-range link retains its average while the weekly comparison has an independent window', async () => {
  const { queries, result } = await load('from=2026-09-01&to=2026-10-08&group_id=4&metric=efficiency&operators=7,8');
  assert.equal(result.mode, 'range');
  assert.deepEqual(result.filters, { grain: 'range', date_from: '2026-09-01', date_to: '2026-10-08', group_id: 4, metric_code: 'efficiency', operator_ids: '7,8', channel: 'line' });
  const weekly = queries.find(q => q.queryKey[0] === 'management-weeks');
  assert.equal(weekly.enabled, true);
  assert.deepEqual(weekly.queryKey[2], { ...result.filters, grain: 'week', date_from: '2026-09-14', date_to: '2026-10-11' });
  assert.equal(weekly.queryKey[1], 42);
});

test('explicit weekly mode normalizes whole weeks and updates preserve unrelated filters', async () => {
  const { result, updates } = await load('window=weeks&from=2026-09-01&to=2026-10-08&group_id=4&tab=operators&grain=month&week_id=8');
  assert.deepEqual(result.range, { date_from: '2026-09-14', date_to: '2026-10-11' });
  result.setRange({ date_from: '2026-08-01', date_to: '2026-08-20' }, 'range');
  assert.equal(updates[0].get('group_id'), '4');
  assert.equal(updates[0].get('tab'), 'operators');
  assert.equal(updates[0].get('window'), 'range');
  assert.equal(updates[0].has('grain'), false);
  assert.equal(updates[0].has('week_id'), false);
});

test('invalid, incomplete and extreme bookmarked dates do not crash the workspace', async () => {
  for (const search of ['from=2026-10-08', 'from=2026-10-11&to=2026-10-01', 'from=junk&to=2026-10-08', 'from=0001-01-01&to=0001-01-01', 'from=9999-12-01&to=9999-12-31']) {
    const { result } = await load(search);
    assert.equal(result.mode, 'weeks', search);
    assert.equal(result.filters.grain, 'week');
  }
});

test('role-specific headings and scope are determined by the authenticated profile', async () => {
  for (const role of ['head', 'supervisor']) {
    const { ManagementAnalyticsPage } = await load('tab=groups', role);
    const html = renderToStaticMarkup(React.createElement(ManagementAnalyticsPage));
    assert.match(html, role === 'head' ? /Аналитика руководителя/ : /Аналитика супервайзера/);
    assert.match(html, role === 'head' ? /Линия · все группы/ : /Линия · только мои операторы/);
    assert.doesNotMatch(html, /Выбрать роль|Переключить роль/);
  }
});

test('chats are one channel at a time and switching drops the other channel\'s picks', async () => {
  const { result, updates } = await load('channel=chat&tab=productivity&metric=quality&operators=7&status=late&page=3&group_id=4');
  assert.equal(result.channel, 'chat');
  assert.equal(result.filters.channel, 'chat');
  result.setChannel('line');
  assert.equal(updates[0].has('channel'), false);
  for (const key of ['metric', 'operators', 'status', 'page']) assert.equal(updates[0].has(key), false, key);
  assert.equal(updates[0].get('group_id'), '4');
  const back = await load('tab=productivity&metric=efficiency');
  back.result.setChannel('chat');
  assert.equal(back.updates[0].get('channel'), 'chat');
  // The tab stays: chats show productivity once their hours or response time are loaded.
  assert.equal(back.updates[0].get('tab'), 'productivity');
});
