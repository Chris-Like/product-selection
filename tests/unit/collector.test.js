import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPageKind, extractFields } from '../../app/collector/extract.js';
import { loadPlaywright } from '../../app/collector/driver.js';
import { createCollector } from '../../app/collector/run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stubRepos(sites) {
  const runs = [];
  return {
    runs,
    SiteRepository: {
      enabled: async () => ({ ok: true, data: sites }),
      update: async () => ({ ok: true, data: {} }),
    },
    TaskRepository: {
      set: async () => ({ ok: true }),
      patch: async () => ({ ok: true }),
      get: async () => ({ ok: true, data: {} }),
    },
    RuleRepository: { get: async () => ({ ok: false }) },
    AuthStateRepository: {
      pathFor: (id) => `/tmp/${id}.json`,
      exists: async () => false,
      meta: async () => ({ ok: true, data: {} }),
      setMeta: async () => ({ ok: true }),
    },
    RunRepository: {
      upsert: async (record) => {
        const i = runs.findIndex((r) => r.batch_id === record.batch_id);
        if (i >= 0) runs[i] = { ...runs[i], ...record };
        else runs.push({ ...record });
        return { ok: true, data: record.batch_id };
      },
      list: async () => ({ ok: true, data: runs }),
      latest: async () => ({ ok: true, data: runs[runs.length - 1] || null }),
      find: async (id) => ({ ok: true, data: runs.find((r) => r.batch_id === id) || null }),
    },
  };
}

test('规则未回填 URL 模式 → UNSUPPORTED 且标记 rulePending', () => {
  const r = detectPageKind('https://taobao.com/item.htm?id=1', { field_selector_map: {} });
  assert.equal(r.pageKind, 'UNSUPPORTED');
  assert.equal(r.rulePending, true);
});

test('URL 模式来自规则配置，命中才识别页面类型', () => {
  const rule = { url_patterns: { 'PG-1': ['item\\.htm'], 'PG-2': ['s\\.taobao\\.com'] } };
  assert.equal(detectPageKind('https://item.taobao.com/item.htm?id=1', rule).pageKind, 'PG-1');
  assert.equal(detectPageKind('https://s.taobao.com/search?q=x', rule).pageKind, 'PG-2');
  assert.equal(detectPageKind('https://example.com/', rule).pageKind, 'UNSUPPORTED');
});

test('语义锚点为空 → 抽取返回 rulePending，不落库', async () => {
  const fakePage = { locator: () => ({ count: async () => 0, all: async () => [] }) };
  const r = await extractFields(fakePage, { field_selector_map: { 'PG-1': { title: '.t' } }, anchor_selectors: {} }, 'PG-1');
  assert.equal(r.rulePending, true);
  assert.deepEqual(r.items, []);
});

test('没有启用站点 → NO_ENABLED_SITE，不启动浏览器', async () => {
  const collector = createCollector({ repos: stubRepos([]), services: {}, paths: { root: ROOT } });
  const r = await collector.run({});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_ENABLED_SITE');
  assert.ok(r.hint && r.hint.length > 0);
});

test('每点一次采集生成一条记录；无启用站点也留痕', async () => {
  const repos = stubRepos([]);
  const collector = createCollector({ repos, services: {}, paths: { root: ROOT } });
  const r = await collector.run({});
  assert.equal(r.ok, false);
  assert.equal(repos.runs.length, 1);
  assert.equal(repos.runs[0].state, 'not_started');
  assert.ok(repos.runs[0].batch_id);
  assert.match(repos.runs[0].message, /站点/);
});

test('Playwright 未安装 → 明确降级，不静默失败', async () => {
  const pw = await loadPlaywright();
  if (pw) return; // 环境已安装时跳过本断言，避免真启动浏览器
  const collector = createCollector({
    repos: stubRepos([{ site_id: 'taobao', name: '淘宝' }]),
    services: {},
    paths: { root: ROOT },
  });
  const r = await collector.run({});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PLAYWRIGHT_MISSING');
});
