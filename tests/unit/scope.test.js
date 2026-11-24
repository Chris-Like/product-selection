import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepositories } from '../../app/store/index.js';
import { createQueryService } from '../../app/core/service/query.service.js';

function makePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pick-scope-'));
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

const SNAPS = [
  { snapshot_id: 's1', batch_id: 'b1', record_status: 'stored', as_of: '2026-11-18T10:00:00Z', fingerprint_id: 'f1', title: '甲', price: 10 },
  { snapshot_id: 's2', batch_id: 'b1', record_status: 'stored', as_of: '2026-11-18T10:01:00Z', fingerprint_id: 'f2', title: '乙', price: 20 },
  { snapshot_id: 's3', batch_id: 'b2', record_status: 'stored', as_of: '2026-11-18T11:00:00Z', fingerprint_id: 'f3', title: '丙', price: 30 },
  { snapshot_id: 's4', batch_id: 'b2', record_status: 'undone', as_of: '2026-11-18T11:01:00Z', fingerprint_id: 'f4', title: '丁', price: 40 },
];

function stubQuery(snaps = SNAPS) {
  return createQueryService({
    snapshots: {
      listAll: async () => ({ ok: true, data: snaps }),
      findByBatch: async (id) => ({ ok: true, data: snaps.filter((s) => s.batch_id === id) }),
    },
    events: { listByFingerprint: async () => ({ ok: true, data: [] }) },
    settings: {
      get: async () => ({
        ok: true,
        data: { default_site: '淘宝', default_sort: 'lead_first', columns: [], sites_enabled: {} },
      }),
    },
    session: { getTempSortOff: async () => false },
    admin: {
      listBatches: async () => ({
        ok: true,
        data: [{ batch_id: 'b1', keywords: '手机壳', pages: 2 }, { batch_id: 'b2', keywords: null, pages: null }],
      }),
    },
  });
}

test('RunRepository：同一轮次 upsert 不新增第二条，latest 取最新', async () => {
  const repos = await createRepositories(makePaths());
  await repos.RunRepository.upsert({ batch_id: 'b1', state: 'running', stored: 0 });
  await repos.RunRepository.upsert({ batch_id: 'b1', state: 'done', stored: 2 });
  await repos.RunRepository.upsert({ batch_id: 'b2', state: 'not_started', stored: 0 });
  const list = (await repos.RunRepository.list()).data;
  assert.equal(list.length, 2);
  assert.equal(list[0].state, 'done');
  assert.equal(list[0].stored, 2);
  assert.equal((await repos.RunRepository.latest()).data.batch_id, 'b2');
  assert.equal((await repos.RunRepository.find('b1')).data.stored, 2);
  assert.equal((await repos.RunRepository.find('missing')).data, null);
});

test('清空作用域包含采集记录，且排除可恢复区与设置', async () => {
  const repos = await createRepositories(makePaths());
  await repos.RunRepository.upsert({ batch_id: 'b1', state: 'done', stored: 2 });
  await repos.RecoverableRepository.put({ op_id: 'op:1', kind: 'undo', target_refs: [] });
  const keys = (await repos.AdminRepository.listBusinessKeys()).data;
  assert.equal(keys.includes('run:b1'), true);
  assert.equal(keys.includes('idx:runs'), true);
  assert.equal(keys.some((k) => k.startsWith('recoverable:')), false);
  assert.equal(keys.includes('settings'), false);
});

test('按轮次过滤：只看本轮，declaration 说「本轮」，累计数字仍可见', async () => {
  const d = (await stubQuery().dashboard({ batchId: 'b1' })).data;
  assert.equal(d.rows.length, 2);
  assert.equal(d.viewScope, 'batch');
  assert.equal(d.activeBatchId, 'b1');
  assert.match(d.coverage.declaration, /本轮/);
  assert.doesNotMatch(d.coverage.declaration, /本次/);
  assert.equal(d.coverage.keywords, '手机壳');
  assert.equal(d.coverage.record_count, 2);
  assert.deepEqual(d.counts, { scope: 2, all: 3, latest: 1 });
});

test('明细筛选同时限定轮次、查询和预算分组，保留本轮总数', async () => {
  const query = stubQuery([
    { ...SNAPS[0], query_id: 'q:1', price: 50 },
    { ...SNAPS[1], query_id: 'q:1', price: 20, field_status: { price: '值异常' } },
    { ...SNAPS[0], snapshot_id: 'other-query', query_id: 'q:2', price: 40 },
    { ...SNAPS[2], query_id: 'q:1' },
  ]);
  const evidence = { batchId: 'b1', queryId: 'q:1', budgetGroup: 'at_or_below', ceiling: 50 };
  const included = (await query.dashboard({ batchId: 'b1', evidence })).data;
  assert.deepEqual(included.rows.map(({ snapshot }) => snapshot.snapshot_id), ['s1']);
  assert.equal(included.counts.scope, 3);
  const missing = (await query.dashboard({ batchId: 'b1', evidence: { ...evidence, budgetGroup: 'unavailable' } })).data;
  assert.deepEqual(missing.rows.map(({ snapshot }) => snapshot.snapshot_id), ['s2']);
  const otherRun = (await query.dashboard({ batchId: 'b2', evidence: { ...evidence, budgetGroup: 'above' } })).data;
  assert.deepEqual(otherRun.rows.map(({ snapshot }) => snapshot.snapshot_id), ['s3']);
});

test('最新一轮无数据：本轮计数为 0，累计仍可见', async () => {
  const d = (await stubQuery().dashboard({ batchId: 'b3', latestBatchId: 'b3' })).data;
  assert.equal(d.rows.length, 0);
  assert.equal(d.counts.latest, 0);
  assert.equal(d.counts.all, 3);
  assert.match(d.coverage.declaration, /本轮/);
});

test('全部累计：declaration 说「累计」，撤销记录不进入视图', async () => {
  const d = (await stubQuery().dashboard({ batchId: 'all' })).data;
  assert.equal(d.rows.length, 3);
  assert.equal(d.viewScope, 'all');
  assert.equal(d.activeBatchId, null);
  assert.match(d.coverage.declaration, /累计/);
  assert.equal(d.coverage.record_count, 3);
  assert.equal(d.counts.scope, 3);
  assert.equal(d.counts.all, 3);
});
