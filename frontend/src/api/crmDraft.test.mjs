import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('./crmDraft.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'crm-draft-client', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'fixture:client', external: true }));
  } }],
});
function setup() {
  const requests = [], response = { draft_key: 'saved-draft', revision: 4 };
  const client = {
    request: async (path, options = {}) => { requests.push({ path, ...options }); return response; },
    buildQuery: values => {
      const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value != null));
      return query.size ? `?${query}` : '';
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(name => {
    assert.equal(name, 'fixture:client'); return client;
  }, module, module.exports);
  return { api: module.exports.crmDraftApi, requests, response };
}

test('draft reads and deletes keep general drafts separate from each training task', async () => {
  const { api, requests, response } = setup();
  assert.equal(await api.load(), response);
  assert.equal(await api.load('crm_phone'), response);
  await api.clear();
  await api.clear('crm_closed');
  assert.deepEqual(requests, [
    { path: '/api/v1/learning/crm/draft' },
    { path: '/api/v1/learning/crm/draft?task=crm_phone' },
    { path: '/api/v1/learning/crm/draft', method: 'DELETE' },
    { path: '/api/v1/learning/crm/draft?task=crm_closed', method: 'DELETE' },
  ]);
});

test('saving a draft sends revision, removals and new binary files in multipart form', async () => {
  const { api, requests, response } = setup();
  const write = {
    task: 'crm_phone', draft_key: 'saved-draft', revision: 3,
    form: { request_id: 'request-1', comment: 'Незавершённый комментарий', phone: '', category_ids: [], details: {} },
    remove_attachment_ids: [71], appeal_id: 91, remove_appeal_attachment_ids: [101],
  };
  const first = new File(['PNG bytes'], 'screen.png', { type: 'image/png' });
  const second = new File(['PDF bytes'], 'note.pdf', { type: 'application/pdf' });
  assert.equal(await api.save(write, [first, second]), response);
  const request = requests[0];
  assert.equal(request.path, '/api/v1/learning/crm/draft?task=crm_phone');
  assert.equal(request.method, 'PUT');
  assert.equal(request.json, undefined, 'files must not be reduced to JSON metadata');
  assert.deepEqual(JSON.parse(request.multipart.get('payload')), write);
  const files = request.multipart.getAll('files');
  assert.deepEqual(files.map(file => [file.name, file.type, file.size]), [
    ['screen.png', 'image/png', first.size], ['note.pdf', 'application/pdf', second.size],
  ]);
  assert.deepEqual(await Promise.all(files.map(file => file.text())), ['PNG bytes', 'PDF bytes']);
});
