import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  storageStateExpired, loginRedirected, createAuthManager, readStorageState,
} from '../../app/collector/auth.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pick-auth-'));
}

function stubRepos(dir, initial = {}) {
  let meta = { status: 'unknown', ...initial };
  let site = { auth_status: 'unknown' };
  return {
    get status() { return meta.status; },
    AuthStateRepository: {
      pathFor: (id) => path.join(dir, `${id}.json`),
      exists: async () => fs.existsSync(path.join(dir, 'taobao.json')),
      meta: async () => ({ ok: true, data: { ...meta } }),
      setMeta: async (id, patch) => { meta = { ...meta, ...patch }; return { ok: true, data: meta }; },
    },
    SiteRepository: {
      update: async (id, patch) => { site = { ...site, ...patch }; return { ok: true, data: site }; },
    },
  };
}

function fakePlaywright() {
  const listeners = [];
  let n = 0;
  const context = {
    async newPage() {
      return {
        async goto() { return undefined; },
        url: () => 'https://www.example.com/list',
        locator: () => ({ count: async () => 0 }),
      };
    },
    async storageState() {
      const count = n === 0 ? 1 : 3; // 基线 1 条 → 登录后 3 条
      n += 1;
      return {
        cookies: Array.from({ length: count }, (_, i) => ({
          name: `c${i}`, value: 'v', domain: 'example.com', path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        })),
        origins: [],
      };
    },
  };
  const browser = {
    async newContext() { return context; },
    on(ev, fn) { if (ev === 'disconnected') listeners.push(fn); },
    async close() { for (const fn of listeners) fn(); },
  };
  return { pw: { chromium: { launch: async () => browser } }, browser };
}

test('cookie 全过期才判过期；会话 cookie / 部分未过期不误判', () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(storageStateExpired({ cookies: [{ expires: past }, { expires: past }] }), true);
  assert.equal(storageStateExpired({ cookies: [{ expires: past }, { expires: future }] }), false);
  assert.equal(storageStateExpired({ cookies: [{ expires: -1 }] }), false);
  assert.equal(storageStateExpired({ cookies: [] }), false);
  assert.equal(storageStateExpired(null), false);
});

test('登录跳转判定：跨 host / 通用登录路径 / 规则 URL 片段', () => {
  const entry = 'https://www.example.com/list';
  assert.equal(loginRedirected('https://login.example.com/', entry, {}), true);
  assert.equal(loginRedirected('https://www.example.com/login', entry, {}), true);
  assert.equal(loginRedirected('https://www.example.com/list', entry, {}), false);
  assert.equal(loginRedirected('https://www.example.com/member?from=login', entry,
    { login_required_hints: ['from=login'] }), true);
});

test('未建立登录态 → AUTH_REQUIRED，不启动浏览器', async () => {
  const repos = stubRepos(tmpDir());
  const auth = createAuthManager({ repos });
  const r = await auth.requireValid('taobao');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTH_REQUIRED');
  assert.match(r.hint, /配置/);
});

test('本机 storageState 全过期 → AUTH_EXPIRED 且状态落为 expired', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'taobao.json'), JSON.stringify({
    cookies: [{ name: 'sid', value: 'x', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) - 60 }],
    origins: [],
  }));
  const repos = stubRepos(dir, { status: 'valid' });
  const auth = createAuthManager({ repos });
  const r = await auth.requireValid('taobao');
  assert.equal(r.code, 'AUTH_EXPIRED');
  assert.equal(repos.status, 'expired');
});

test('点登录 → 本人登录产生新 cookies → 关窗自动保存，全程不录密码', async () => {
  const dir = tmpDir();
  const repos = stubRepos(dir);
  const { pw, browser } = fakePlaywright();
  const auth = createAuthManager({ repos, snapshotIntervalMs: 20 });
  const r = await auth.beginLogin('taobao', { playwright: pw, url: 'https://www.example.com/', intervalMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(repos.status, 'logging_in');
  await new Promise((res) => setTimeout(res, 90)); // 等待定时快照
  await browser.close();
  await new Promise((res) => setTimeout(res, 50)); // 等待断开回调落盘
  assert.equal(repos.status, 'valid');
  assert.equal(fs.existsSync(path.join(dir, 'taobao.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'taobao.json.pending')), false);
  const state = await readStorageState(path.join(dir, 'taobao.json'));
  assert.equal(state.cookies.length, 3);
});

test('取消登录丢弃本次快照，不覆盖已有的有效登录态', async () => {
  const dir = tmpDir();
  const target = path.join(dir, 'taobao.json');
  fs.writeFileSync(target, JSON.stringify({
    cookies: [{ name: 'old', value: 'v', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 }],
    origins: [],
  }));
  const repos = stubRepos(dir, { status: 'valid' });
  const { pw } = fakePlaywright();
  const auth = createAuthManager({ repos, snapshotIntervalMs: 20 });
  assert.equal((await auth.beginLogin('taobao', { playwright: pw, url: 'https://www.example.com/', intervalMs: 20 })).ok, true);
  await new Promise((res) => setTimeout(res, 60));
  await auth.cancelLogin('taobao');
  assert.equal(repos.status, 'valid');
  const state = await readStorageState(target);
  assert.equal(state.cookies[0].name, 'old');
  assert.equal(fs.existsSync(`${target}.pending`), false);
});
