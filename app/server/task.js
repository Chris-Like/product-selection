/**
 * 单一任务入口：页面按钮与 Agent Skill 脚本都经 submit() 进命令总线。
 * 服务启动时重放未完成命令（MV3 的「worker 重启重放」在新形态下的触发点改写）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ok, err } from '../core/shared/result.js';
import { createCommandBus } from '../core/service/command-bus.js';
import { createCaptureService } from '../core/service/capture.service.js';
import { createQueryService } from '../core/service/query.service.js';
import { createMarkerService } from '../core/service/marker.service.js';
import { createDecisionService } from '../core/service/decision.service.js';
import { createRecoveryService } from '../core/service/recovery.service.js';
import { createAnalysisService } from '../core/service/analysis.service.js';
import { createProviderResearch, providerReportInput } from '../core/service/provider-research.js';
import { createAssistantHost } from './assistant-host.js';
import { createTaobaoAlliance } from './taobao-alliance.js';
import { retailCsvItems } from '../core/service/retail-csv.js';
import { createCollector } from '../collector/run.js';
import { loadPlaywright, browserUsable } from '../collector/driver.js';
import { failure } from '../core/shared/errors.js';

export async function createTaskRuntime({ repos, paths }) {
  const common = {
    snapshots: repos.SnapshotRepository,
    events: repos.EventRepository,
    settings: repos.SettingsRepository,
    session: repos.SessionRepository,
    admin: repos.AdminRepository,
    recoverable: repos.RecoverableRepository,
    rules: repos.RuleRepository,
  };
  const services = {
    capture: createCaptureService(common),
    query: createQueryService(common),
    marker: createMarkerService(common),
    decision: createDecisionService(common),
    recovery: createRecoveryService(common),
    analysis: createAnalysisService({ analysis: repos.AnalysisRepository, settings: repos.SettingsRepository, snapshots: repos.SnapshotRepository, rules: repos.RuleRepository }),
  };
  const collector = createCollector({ repos, services, paths });
  const providerResearch = createProviderResearch(repos.AnalysisRepository);
  const host = createAssistantHost(repos.SettingsRepository, paths.root);
  const alliance = createTaobaoAlliance();

  async function assistantReadiness() {
    const settings = (await repos.SettingsRepository.get()).data;
    const siteId = 'taobao'; // 与智能助手的计划编译站点一致
    const site = (await repos.SiteRepository.get(siteId)).data;
    const mode = settings.analysis_mode || 'agent_assisted';
    const issue = (code, message) => ({ ready: false, code, message, site_id: siteId });
    if (mode !== 'agent_assisted') return issue('ASSISTANT_DISABLED', '请在配置页启用智能选品助手。');
    if (!site?.enabled || !site.terms_checked) return issue('SITE_DISABLED', '请在配置页核验并启用淘宝。');
    const rule = (await repos.RuleRepository.get(siteId, site.rule_version || 'v1')).data;
    if (!rule?.entry_urls?.[0]) return issue('RULE_MISSING', '淘宝采集入口暂不可用。');
    const auth = await collector.auth.status(siteId);
    if (auth.logging_in) return issue('AUTH_IN_PROGRESS', '请完成浏览器里的淘宝登录。');
    if (auth.status === 'captcha_blocked') return issue('AUTH_REQUIRED', '淘宝需要你在浏览器中完成验证。');
    const check = await collector.auth.requireValid(siteId, { markExpired: false });
    if (!check.ok) return issue(check.code, check.code === 'AUTH_EXPIRED' ? '淘宝登录已过期，请重新登录。' : '采集前需要你登录一次淘宝。');
    return { ready: true, site_id: siteId };
  }

  const handlers = {
    ASSISTANT_HOST_UPDATE: (command) => host.update(command.host),
    PROVIDER_RESEARCH_SAVE: (command) => providerResearch.save(command.report),
    SITE_ADD: (c) => {
      const s = c.site || {};
      // 显式白名单：密码类字段一律丢弃，配置页不录密码、服务端不存密码
      return repos.SiteRepository.add({
        site_id: s.site_id, name: s.name, host: s.host,
        account_label: s.account_label, login_url: s.login_url,
        terms_checked: s.terms_checked,
      });
    },
    SETTINGS_UPDATE: (c) => services.analysis.setMode(c.analysis_mode),
    INTENT_SET: (c) => services.analysis.setIntent(c),
    PLAN_COMPILE: (c) => services.analysis.compile(c),
    RESEARCH_SESSION_START: (c) => services.analysis.startResearch(c),
    GUIDANCE_ANSWER_SET: (c) => services.analysis.answerResearch(c),
    PLAN_CONFIRM: (c) => services.analysis.confirmPlan(c),
    RESEARCH_SESSION_CANCEL: (c) => services.analysis.cancelResearch(c),
    PRO_PLAN_DRAFT: (c) => services.analysis.draftProfessionalPlan(c),
    PRO_PLAN_CONFIRM: (c) => services.analysis.confirmProfessionalPlan(c),
    GUIDE_REQUEST: (c) => services.analysis.createRequest({ ...c, kind: 'guide' }),
    OBSERVATION_REQUEST: (c) => services.analysis.createRequest({ ...c, kind: 'observation' }),
    SITE_REMOVE: (c) => repos.SiteRepository.softDelete(c.siteId),
    SITE_TOGGLE: (c) => repos.SiteRepository.update(c.siteId, { enabled: Boolean(c.enabled) }),
    SITE_TERMS: (c) => repos.SiteRepository.update(c.siteId, { terms_checked: Boolean(c.checked) }),
    SITE_RESTORE: (c) => repos.SiteRepository.restore(c.siteId),
    SITE_UPDATE: (c) => {
      const p = c.patch || {};
      const pick = (k) => (Object.hasOwn(p, k) ? { [k]: p[k] } : {});
      const patch = {
        ...pick('name'), ...pick('host'), ...pick('account_label'),
        ...pick('login_url'), ...pick('terms_checked'),
      };
      return repos.SiteRepository.update(c.siteId, patch);
    },
    AUTH_BEGIN: async (c) => {
      const pw = await loadPlaywright();
      if (!pw || !(await browserUsable(pw))) return failure('PLAYWRIGHT_MISSING', { site: c.siteId });
      const siteRes = await repos.SiteRepository.get(c.siteId);
      const site = siteRes.ok ? siteRes.data : {};
      const ruleRes = await repos.RuleRepository.get(c.siteId, site.rule_version || 'v1');
      const rule = ruleRes.ok ? ruleRes.data : {};
      const url = c.url || site.login_url || (rule.login_urls || [])[0]
        || (rule.entry_urls || [])[0] || (site.host ? `https://${site.host}/` : null);
      let intervalMs = 1500;
      try {
        const rt = JSON.parse(await fs.readFile(path.join(paths.root, 'app', 'config', 'runtime.json'), 'utf8'));
        intervalMs = Number(rt.auth_snapshot_interval_ms) || intervalMs;
      } catch { /* 用默认值 */ }
      return collector.auth.beginLogin(c.siteId, { playwright: pw, url, intervalMs });
    },
    AUTH_FINISH: (c) => collector.auth.finishLogin(c.siteId),
    AUTH_CANCEL: (c) => collector.auth.cancelLogin(c.siteId),
    AUTH_MARK: (c) => collector.auth.mark(c.siteId, c.status),
    CAPTURE_RUN: async (c) => {
      // 页面先保存 intent/plan，再把同一批次交给采集器，避免“只改显示、不改实际 URL”。
      const savedPlan = c.batchId ? (await repos.AnalysisRepository.get(`plan:${c.batchId}`)).data : null;
      const plan = c.plan || savedPlan || null;
      const units = plan?.units || [];
      const result = await collector.run({
        ...c,
        plan,
        keywords: units.map((u) => u.keyword).filter(Boolean),
        pages: units.length ? 1 : c.pages,
        intent_version: plan?.intent_version || null,
        plan_version: plan?.plan_version || null,
      });
      if (result.ok) await services.analysis.facts(result.data.batchId, { plan, queryResults: result.data.results });
      return result;
    },
    ASSISTANT_CAPTURE: async (c) => {
      const research = await services.analysis.getResearch(c.sessionId);
      if (!research.ok) return research;
      const session = research.data.session;
      if (session.mode !== 'agent_assisted') return failure('PERMISSION_DENIED');
      if (c.guidedOnly && !research.data.draft?.requirements) return failure('PERMISSION_DENIED');
      if (!research.data.draft?.queries?.length) {
        return err('STALE_WRITE', '计划缺少明确的查找方向', '补充检索词并重新确认计划');
      }
      const alreadyConfirmed = session.state === 'plan_confirmed' && session.version === c.expectedVersion + 1;
      if (!alreadyConfirmed && (session.state !== 'plan_draft' || session.version !== c.expectedVersion)) {
        return err('STALE_WRITE', '计划已变化', '查看最新草案后再确认');
      }
      const previous = alreadyConfirmed && (await repos.RunRepository.find(session.batch_id)).data;
      if (!previous) {
        const setup = await assistantReadiness();
        if (!setup.ready) return ok({ setup, run: null, facts: null });
      }
      const confirmed = alreadyConfirmed ? ok(research.data) : await services.analysis.confirmPlan(c);
      if (!confirmed.ok) return confirmed;
      const plan = confirmed.data.plan;
      if (!plan) return err('STALE_WRITE', '已确认计划不可用', '重新预览计划');
      const capture = previous ? null : await handlers.CAPTURE_RUN({ batchId: plan.batch_id, plan });
      const run = (await repos.RunRepository.find(plan.batch_id)).data;
      const facts = run?.ended_at
        ? (await services.analysis.facts(plan.batch_id, { plan, queryResults: run.sites })).data
        : null;
      return ok({ run, facts, capture_error: capture?.ok === false ? capture : null });
    },
    GUIDED_PLAN_UPDATE: (c) => services.analysis.updateGuidedPlan(c),
    GUIDED_PLAN_STAGE: (c) => services.analysis.applyAgentGuidance(c),
    WORKBENCH_CAPTURE: async (c) => {
      const current = (await services.analysis.effectivePlan()).data;
      if ((current?.plan.plan_id ?? null) !== c.expectedPlanId) {
        return err('STALE_WRITE', '生效计划已变化', '请检查更新后的计划，再开始采集');
      }
      return handlers.CAPTURE_RUN({ batchId: `batch:${c.commandId}`, plan: current?.plan });
    },
    CAPTURE_STOP: () => ok({ stopped: collector.stop() }),
    MARKER_SET: (c) => services.marker.setMarker(c),
    MARKER_IMPORT: (c) => services.marker.importList(c),
    DECISION_STATE: (c) => services.decision.setState(c),
    DECISION_CORRECTION: (c) => services.decision.appendCorrection(c),
    DECISION_MANUAL: (c) => services.decision.manualFieldValue(c),
    DECISION_IGNORE: (c) => services.decision.ignoreAnomaly(c),
    UNDO: (c) => services.recovery.undo(c),
    CLEAR_ALL: (c) => services.recovery.clearAll(c),
    TEMP_SORT_OFF: (c) => services.recovery.setTempSortOff(c),
    RESTORE: async (c) => {
      const list = (await repos.RecoverableRepository.list()).data || [];
      const op = list.find((o) => o.op_id === c.opId) || list[list.length - 1];
      if (op && op.kind === 'site') {
        await repos.SiteRepository.restore(op.site_id);
        await repos.RecoverableRepository.markRestored(op.op_id);
        return ok({ opId: op.op_id, restored: true, kind: 'site' });
      }
      return services.recovery.restore(c);
    },
  };

  const bus = createCommandBus({
    commands: repos.CommandLogRepository,
    handlers,
    onChanged: () => undefined,
  });
  await bus.replay();

  function submit(input) {
    const command = {
      ...input,
      commandId: input.commandId || `cmd:${randomUUID()}`,
      type: input.type,
    };
    if (!command.type || !Object.hasOwn(handlers, command.type)) {
      return Promise.resolve(err('STORAGE_FAILED', '未知的操作类型', '刷新页面后再试，或检查请求参数'));
    }
    return bus.execute(command);
  }

  async function state() {
    const task = (await repos.TaskRepository.get()).data;
    const cfg = (await repos.SettingsRepository.get()).data;
    const authStates = {};
    for (const s of (await repos.SiteRepository.list()).data) {
      authStates[s.site_id] = await collector.auth.status(s.site_id);
    }
    return {
      ok: true,
      data: {
        schemaVersion: 2,
        task,
        default_site: cfg.default_site,
        analysis_mode: cfg.analysis_mode || 'agent_assisted',
        authStates,
        running: collector.isRunning(),
      },
    };
  }

  return Object.freeze({
    retailStatus: () => ok({ configured: alliance.configured }),
    retailImport: async (input) => {
      if (!['taobao', 'tmall', 'jd', 'pinduoduo', 'douyin', 'other_cn'].includes(input?.platform) ||
        typeof input.source !== 'string' || !input.source.trim() ||
        typeof input.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.observedAt) ||
        Number.isNaN(Date.parse(input.observedAt)) ||
        (input.budget != null && (!Number.isFinite(input.budget) || input.budget <= 0))) {
        return err('STORAGE_FAILED', '请填写来源、平台及观察日期', '按表格导入区的要求补齐');
      }
      let items;
      try { items = retailCsvItems(input.csv); }
      catch (error) { return err('STORAGE_FAILED', error.message, '检查 CSV 表头和行格式'); }
      return submit({ type: 'PROVIDER_RESEARCH_SAVE', report: providerReportInput({
        provider: 'retail_csv', platform: input.platform, market: 'CN', query: input.query || '表格候选',
        tool: input.source, window: input.observedAt, budget: input.budget, items,
      }) });
    },
    retailSearch: async (input) => {
      const queries = Array.isArray(input?.queries) ? [...new Set(input.queries
        .filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))] : [];
      const budget = input?.budget ?? null;
      if (!queries.length || queries.length > 3 || queries.some((query) => query.length > 80) ||
        (budget !== null && (!Number.isFinite(budget) || budget <= 0))) {
        return err('STORAGE_FAILED', '请输入 1 至 3 个搜索词，预算为正数或留空', '修改查询条件后重试');
      }
      if (!alliance.configured) return err('PERMISSION_DENIED', '淘宝联盟接口尚未配置', '可以先用表格导入');
      const results = [];
      for (const query of queries) {
        try {
          const items = await alliance.search(query, budget);
          if (!items.length) { results.push({ query, status: 'empty' }); continue; }
          const report = await submit({ type: 'PROVIDER_RESEARCH_SAVE', report: providerReportInput({
            provider: 'taobao_alliance', platform: 'taobao', market: 'CN', query, budget,
            tool: '淘宝联盟物料搜索', window: new Date().toISOString(), items,
          }) });
          results.push(report.ok ? { query, status: 'done', report: report.data } : { query, status: 'failed', message: report.message });
        } catch (error) {
          results.push({ query, status: 'failed', message: error.name === 'TimeoutError' ? '淘宝联盟查询超时' :
            error.message.startsWith('淘宝联盟') ? error.message : '淘宝联盟查询未完成，请检查网络或权限' });
        }
      }
      return ok(results);
    },
    assistantHost: host.status,
    workBuddyHandoff: host.workBuddy,
    providerReports: () => providerResearch.list(),
    guidedStatus: async (id) => {
      const research = await services.analysis.getResearch(id);
      if (!research.ok || !research.data.draft?.requirements) {
        return err('STALE_WRITE', '这个引导任务不可用', '回到对话打开最新的需求卡');
      }
      const { session, draft } = research.data;
      const run = session.batch_id ? (await repos.RunRepository.find(session.batch_id)).data : null;
      const facts = run?.ended_at ? (await repos.AnalysisRepository.get(`facts:${run.batch_id}`)).data : null;
      return ok({ session, draft, run, facts });
    },
    assistantReadiness: async () => ok(await assistantReadiness()),
    stopCapture: handlers.CAPTURE_STOP,
    submit, state, sites: () => repos.SiteRepository.list(false),
    results: async (filters) => {
      const latestRun = (await repos.RunRepository.latest()).data;
      let batchId = filters.batchId || 'latest';
      if (batchId === 'latest') {
        // 尚无采集记录时用不存在的批次占位，保持「本轮」视图与声明一致，不静默退回累计
        batchId = latestRun?.batch_id || '__no_run__';
      }
      let evidence = null;
      if (batchId === filters.evidenceBatch && batchId !== 'all') {
        const facts = (await repos.AnalysisRepository.get(`facts:${batchId}`)).data;
        const queryId = facts?.queries?.find((query) => query.query_id === filters.evidenceQuery)?.query_id;
        const ceiling = facts?.budget?.max_price;
        const budgetGroup = Number.isFinite(ceiling) &&
          ['at_or_below', 'above', 'unavailable'].includes(filters.evidenceBudget) ? filters.evidenceBudget : null;
        if (queryId || budgetGroup) evidence = { batchId, queryId, budgetGroup, ceiling };
      }
      return services.query.dashboard({ ...filters, batchId, latestBatchId: latestRun?.batch_id || null, evidence });
    },
    runs: () => repos.RunRepository.list(),
    recoverables: () => repos.RecoverableRepository.list(),
    authStatus: (id) => collector.auth.status(id),
    resetSession: () => services.recovery.resetTempSortOff(),
    guide: (siteId) => services.analysis.guide(siteId),
    facts: (batchId) => services.analysis.facts(batchId),
    analysisGet: (key) => repos.AnalysisRepository.get(key),
    researchSession: (id) => services.analysis.getResearch(id),
    activeResearch: () => services.analysis.activeResearch(),
    professionalPlan: () => services.analysis.getProfessionalPlan(),
    effectivePlan: () => services.analysis.effectivePlan(),
    agentNext: () => services.analysis.nextAgentSession(),
    agentResearch: (id) => services.analysis.getResearch(id),
    agentStart: (c) => services.analysis.startAgentResearch(c),
    agentGuidance: (c) => services.analysis.applyAgentGuidance(c),
    agentAnswer: (c) => services.analysis.acceptAgentAnswer(c),
    collector, services, repos,
  });
}
