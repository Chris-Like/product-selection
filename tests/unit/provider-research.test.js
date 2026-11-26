import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createProviderResearch } from '../../app/core/service/provider-research.js';
import { createRouter } from '../../app/server/router.js';
import { ok } from '../../app/core/shared/result.js';

test('两种宿主数据通过受保护的桥接入库，与网页写入口隔离', async () => {
  const data = new Map();
  const research = createProviderResearch({
    set: async (key, value) => { data.set(key, value); },
    list: async (prefix) => ok([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }))),
  });
  const commands = [];
  const router = createRouter({
    sessionToken: 'test-web', agentToken: 'test-host', paths: {},
    runtime: {
      providerReports: research.list,
      submit: (command) => { commands.push(command); return research.save(command.report); },
    },
  });
  async function call(method, url, headers, body) {
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { method, url, headers });
    let status;
    let value;
    await router(req, { writeHead: (code) => { status = code; }, end: (json) => { value = JSON.parse(json); } });
    return { status, value };
  }
  const report = {
    provider: 'fastmoss', platform: 'tiktok_shop', market: 'US', query: 'stationery',
    tool: 'fixture_product_search', window: '2026-11-01 至 2026-11-07', extra: 'not stored',
    items: [{ id: 'demo-1', title: '测试笔记本', price: 20, currency: 'USD', units_sold: 0 }],
  };
  const agent = { 'x-auto-pick-agent-token': 'test-host' };
  const web = { 'x-auto-pick-token': 'test-web' };
  const bridge = '/api/agent-bridge/provider-research';
  assert.equal((await call('POST', bridge, web, report)).status, 403);
  assert.equal((await call('POST', '/api/command', web, { type: 'PROVIDER_RESEARCH_SAVE', report })).status, 404);
  assert.equal((await call('POST', bridge, agent, { ...report, platform: 'amazon' })).value.ok, false);
  assert.equal((await call('POST', bridge, agent, report)).value.ok, true);
  assert.equal((await call('POST', bridge, agent, { ...report, provider: 'linkfox', platform: '1688', market: 'CN' })).value.ok, true);
  assert.equal(commands[1].report.extra, undefined);
  const results = (await call('GET', '/api/provider-research', {})).value.data;
  assert.deepEqual(new Set(results.map((item) => item.provider)), new Set(['fastmoss', 'linkfox']));
  assert.equal(results.find((item) => item.provider === 'fastmoss').items[0].units_sold, 0);
  assert.equal(results.every((item) => item.origin === 'host_supplied'), true);
});
