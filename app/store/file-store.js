/**
 * 本机文件仓储：唯一持久化调用点（零第三方依赖）。
 * 分键沿用 MV3 版键空间，未完成命令 / 可恢复区 / 清空作用域语义原样保留；
 * 只把浏览器扩展存储换成本机 JSON 文件 + 原子 rename + 串行写锁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, err } from '../core/shared/result.js';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, RECORD_STATUS } from '../core/shared/types.js';
import { configureAllowedHosts } from '../core/shared/guard.js';

const K = {
  snap: (batch, id) => `snap:${batch}:${id}`,
  refSnap: (id) => `ref:snap:${id}`,
  idxBatch: (batch) => `idx:batch:${batch}`,
  idxFp: (fp) => `idx:fp:${fp}`,
  batch: (batch) => `batch:${batch}`,
  idxBatches: 'idx:batches',
  event: (fp, id) => `event:${fp}:${id}`,
  idxEvent: (fp) => `idx:event:${fp}`,
  recoverable: (id) => `recoverable:${id}`,
  idxRecoverable: 'idx:recoverable',
  trash: (id) => `trash:${id}`,
  pending: (id) => `cmd:pending:${id}`,
  done: (id) => `cmd:done:${id}`,
  idxPending: 'idx:pending',
  rule: (site, version) => `rule:${site}:${version}`,
  run: (id) => `run:${id}`,
  idxRuns: 'idx:runs',
  settings: 'settings',
  page: (pageId) => `page:${pageId}`,
  tempSort: 'temp_sort_off',
};

function emptyDb() {
  return {
    schemaVersion: 2,
    kv: {},
    sites: [],
    auth: {},
    task: { state: 'idle', sites: [], started_at: null, ended_at: null, message: '' },
  };
}

function safeId(siteId) {
  return String(siteId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * @param {{storeFile: string, data: string, authDir: string, rulesDir: string}} paths
 */
export function createFileStore({ paths }) {
  let db = emptyDb();
  let writeChain = Promise.resolve();

  function syncHosts() {
    configureAllowedHosts(db.sites.filter((s) => !s.deleted_at && s.enabled).map((s) => s.host).filter(Boolean));
  }

  async function ready() {
    await fs.promises.mkdir(paths.data, { recursive: true });
    await fs.promises.mkdir(paths.authDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.promises.readFile(paths.storeFile, 'utf8'));
      db = { ...emptyDb(), ...parsed };
    } catch {
      db = emptyDb();
    }
    db.kv ||= {};
    db.sites ||= [];
    db.auth ||= {};
    db.task ||= emptyDb().task;
    db.schemaVersion = 2;
    // D3=B′ 迁移：旧版可能残留 credential_ref，只清理该废弃字段，不再产生任何密码字段
    let purged = false;
    for (const s of db.sites) {
      if (Object.hasOwn(s, 'credential_ref')) { delete s.credential_ref; purged = true; }
    }
    if (purged) await persist();
    syncHosts();
    return db;
  }

  function persist() {
    syncHosts();
    writeChain = writeChain.then(async () => {
      const tmp = `${paths.storeFile}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
      await fs.promises.rename(tmp, paths.storeFile);
    });
    return writeChain;
  }

  const get = async (key) => db.kv[key];
  const set = async (key, value) => { db.kv[key] = value; await persist(); };
  const getMany = async (keys) => Object.fromEntries(keys.map((k) => [k, db.kv[k]]).filter(([, v]) => v !== undefined));
  const remove = async (keys) => { for (const k of keys) delete db.kv[k]; await persist(); };
  const appendIdx = async (key, value) => {
    const list = db.kv[key] || [];
    if (list.includes(value)) return list;
    const next = [...list, value];
    await set(key, next);
    return next;
  };

  const SnapshotRepository = {
    async append(s) {
      const key = K.snap(s.batch_id, s.snapshot_id);
      await set(key, s);
      await set(K.refSnap(s.snapshot_id), { batch_id: s.batch_id });
      await appendIdx(K.idxBatch(s.batch_id), key);
      if (s.fingerprint_id) await appendIdx(K.idxFp(s.fingerprint_id), key);
      return ok(s.snapshot_id);
    },
    async findByBatch(batchId) {
      const keys = db.kv[K.idxBatch(batchId)] || [];
      return ok(keys.map((k) => db.kv[k]).filter(Boolean));
    },
    async findByFingerprint(fpId) {
      const keys = db.kv[K.idxFp(fpId)] || [];
      return ok(keys.map((k) => db.kv[k]).filter(Boolean));
    },
    async listAll() {
      const batches = db.kv[K.idxBatches] || [];
      const idxKeys = batches.map((b) => K.idxBatch(b));
      const keys = [...new Set(idxKeys.flatMap((k) => db.kv[k] || []))];
      return ok(keys.map((k) => db.kv[k]).filter(Boolean));
    },
    async markStatus(id, status) {
      const ref = db.kv[K.refSnap(id)];
      if (!ref) return err('STORAGE_FAILED', '找不到这条记录', '刷新结果区后再试');
      const key = K.snap(ref.batch_id, id);
      const s = db.kv[key];
      if (!s) return err('STORAGE_FAILED', '找不到这条记录', '刷新结果区后再试');
      await set(key, { ...s, record_status: status });
      return ok();
    },
    async softDelete(id) { return this.markStatus(id, RECORD_STATUS.UNDONE); },
    async updateField(id, field, value, status) {
      const ref = db.kv[K.refSnap(id)];
      if (!ref) return err('STORAGE_FAILED', '找不到这条记录', '刷新结果区后再试');
      const key = K.snap(ref.batch_id, id);
      const s = db.kv[key];
      if (!s) return err('STORAGE_FAILED', '找不到这条记录', '刷新结果区后再试');
      await set(key, { ...s, [field]: value, field_status: { ...(s.field_status || {}), [field]: status } });
      return ok();
    },
  };

  const EventRepository = {
    async append(e) {
      const key = K.event(e.fingerprint_id, e.event_id);
      await set(key, e);
      await appendIdx(K.idxEvent(e.fingerprint_id), key);
      return ok(e.event_id);
    },
    async listByFingerprint(fpId) {
      const keys = db.kv[K.idxEvent(fpId)] || [];
      return ok(keys.map((k) => db.kv[k]).filter(Boolean));
    },
  };

  const RuleRepository = {
    async get(site, version = 'v1') {
      const key = K.rule(site, version);
      // 站点规则文件是唯一事实源。B0 回填后必须立即生效，不能让首次启动写入的
      // 本机缓存把旧规则钉死；缓存只在文件缺失时兜底，且内容变化才回写一次。
      try {
        const file = path.join(paths.rulesDir, `${safeId(site)}.json`);
        const rule = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        if (!db.kv[key] || JSON.stringify(db.kv[key]) !== JSON.stringify(rule)) {
          await set(key, rule);
        }
        return ok(rule);
      } catch {
        if (db.kv[key]) return ok(db.kv[key]);
        return err('RULE_MISSING', '站点规则还没载入', '照常使用即可；规则由本机站点规则文件提供，B0 实测后回填');
      }
    },
    async put(rule) { await set(K.rule(rule.site, rule.version || 'v1'), rule); return ok(); },
  };

  const SettingsRepository = {
    async get() {
      const s = db.kv[K.settings];
      if (!s) { await set(K.settings, { ...DEFAULT_SETTINGS }); return ok({ ...DEFAULT_SETTINGS }); }
      if (s.schema_version !== SCHEMA_VERSION) {
        const migrated = { ...DEFAULT_SETTINGS, ...s, schema_version: SCHEMA_VERSION };
        await set(K.settings, migrated);
        return ok(migrated);
      }
      return ok(s);
    },
    async patch(patch) {
      const cur = (await this.get()).data;
      await set(K.settings, { ...cur, ...patch });
      return ok();
    },
  };

  /** 新形态：临时排序开关由页面 load 显式复位，不再依赖 storage.session / worker 广播。 */
  const SessionRepository = {
    async getTempSortOff() { return Boolean(db.kv[K.tempSort]); },
    async setTempSortOff(v) { await set(K.tempSort, Boolean(v)); return ok(); },
  };

  const RecoverableRepository = {
    async put(op) {
      await set(K.recoverable(op.op_id), op);
      await appendIdx(K.idxRecoverable, op.op_id);
      return ok(op.op_id);
    },
    async list() {
      const ids = db.kv[K.idxRecoverable] || [];
      return ok(ids.map((id) => db.kv[K.recoverable(id)]).filter(Boolean));
    },
    async latest() {
      const list = (await this.list()).data;
      return ok(list.length ? list[list.length - 1] : null);
    },
    async markRestored(opId) {
      const op = db.kv[K.recoverable(opId)];
      if (!op) return err('STORAGE_FAILED', '找不到可恢复项', '刷新结果区后再试');
      await set(K.recoverable(opId), { ...op, restored_at: new Date().toISOString() });
      return ok();
    },
  };

  const CommandLogRepository = {
    async pending(c) {
      await set(K.pending(c.commandId), c);
      await appendIdx(K.idxPending, c.commandId);
      return ok();
    },
    async done(commandId, result) { await set(K.done(commandId), result); return ok(); },
    async findDone(commandId) { return ok(db.kv[K.done(commandId)] || null); },
    async listPending() {
      const ids = db.kv[K.idxPending] || [];
      return ok(ids.map((id) => db.kv[K.pending(id)]).filter(Boolean));
    },
    async removePending(commandId) {
      await remove([K.pending(commandId)]);
      const ids = db.kv[K.idxPending] || [];
      await set(K.idxPending, ids.filter((id) => id !== commandId));
      return ok();
    },
  };

  const AdminRepository = {
    async ensureBatch(batchId, meta) {
      const key = K.batch(batchId);
      if (!db.kv[key]) await set(key, { batch_id: batchId, ...meta });
      await appendIdx(K.idxBatches, batchId);
      return ok();
    },
    async listBatches() {
      const ids = db.kv[K.idxBatches] || [];
      return ok(ids.map((id) => db.kv[K.batch(id)]).filter(Boolean));
    },
    async listBusinessKeys() {
      const batches = db.kv[K.idxBatches] || [];
      const runIds = db.kv[K.idxRuns] || [];
      const idxKeys = batches.map((b) => K.idxBatch(b));
      const snapKeys = [...new Set(idxKeys.flatMap((k) => db.kv[k] || []))];
      const snapshots = snapKeys.map((k) => db.kv[k]).filter(Boolean);
      const fpIds = [...new Set(snapshots.map((s) => s.fingerprint_id).filter(Boolean))];
      const eventIdxKeys = fpIds.map((fp) => K.idxEvent(fp));
      const eventKeys = [...new Set(eventIdxKeys.flatMap((k) => db.kv[k] || []))];
      return ok([...new Set([
        ...batches.map((b) => K.batch(b)),
        ...idxKeys, ...snapKeys,
        ...snapshots.map((s) => K.refSnap(s.snapshot_id)),
        ...fpIds.map((fp) => K.idxFp(fp)),
        ...eventIdxKeys, ...eventKeys,
        ...runIds.map((r) => K.run(r)),
        K.idxRuns,
        K.idxBatches,
      ])]);
    },
    async moveToTrash(clearId, keys) {
      const bag = await getMany(keys);
      await set(K.trash(clearId), { keys, bag, created_at: new Date().toISOString() });
      await remove(keys);
      return ok();
    },
    async restoreFromTrash(clearId) {
      const t = db.kv[K.trash(clearId)];
      if (!t) return err('STORAGE_FAILED', '找不到本次清空的备份', '刷新结果区后再试');
      for (const [key, value] of Object.entries(t.bag || {})) db.kv[key] = value;
      delete db.kv[K.trash(clearId)];
      await persist();
      return ok();
    },
    async getPageState(pageId) { return ok(db.kv[K.page(pageId)] || null); },
    async setPageState(pageId, state) { await set(K.page(pageId), state); return ok(); },
  };

  const SiteRepository = {
    async list(includeDeleted = false) {
      return ok(db.sites.filter((s) => includeDeleted || !s.deleted_at).map((s) => ({ ...s })));
    },
    async get(siteId) {
      const s = db.sites.find((x) => x.site_id === siteId);
      return s ? ok({ ...s }) : err('STORAGE_FAILED', '找不到这个站点', '刷新配置区后再试');
    },
    async enabled() {
      return ok(db.sites.filter((s) => !s.deleted_at && s.enabled).map((s) => ({ ...s })));
    },
    async add(input) {
      if (!input || !input.site_id || !input.host) {
        return err('STORAGE_FAILED', '站点标识和域名不能为空', '填写站点标识与域名后再保存');
      }
      if (db.sites.some((s) => s.site_id === input.site_id && !s.deleted_at)) {
        return err('STORAGE_FAILED', '这个站点已经存在', '换个标识，或直接编辑已有站点');
      }
      const site = {
        site_id: input.site_id,
        name: input.name || input.site_id,
        host: input.host,
        enabled: false,
        account_label: input.account_label || '',
        auth_state_path: null,
        auth_status: 'unknown',
        login_url: input.login_url || '',
        rule_version: 'v1',
        terms_checked: Boolean(input.terms_checked),
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
      db.sites.push(site);
      await persist();
      return ok({ ...site });
    },
    async update(siteId, patch) {
      const s = db.sites.find((x) => x.site_id === siteId);
      if (!s) return err('STORAGE_FAILED', '找不到这个站点', '刷新配置区后再试');
      if (patch.enabled === true && !(s.terms_checked || patch.terms_checked)) {
        return err('RULE_MISSING', '这个站点的条款还没核验', '先在配置区勾选「已核验条款」，再启用');
      }
      Object.assign(s, patch, { site_id: s.site_id });
      await persist();
      return ok({ ...s });
    },
    async softDelete(siteId) {
      const s = db.sites.find((x) => x.site_id === siteId);
      if (!s) return err('STORAGE_FAILED', '找不到这个站点', '刷新配置区后再试');
      const opId = `site:${siteId}:${Date.now()}`;
      await RecoverableRepository.put({ op_id: opId, kind: 'site', site_id: siteId, created_at: new Date().toISOString() });
      s.deleted_at = new Date().toISOString();
      s.enabled = false;
      await persist();
      return ok(opId);
    },
    async restore(siteId) {
      const s = db.sites.find((x) => x.site_id === siteId);
      if (!s) return err('STORAGE_FAILED', '找不到这个站点', '刷新配置区后再试');
      s.deleted_at = null;
      await persist();
      return ok(siteId);
    },
  };

  /** 登录态文件本身由 Playwright 读写；这里只存状态元数据，不存 cookies。 */
  const AuthStateRepository = {
    pathFor(siteId) { return path.join(paths.authDir, `${safeId(siteId)}.json`); },
    async exists(siteId) {
      try { await fs.promises.access(this.pathFor(siteId)); return true; } catch { return false; }
    },
    async meta(siteId) { return ok(db.auth[siteId] || { status: 'unknown' }); },
    async setMeta(siteId, patch) {
      db.auth[siteId] = { ...(db.auth[siteId] || {}), ...patch, updated_at: new Date().toISOString() };
      await persist();
      return ok(db.auth[siteId]);
    },
  };

  const TaskRepository = {
    async get() { return ok({ ...(db.task || emptyDb().task) }); },
    async set(task) { db.task = { ...(db.task || {}), ...task }; await persist(); return ok(db.task); },
    async patch(patch) { return this.set(patch); },
  };

  /** 每点一次「采集」生成一条记录；同一轮次用 upsert 更新，不新增第二条。 */
  const RunRepository = {
    async upsert(record) {
      const id = record.batch_id;
      if (!id) return err('STORAGE_FAILED', '缺少轮次标识', '重新点一次「采集」');
      const prev = db.kv[K.run(id)] || {};
      await appendIdx(K.idxRuns, id);
      await set(K.run(id), { ...prev, ...record, batch_id: id });
      return ok(id);
    },
    async list() {
      const ids = db.kv[K.idxRuns] || [];
      return ok(ids.map((id) => db.kv[K.run(id)]).filter(Boolean));
    },
    async latest() {
      const list = (await this.list()).data;
      return ok(list.length ? list[list.length - 1] : null);
    },
    async find(id) { return ok(db.kv[K.run(id)] || null); },
  };

  const AnalysisRepository = {
    async get(key) { return ok(db.kv[`analysis:${key}`] || null); },
    async set(key, value) { await set(`analysis:${key}`, value); return ok(value); },
    async list(prefix = '') {
      const full = `analysis:${prefix}`;
      return ok(Object.entries(db.kv).filter(([key]) => key.startsWith(full))
        .map(([key, value]) => ({ key: key.slice('analysis:'.length), value })));
    },
  };

  const repos = {
    SnapshotRepository, EventRepository, RuleRepository, SettingsRepository,
    SessionRepository, RecoverableRepository, CommandLogRepository, AdminRepository,
    SiteRepository, AuthStateRepository, TaskRepository, RunRepository, AnalysisRepository,
  };

  return Object.freeze({ ...repos, ready, flush: () => writeChain, raw: () => db });
}
