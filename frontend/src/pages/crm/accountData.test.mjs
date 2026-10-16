import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./accountData.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { copyKind, fieldMatch, linkMatch } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const account = { id: '0f3c9a7e5b2d4c6e8a1b3d5f7e9c2a4b', phone: '+77014829154', license: 'KA482915' };
const link = `https://fleet.yandex.kz/contractors/${account.id}/details?park_id=7ad2&lang=ru`;

test('what was copied is recognised against the account, however it is written', () => {
  for (const phone of ['+77014829154', '87014829154', '+7 701 482 9154', ' 7014829154 ']) assert.equal(copyKind(phone, [account]), 'phone', phone);
  for (const license of ['KA482915', 'ka 482915']) assert.equal(copyKind(license, [account]), 'license', license);
  assert.equal(copyKind(account.id.toUpperCase(), [account]), 'id');
  assert.equal(copyKind(link, [account]), 'link');
  // Another driver's data, a part of a number or nothing at all is no copy of this account.
  for (const other of ['+77057314482', '482915', 'MV305117', '', 'Жумабаев']) assert.equal(copyKind(other, [account]), '', other);
});

test('the appeal fields say whether they hold the account data', () => {
  assert.equal(fieldMatch('phone', '87014829154', [account]), 'true');
  assert.equal(fieldMatch('phone', '+77057314482', [account]), 'false');
  assert.equal(fieldMatch('license_number', 'ka482915 ', [account]), 'true');
  assert.equal(fieldMatch('license_number', 'KA48291', [account]), 'false');
  assert.equal(fieldMatch('driver_id', ` ${account.id} `, [account]), 'true');
  // The whole link pasted into «ID водителя» is told apart from a wrong ID.
  assert.equal(fieldMatch('driver_id', link, [account]), 'link');
  assert.equal(fieldMatch('driver_id', 'abc', [account]), 'false');
  // An empty field, or no account to compare with, says nothing.
  assert.equal(fieldMatch('phone', '  ', [account]), '');
  assert.equal(fieldMatch('phone', '87014829154', []), '');
});

test('a request comment counts once it carries the account link', () => {
  assert.equal(linkMatch(`Прошу снять лимит. ${link}`, [account]), 'ok');
  assert.equal(linkMatch('Прошу снять лимит', [account]), 'missing');
  assert.equal(linkMatch('', [account]), '');
  assert.equal(linkMatch(link, []), '');
});

test('the link counts as the server counts it: the account in its park, written any usual way', () => {
  const parked = { ...account, park: '7ad2' };
  for (const ok of [link, link.replace('/details', ''), link.replace('https://', ''), link.replace('https', 'http'), `(${link.split('&lang')[0]}).`])
    assert.equal(linkMatch(`Прошу снять лимит. ${ok}`, [parked]), 'ok', ok);
  // The ID alone, a link without the park or to another park or account is no link to it.
  for (const bad of [`аккаунт ${account.id}`, link.split('?')[0], link.replace('7ad2', '9999'), link.replace(account.id, 'abc')])
    assert.equal(linkMatch(`Прошу снять лимит. ${bad}`, [parked]), 'missing', bad);
});

test('without a call the test driver and the open account both count', () => {
  const open = { id: '9a8b7c6d5e4f30211203f4e5d6c7b8a9', phone: '+77057314482', license: 'MV305117' };
  const both = [account, open];
  assert.equal(fieldMatch('phone', '+77057314482', both), 'true');
  assert.equal(fieldMatch('license_number', 'KA482915', both), 'true');
  assert.equal(fieldMatch('phone', '+77000000000', both), 'false');
  assert.equal(copyKind(open.id, both), 'id');
  assert.equal(linkMatch(`https://fleet.yandex.kz/contractors/${open.id}/details`, both), 'ok');
});
