/** 看板只读查询：视图不直连持久层，全部经本服务组装。 */
import { ok } from '../shared/result.js';
import { project } from '../domain/decision/projection.js';
import { budgetGroup, comparableDisplayPrice } from '../domain/snapshot/display-price.js';

export function createQueryService({ snapshots, events, settings, session, admin }) {
  async function dashboard(filters = {}) {
    const cfg = (await settings.get()).data;
    const tempOff = await session.getTempSortOff();
    const every = (await snapshots.listAll()).data || [];
    const batches = (await admin.listBatches()).data || [];
    const requested = filters.batchId && filters.batchId !== 'all' ? filters.batchId : null;
    const scoped = requested ? ((await snapshots.findByBatch(requested)).data || []) : every;

    const rows = [];
    for (const s of scoped) {
      if (s.record_status === 'cleared' || s.record_status === 'undone') continue;
      const fpId = s.fingerprint_id || `nofp:${s.snapshot_id}`;
      const evts = fpId.startsWith('nofp:') ? [] : ((await events.listByFingerprint(fpId)).data || []);
      const p = project(evts);
      rows.push({
        snapshot: s,
        fingerprintId: fpId,
        projection: p,
        ignoredFields: evts.filter((e) => e.kind === 'ignore').map((e) => e.payload.field),
      });
    }

    let view = rows;
    const evidence = filters.evidence?.batchId === requested ? filters.evidence : null;
    if (evidence) {
      view = view.filter(({ snapshot }) => snapshot.record_status === 'stored' &&
        (!evidence.queryId || snapshot.query_id === evidence.queryId) &&
        (!evidence.budgetGroup || budgetGroup(comparableDisplayPrice(snapshot), evidence.ceiling) === evidence.budgetGroup));
    }
    if (filters.onlyLead) view = view.filter((r) => r.projection.is_lead_marker);
    if (filters.counterView) view = view.filter((r) => !r.projection.is_lead_marker);
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      view = view.filter((r) => String(r.snapshot.title || '').toLowerCase().includes(q));
    }
    const byTime = (a, b) => String(b.snapshot.as_of).localeCompare(String(a.snapshot.as_of));
    if (!tempOff && cfg.default_sort === 'lead_first') {
      view.sort((a, b) => Number(b.projection.is_lead_marker) - Number(a.projection.is_lead_marker) || byTime(a, b));
    } else {
      view.sort(byTime);
    }

    const storedOf = (list) => list.filter((s) => s.record_status === 'stored').length;
    const latestBatchId = filters.latestBatchId || (batches.length ? batches[batches.length - 1].batch_id : null);
    const times = scoped.map((s) => s.as_of).filter(Boolean).sort();
    const activeBatch = requested ? batches.find((b) => b.batch_id === requested) : null;
    const coverage = {
      site: cfg.default_site || '淘宝',
      keywords: activeBatch?.keywords ?? '未知',
      pages: activeBatch?.pages ?? '未知',
      time_span: times.length ? [times[0], times[times.length - 1]] : null,
      record_count: storedOf(scoped),
      declaration: requested
        ? '这是本轮便利样本，不是全候选池'
        : '这是累计便利样本，不是全候选池',
    };

    return ok({
      rows: view,
      total: rows.length,
      coverage,
      viewScope: requested ? 'batch' : 'all',
      activeBatchId: requested,
      batchCount: batches.length,
      counts: {
        scope: storedOf(scoped),
        all: storedOf(every),
        latest: latestBatchId ? storedOf(every.filter((s) => s.batch_id === latestBatchId)) : 0,
      },
      sortBasis: tempOff ? '临时关闭优先：按采集时间原序' : '领先标的优先',
      tempSortOff: tempOff,
      sitesEnabled: cfg.sites_enabled,
      columns: cfg.columns,
      m2Placeholders: ['断采态', '快照历史 / 多期对比', 'DE-02 突变提示', 'DE-16 校准视图'],
    });
  }

  async function popupState(tabId) {
    const cfg = (await settings.get()).data;
    const page = (await admin.getPageState(tabId)).data;
    return ok({ page, sitesEnabled: cfg.sites_enabled, defaultSort: cfg.default_sort });
  }

  return Object.freeze({ dashboard, popupState });
}
