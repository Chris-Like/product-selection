import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepositories, assertExtendedContract } from '../../app/store/index.js';
import { assertContract } from '../../app/core/repository/interface.js';

function makePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pick-store-'));
  return {
    root,
    data: path.join(root, 'data'),
    storeFile: path.join(root, 'data', 'store.json'),
    keyFile: path.join(root, 'data', '.key'),
    credFile: path.join(root, 'data', 'credentials.enc'),
    authDir: path.join(root, 'playwright', '.auth'),
    rulesDir: path.join(root, 'app', 'config', 'site-rules'),
    webDir: path.join(root, 'app', 'web'),
  };
}

test('原 9 个仓储契约 + 新形态 4 个扩展契约同时通过', async () => {
  const repos = await createRepositories(makePaths());
  assert.equal(assertContract(repos).ok, true);
  assert.equal(assertExtendedContract(repos).ok, true);
});

test('新增站点默认停用；条款未核验不能启用，核验后可启用', async () => {
  const repos = await createRepositories(makePaths());
  const r = await repos.SiteRepository.add({ site_id: 'taobao', name: '淘宝', host: 'taobao.com' });
  assert.equal(r.ok, true);
  assert.equal(r.data.enabled, false);
  const blocked = await repos.SiteRepository.update('taobao', { enabled: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /条款/);
  await repos.SiteRepository.update('taobao', { terms_checked: true });
  const enabled = await repos.SiteRepository.update('taobao', { enabled: true });
  assert.equal(enabled.ok, true);
  assert.equal((await repos.SiteRepository.enabled()).data.length, 1);
});

test('删除进可恢复区，恢复不改写站点标识', async () => {
  const repos = await createRepositories(makePaths());
  await repos.SiteRepository.add({ site_id: 's1', name: '一站', host: 'example.com' });
  const del = await repos.SiteRepository.softDelete('s1');
  assert.equal(del.ok, true);
  assert.equal((await repos.SiteRepository.list(false)).data.length, 0);
  const ops = (await repos.RecoverableRepository.list()).data;
  assert.equal(ops.some((o) => o.kind === 'site'), true);
  await repos.SiteRepository.restore('s1');
  assert.equal((await repos.SiteRepository.list(false)).data.length, 1);
});

test('D3=B′：无凭据仓储、不生成密码密文或主密钥，站点只存登录页地址', async () => {
  const paths = makePaths();
  const repos = await createRepositories(paths);
  assert.equal(repos.CredentialRepository, undefined);
  const r = await repos.SiteRepository.add({
    site_id: 's1', name: '一站', host: 'example.com',
    login_url: 'https://example.com/user/login', account_label: '本人账号',
  });
  assert.equal(r.data.login_url, 'https://example.com/user/login');
  assert.equal(Object.hasOwn(r.data, 'credential_ref'), false);
  assert.equal(fs.existsSync(paths.credFile), false);
  assert.equal(fs.existsSync(paths.keyFile), false);
});

test('未完成命令落盘、可列出、完成后移除', async () => {
  const repos = await createRepositories(makePaths());
  const c = { commandId: 'cmd:1', type: 'CAPTURE_RUN' };
  await repos.CommandLogRepository.pending(c);
  assert.equal((await repos.CommandLogRepository.listPending()).data.length, 1);
  assert.equal((await repos.CommandLogRepository.findDone('cmd:1')).data, null);
  await repos.CommandLogRepository.done('cmd:1', { ok: true });
  assert.equal((await repos.CommandLogRepository.findDone('cmd:1')).data.ok, true);
  await repos.CommandLogRepository.removePending('cmd:1');
  assert.equal((await repos.CommandLogRepository.listPending()).data.length, 0);
});

test('清空作用域排除可恢复区 / 回收区 / 命令区 / 设置', async () => {
  const repos = await createRepositories(makePaths());
  await repos.RecoverableRepository.put({ op_id: 'op:1', kind: 'undo', target_refs: [] });
  const keys = (await repos.AdminRepository.listBusinessKeys()).data;
  assert.equal(keys.some((k) => k.startsWith('recoverable:')), false);
  assert.equal(keys.some((k) => k.startsWith('trash:')), false);
  assert.equal(keys.some((k) => k.startsWith('cmd:')), false);
  assert.equal(keys.includes('settings'), false);
});

test('临时排序开关可显式复位（页面 load 语义）', async () => {
  const repos = await createRepositories(makePaths());
  await repos.SessionRepository.setTempSortOff(true);
  assert.equal(await repos.SessionRepository.getTempSortOff(), true);
  await repos.SessionRepository.setTempSortOff(false);
  assert.equal(await repos.SessionRepository.getTempSortOff(), false);
});
