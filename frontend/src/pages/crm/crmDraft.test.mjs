import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./crmDraft.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { CrmDraftController, crmDraftIdentity } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const initial = () => ({
  request_id: 'd076f8a1-5c31-471d-895a-a8c476dcd11c', channel: 'Звонок',
  phone: '', license_number: '', driver_id: '', contacted_at: '2026-10-15T12:30',
  park: '', city: '', category_ids: [], details: {}, comment: '', is_ticket: false,
});
const remote = (change = {}) => ({
  draft_key: 'server-draft-41-crm-phone', task: 'crm_phone', revision: 3,
  form: { ...initial(), comment: 'Сохранённый комментарий', city: 'Алматы' },
  attachments: [], updated_at: '2026-10-15T08:00:00Z', ...change,
});
const attachment = (id = 71, name = 'screen.png') => ({ id, name, mime: 'image/png', size: 28 });
function ack(write, attachments = []) {
  return remote({ ...write, draft_key: write.draft_key ?? 'created-draft', revision: write.revision + 1, attachments });
}
function setup(t, options = {}) {
  const requests = [], load = options.load ?? (async () => remote());
  const controller = new CrmDraftController({
    identity: { userId: 41, task: 'crm_phone' }, initial: initial(), debounceMs: 999999,
    transport: { load, save(write, files) {
      const response = deferred();
      requests.push({ write: structuredClone(write), files: [...files], ...response });
      return response.promise;
    } }, ...options,
  });
  t.after(() => controller.dispose());
  return { controller, requests };
}

test('restoring a draft keeps server attachment identities and does not upload them again', async t => {
  const savedFile = attachment();
  const { controller, requests } = setup(t, { load: async () => remote({ attachments: [savedFile] }) });
  await controller.start();
  assert.equal(controller.getSnapshot().form.comment, 'Сохранённый комментарий');
  assert.deepEqual(controller.getSnapshot().attachments, [savedFile]);
  assert.deepEqual(controller.getSnapshot().files, []);
  controller.change({ comment: 'Уточнение после восстановления' });
  const saved = controller.flush();
  await settle();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].files, []);
  assert.deepEqual(requests[0].write.remove_attachment_ids, []);
  assert.equal(requests[0].write.draft_key, 'server-draft-41-crm-phone');
  assert.equal(requests[0].write.revision, 3);
  requests[0].resolve(ack(requests[0].write, [savedFile]));
  await saved;
  assert.equal(controller.getSnapshot().status, 'saved');
  assert.deepEqual(controller.getSnapshot().attachments, [savedFile]);
});

test('an explicit appeal copy keeps its new fields and request identity without copying unfinished draft attachments', async t => {
  const copied = { ...initial(), request_id: 'new-copy-request', phone: '+77001234567', comment: 'Скопированное обращение' };
  const { controller, requests } = setup(t, {
    initial: copied, initialDirty: true,
    load: async () => remote({ attachments: [attachment(71, 'unfinished.png')] }),
  });
  await controller.start();
  assert.equal(controller.getSnapshot().form.request_id, 'new-copy-request');
  assert.equal(controller.getSnapshot().form.comment, 'Скопированное обращение');
  assert.deepEqual(controller.getSnapshot().attachments, []);
  const flushed = controller.flush(); await settle();
  assert.deepEqual(requests[0].write.remove_attachment_ids, [71]);
  assert.deepEqual(requests[0].files, []);
  requests[0].resolve(ack(requests[0].write)); await flushed;
});

test('a late restoration merges untouched fields without replacing text typed during loading', async t => {
  const load = deferred();
  const { controller, requests } = setup(t, { load: () => load.promise });
  const started = controller.start();
  controller.change({ phone: '+77000000001', comment: 'Новый ввод до ответа сервера' });
  load.resolve(remote({ form: { ...initial(), phone: '+77009999999', comment: 'Старый текст', city: 'Астана', park: 'iTaxi' } }));
  await started;
  const restored = controller.getSnapshot();
  assert.equal(restored.form.phone, '+77000000001');
  assert.equal(restored.form.comment, 'Новый ввод до ответа сервера');
  assert.equal(restored.form.city, 'Астана');
  assert.equal(restored.form.park, 'iTaxi');
  assert.notEqual(restored.status, 'saved');
  const flushed = controller.flush(); await settle();
  assert.equal(requests[0].write.form.comment, 'Новый ввод до ответа сервера');
  assert.equal(requests[0].write.form.city, 'Астана');
  requests[0].resolve(ack(requests[0].write));
  await flushed;
});

test('saves never overlap, queued edits use the acknowledged revision and only the newest acknowledgement is saved', async t => {
  const { controller, requests } = setup(t);
  await controller.start();
  controller.change({ comment: 'Первый снимок' });
  let finished = false;
  const firstFlush = controller.flush().then(value => { finished = true; return value; });
  await settle();
  assert.equal(requests.length, 1);
  controller.change({ comment: 'Промежуточный снимок' });
  controller.change({ comment: 'Последний снимок', city: 'Астана' });
  const finalFlush = controller.flush();
  await settle();
  assert.equal(requests.length, 1, 'a second write must wait for the first acknowledgement');
  assert.equal(finished, false);
  requests[0].resolve(ack(requests[0].write));
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].write.revision, 4);
  assert.equal(requests[1].write.form.comment, 'Последний снимок');
  assert.equal(requests[1].write.form.city, 'Астана');
  assert.notEqual(controller.getSnapshot().status, 'saved', 'an older acknowledgement must not claim newer edits were saved');
  assert.equal(finished, false, 'final flush must wait for all queued edits');
  requests[1].resolve(ack(requests[1].write));
  await Promise.all([firstFlush, finalFlush]);
  assert.equal(controller.getSnapshot().status, 'saved');
  assert.equal(controller.getSnapshot().revision, 5);
  assert.equal(controller.getSnapshot().form.comment, 'Последний снимок');
});

test('removing a restored file sends its server ID while uploading only newly added files', async t => {
  const { controller, requests } = setup(t, { load: async () => remote({ attachments: [attachment(71), attachment(72, 'keep.png')] }) });
  await controller.start();
  const file = new File(['new screenshot'], 'new.png', { type: 'image/png' });
  controller.addFiles([file]);
  controller.removeAttachment(71);
  const flushed = controller.flush(); await settle();
  assert.deepEqual(requests[0].write.remove_attachment_ids, [71]);
  assert.deepEqual(requests[0].files, [file]);
  assert.deepEqual(controller.getSnapshot().attachments.map(item => item.id), [72]);
  requests[0].resolve(ack(requests[0].write, [attachment(72, 'keep.png'), attachment(73, 'new.png')]));
  await flushed;
  assert.deepEqual(controller.getSnapshot().files, []);
  assert.deepEqual(controller.getSnapshot().attachments.map(item => item.id), [72, 73]);
  controller.change({ comment: 'Следующее сохранение' });
  const next = controller.flush(); await settle();
  assert.deepEqual(requests[1].files, [], 'a confirmed upload must not be sent twice');
  assert.deepEqual(requests[1].write.remove_attachment_ids, []);
  requests[1].resolve(ack(requests[1].write, [attachment(72, 'keep.png'), attachment(73, 'new.png')]));
  await next;
});

test('files added during an upload remain queued until their own acknowledgement', async t => {
  const { controller, requests } = setup(t);
  await controller.start();
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.png', { type: 'image/png' });
  controller.addFiles([first]);
  const flushed = controller.flush(); await settle();
  controller.addFiles([second]);
  assert.deepEqual(requests[0].files, [first]);
  requests[0].resolve(ack(requests[0].write, [attachment(81, 'first.png')]));
  await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].files, [second]);
  assert.deepEqual(controller.getSnapshot().files.map(item => item.file), [second]);
  assert.notEqual(controller.getSnapshot().status, 'saved');
  requests[1].resolve(ack(requests[1].write, [attachment(81, 'first.png'), attachment(82, 'second.png')]));
  await flushed;
  assert.deepEqual(controller.getSnapshot().files, []);
  assert.deepEqual(controller.getSnapshot().attachments.map(item => item.id), [81, 82]);
});

test('a failed final flush rejects, retains the text and files, and a manual retry can save them', async t => {
  const { controller, requests } = setup(t);
  await controller.start();
  const file = new File(['proof'], 'proof.png', { type: 'image/png' });
  controller.change({ comment: 'Не терять при потере связи' });
  controller.addFiles([file]);
  const failed = assert.rejects(controller.flush()); await settle();
  requests[0].reject(new TypeError('Нет соединения'));
  await failed;
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().form.comment, 'Не терять при потере связи');
  assert.deepEqual(controller.getSnapshot().files.map(item => item.file), [file]);
  assert.equal(requests.length, 1, 'an error must not create an automatic retry loop');
  const retried = controller.flush(); await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].write.revision, 3);
  assert.equal(requests[1].write.form.comment, 'Не терять при потере связи');
  assert.deepEqual(requests[1].files, [file]);
  requests[1].resolve(ack(requests[1].write, [attachment(91, 'proof.png')]));
  await retried;
  assert.equal(controller.getSnapshot().status, 'saved');
  assert.deepEqual(controller.getSnapshot().files, []);
});

test('a revision conflict blocks queued writes and generic retry until the operator chooses a version', async t => {
  let current = remote();
  const { controller, requests } = setup(t, { load: async () => current });
  await controller.start();
  controller.change({ comment: 'Мой черновик' });
  const rejected = assert.rejects(controller.flush(), { status: 409 }); await settle();
  controller.change({ comment: 'Мой последний черновик' });
  requests[0].reject(Object.assign(new Error('Черновик обновлён в другой вкладке'), { status: 409 }));
  await rejected;
  assert.equal(controller.getSnapshot().status, 'conflict');
  assert.equal(controller.getSnapshot().form.comment, 'Мой последний черновик');
  await controller.retry();
  await assert.rejects(controller.flush());
  assert.equal(requests.length, 1, 'the losing revision must not be retried or overwrite the other tab silently');
  current = remote({ revision: 8, form: { ...initial(), comment: 'Из другой вкладки' } });
  const resumed = controller.resolveConflict('local'); await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].write.revision, 8);
  assert.equal(requests[1].write.form.comment, 'Мой последний черновик');
  assert.notEqual(controller.getSnapshot().status, 'saved');
  requests[1].resolve(ack(requests[1].write)); await resumed;
  assert.equal(controller.getSnapshot().revision, 9);
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('choosing the server after a conflict discards pending uploads without another write', async t => {
  let current = remote();
  const { controller, requests } = setup(t, { load: async () => current });
  await controller.start();
  controller.addFiles([new File(['mine'], 'mine.png', { type: 'image/png' })]);
  const rejected = assert.rejects(controller.flush()); await settle();
  requests[0].reject(Object.assign(new Error('Conflict'), { status: 409 })); await rejected;
  current = remote({ revision: 9, form: { ...initial(), comment: 'Актуальный серверный текст' }, attachments: [attachment(99)] });
  await controller.resolveConflict('remote');
  const state = controller.getSnapshot();
  assert.equal(state.status, 'saved');
  assert.equal(state.revision, 9);
  assert.equal(state.form.comment, 'Актуальный серверный текст');
  assert.deepEqual(state.files, []);
  assert.deepEqual(state.attachments, [attachment(99)]);
  await controller.flush();
  assert.equal(requests.length, 1);
});

test('recovery keys distinguish operators, training tasks and edited appeals', () => {
  const identities = [
    { userId: 41 }, { userId: 42 },
    { userId: 41, task: 'crm_first' }, { userId: 41, task: 'crm_phone' },
    { userId: 41, task: 'crm_phone', appealId: 71 },
    { userId: 41, task: 'crm_phone', appealId: 72 },
  ];
  assert.equal(new Set(identities.map(crmDraftIdentity)).size, identities.length);
  assert.equal(crmDraftIdentity({ userId: 41, task: 'crm_phone' }), crmDraftIdentity({ task: 'crm_phone', userId: 41 }));
});

test('a recovered upload and a newly added file with the same name keep distinct identities', async t => {
  const recovered = new File(['recovered'], 'screen.png', { type: 'image/png' });
  const added = new File(['new'], 'screen.png', { type: 'image/png' });
  const stored = remote();
  const { controller, requests } = setup(t, {
    load: async () => stored,
    backup: {
      load: async () => ({ form: stored.form, draftKey: stored.draft_key, revision: stored.revision,
        files: [{ key: '1:screen.png', file: recovered }], removedAttachmentIds: [], removedAppealAttachmentIds: [] }),
      save() {}, clear() {},
    },
  });
  await controller.start();
  const flushed = controller.flush(); await settle();
  controller.addFiles([added]);
  assert.equal(new Set(controller.getSnapshot().files.map(item => item.key)).size, 2);
  requests[0].resolve(ack(requests[0].write, [attachment(111, 'screen.png')])); await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].files, [added]);
  requests[1].resolve(ack(requests[1].write, [attachment(111, 'screen.png'), attachment(112, 'screen.png')]));
  await flushed;
  assert.deepEqual(controller.getSnapshot().attachments.map(item => item.id), [111, 112]);
});

test('autosave coalesces a burst of typing and never rewrites an unchanged restored draft', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, requests } = setup(t, { debounceMs: 50 });
  await controller.start();
  t.mock.timers.tick(100); await settle();
  assert.equal(requests.length, 0);
  controller.change({ comment: 'П' });
  controller.change({ comment: 'Полный комментарий' });
  t.mock.timers.tick(49); await settle();
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1); await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].write.form.comment, 'Полный комментарий');
  requests[0].resolve(ack(requests[0].write)); await settle();
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('a failed load retains recovered file bytes and typing, then a retry merges untouched server fields', async t => {
  const pending = deferred(), file = new File(['cached bytes'], 'cached.png', { type: 'image/png' });
  let loads = 0;
  const cached = { ...initial(), comment: 'Текст из локальной копии' };
  const { controller, requests } = setup(t, {
    load: () => ++loads === 1 ? pending.promise : Promise.resolve(remote({ revision: 3, form: cached })),
    backup: {
      load: async () => ({ form: cached, draftKey: 'server-draft-41-crm-phone', revision: 3,
        files: [{ key: 'recovered-file', file }], removedAttachmentIds: [], removedAppealAttachmentIds: [] }),
      save() {}, clear() {},
    },
  });
  const started = controller.start();
  controller.change({ phone: '+77000000001' });
  pending.reject(new TypeError('Нет связи')); await started;
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().form.comment, cached.comment);
  assert.equal(controller.getSnapshot().form.phone, '+77000000001');
  assert.deepEqual(controller.getSnapshot().files.map(item => item.file), [file]);
  await assert.rejects(controller.flush());
  assert.equal(requests.length, 0, 'a failed restoration must not overwrite an unknown server revision');
  await controller.retry();
  assert.equal(controller.getSnapshot().status, 'unsaved');
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().form.phone, '+77000000001');
  assert.deepEqual(controller.getSnapshot().files.map(item => item.file), [file]);
  const saved = controller.flush(); await settle();
  requests[0].resolve(ack(requests[0].write, [attachment(121, 'cached.png')])); await saved;
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('an older local recovery copy cannot silently overwrite a newer server revision', async t => {
  const server = remote({ revision: 7 });
  const { controller, requests } = setup(t, {
    load: async () => server,
    backup: {
      load: async () => ({ form: { ...initial(), comment: 'Старая локальная версия' },
        draftKey: server.draft_key, revision: 3, files: [], removedAttachmentIds: [], removedAppealAttachmentIds: [] }),
      save() {}, clear() {},
    },
  });
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'conflict');
  assert.equal(controller.getSnapshot().form.comment, 'Старая локальная версия');
  await assert.rejects(controller.flush());
  assert.equal(requests.length, 0);
  await controller.resolveConflict('remote');
  assert.equal(controller.getSnapshot().form.comment, server.form.comment);
  assert.equal(controller.getSnapshot().revision, 7);
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('a browser backup quota failure does not lose the edit or claim it is already saved', async t => {
  const { controller, requests } = setup(t, {
    backup: { load: async () => null, save() { throw new Error('QuotaExceededError'); }, clear() {} },
  });
  await controller.start();
  assert.doesNotThrow(() => controller.change({ comment: 'Данные для сервера' }));
  assert.equal(controller.getSnapshot().form.comment, 'Данные для сервера');
  assert.notEqual(controller.getSnapshot().status, 'saved');
  const flushed = controller.flush(); await settle();
  requests[0].resolve(ack(requests[0].write)); await flushed;
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('a confirmed server save stays saved when clearing the browser recovery copy fails', async t => {
  const { controller, requests } = setup(t, {
    backup: { load: async () => null, save() {}, clear: async () => { throw new Error('IndexedDB unavailable'); } },
  });
  await controller.start();
  controller.change({ comment: 'Подтверждено сервером' });
  const flushed = controller.flush(); await settle();
  requests[0].resolve(ack(requests[0].write));
  const confirmed = await flushed;
  assert.equal(confirmed.status, 'saved');
  assert.equal(confirmed.revision, 4);
  assert.equal(confirmed.form.comment, 'Подтверждено сервером');
  await controller.flush();
  assert.equal(requests.length, 1, 'a local cache error must not duplicate an acknowledged server write');
});

test('removing a file during its upload removes the returned server attachment in the next write', async t => {
  const { controller, requests } = setup(t);
  await controller.start();
  const file = new File(['remove me'], 'removed.png', { type: 'image/png' });
  controller.addFiles([file]);
  const key = controller.getSnapshot().files[0].key;
  const flushed = controller.flush(); await settle();
  controller.removeFile(key);
  requests[0].resolve(ack(requests[0].write, [attachment(131, 'removed.png')])); await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].write.remove_attachment_ids, [131]);
  assert.deepEqual(requests[1].files, []);
  assert.deepEqual(controller.getSnapshot().attachments, [], 'the removed file must not reappear after its upload finishes');
  assert.notEqual(controller.getSnapshot().status, 'saved');
  requests[1].resolve(ack(requests[1].write)); await flushed;
  assert.deepEqual(controller.getSnapshot().attachments, []);
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('removing a restored attachment during a write is not undone by the older acknowledgement', async t => {
  const original = [attachment(141, 'remove.png'), attachment(142, 'keep.png')];
  const { controller, requests } = setup(t, { load: async () => remote({ attachments: original }) });
  await controller.start();
  controller.change({ comment: 'Сохранить текст' });
  const flushed = controller.flush(); await settle();
  controller.removeAttachment(141);
  requests[0].resolve(ack(requests[0].write, original)); await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].write.remove_attachment_ids, [141]);
  assert.deepEqual(controller.getSnapshot().attachments.map(file => file.id), [142]);
  assert.notEqual(controller.getSnapshot().status, 'saved');
  requests[1].resolve(ack(requests[1].write, [original[1]])); await flushed;
  assert.deepEqual(controller.getSnapshot().attachments.map(file => file.id), [142]);
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('edits made while an older acknowledgement clears recovery remain recoverable until their own save', async t => {
  let stored = null;
  const clears = [];
  const { controller, requests } = setup(t, {
    backup: {
      load: async () => null,
      save(value) { stored = value; },
      clear() {
        const pending = deferred(); clears.push(pending);
        return pending.promise.then(() => { stored = null; });
      },
    },
  });
  await controller.start();
  controller.change({ comment: 'Первый текст' });
  const flushed = controller.flush(); await settle();
  requests[0].resolve(ack(requests[0].write)); await settle();
  assert.equal(clears.length, 1);
  const file = new File(['new pending file'], 'pending.png', { type: 'image/png' });
  controller.change({ comment: 'Новый текст во время очистки' });
  controller.addFiles([file]);
  assert.notEqual(controller.getSnapshot().status, 'saved');
  clears[0].resolve(); await settle();
  assert.equal(requests.length, 2);
  const recoveryDuringSecondWrite = stored;
  const statusDuringSecondWrite = controller.getSnapshot().status;
  requests[1].resolve(ack(requests[1].write, [attachment(151, 'pending.png')])); await settle();
  assert.equal(clears.length, 2);
  clears[1].resolve(); await flushed;
  assert.equal(recoveryDuringSecondWrite?.form.comment, 'Новый текст во время очистки');
  assert.deepEqual(recoveryDuringSecondWrite?.files.map(item => item.file), [file]);
  assert.notEqual(statusDuringSecondWrite, 'saved');
  assert.equal(controller.getSnapshot().status, 'saved');
});

test('late server loading merges recovered uploads with new typing and files without losing either', async t => {
  const loading = deferred();
  const recovered = new File(['old bytes'], 'old.png', { type: 'image/png' });
  const added = new File(['new bytes'], 'new.png', { type: 'image/png' });
  const { controller, requests } = setup(t, {
    load: () => loading.promise,
    backup: {
      load: async () => ({ form: { ...initial(), comment: 'Восстановленный комментарий' },
        draftKey: 'server-draft-41-crm-phone', revision: 3,
        files: [{ key: 'recovered', file: recovered }], removedAttachmentIds: [], removedAppealAttachmentIds: [] }),
      save() {}, clear() {},
    },
  });
  const started = controller.start();
  controller.change({ phone: '+77000000001' });
  controller.addFiles([added]);
  loading.resolve(remote()); await started;
  assert.equal(controller.getSnapshot().form.phone, '+77000000001');
  assert.equal(controller.getSnapshot().form.comment, 'Восстановленный комментарий');
  assert.deepEqual(controller.getSnapshot().files.map(item => item.file), [recovered, added]);
  const flushed = controller.flush(); await settle();
  assert.deepEqual(requests[0].files, [recovered, added]);
  requests[0].resolve(ack(requests[0].write, [attachment(161, 'old.png'), attachment(162, 'new.png')])); await flushed;
  assert.deepEqual(controller.getSnapshot().files, []);
  assert.equal(controller.getSnapshot().status, 'saved');
});
