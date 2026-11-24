/**
 * 采集调度：串行逐站 → 单站超时 → 逐条落库 → 单站失败标记不整批失败 → 不轰炸重试。
 * 规则 / 登录态 / Playwright 任一未就绪都走明确降级，不静默失败、不落库。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ok } from '../core/shared/result.js';
import { failure } from '../core/shared/errors.js';
import { isRuleReady } from '../core/domain/rule/site-rule.js';
import { loadPlaywright, browserUsable, INSTALL_HINT } from './driver.js';
import { createAuthManager } from './auth.js';
import { detectPageKind, extractFields } from './extract.js';

async function readRuntime(paths) {
  try {
    return JSON.parse(await fs.readFile(path.join(paths.root, 'app', 'config', 'runtime.json'), 'utf8'));
  } catch {
    return { site_timeout_ms: null, poll_interval_ms: null };
  }
}

function withTimeout(work, ms) {
  if (!ms) return work;
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('SITE_TIMEOUT')), ms);
  });
  work.catch(() => undefined);
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * @param {{repos: Object, services: Object, paths: Object}} ctx
 */
export function createCollector(ctx) {
  const { repos, services, paths } = ctx;
  const auth = createAuthManager({ repos });
  let running = false;
  let stopRequested = false;

  async function preflight() {
    const pw = await loadPlaywright();
    if (!pw) return { ok: false, code: 'PLAYWRIGHT_MISSING', installHint: INSTALL_HINT };
    if (!(await browserUsable(pw))) return { ok: false, code: 'PLAYWRIGHT_MISSING', installHint: INSTALL_HINT };
    return { ok: true, playwright: pw };
  }

  async function runOne(site, pw, command, runtime, batchId, unit) {
    const siteId = site.site_id;
    const base = { site_id: siteId, name: site.name, status: 'done', stored: 0, reason: '',
      ...(unit ? { query_id: unit.query_id, keyword: unit.keyword } : {}) };
    let browser = null;
    try {
      const ruleRes = await repos.RuleRepository.get(siteId, site.rule_version || 'v1');
      if (!ruleRes.ok) return { ...base, status: 'rule_missing', reason: '站点规则文件未载入' };
      const rule = ruleRes.data;
      const entry = unit?.entry_url || (rule.entry_urls || [])[0];
      if (!entry) return { ...base, status: 'rule_missing', reason: '采集入口 URL 尚未实测回填' };
      // 只校验本轮实际入口对应的页面类型，不强求未作为入口的页面也已核对
      const ready = isRuleReady(rule, detectPageKind(entry, rule).pageKind);
      if (!ready.ok) return { ...base, status: 'rule_missing', reason: ready.reason };

      const authRes = await auth.requireValid(siteId);
      if (!authRes.ok) {
        return {
          ...base,
          status: authRes.code === 'AUTH_EXPIRED' ? 'auth_expired' : 'auth_required',
          reason: authRes.message, hint: authRes.hint,
        };
      }

      const work = (async () => {
        browser = await pw.chromium.launch({ headless: true });
        const context = await browser.newContext({ storageState: authRes.data.path });
        const page = await context.newPage();
        await page.goto(entry, { waitUntil: 'domcontentloaded' });
        if (unit?.keyword && new URL(page.url()).searchParams.get('q') !== unit.keyword) {
          return { ...base, status: 'failed', reason: '检索词未在落地地址生效，未把本页记为成功样本' };
        }
        const kind = detectPageKind(page.url(), rule);
        // B0 实测：搜索结果页商品数据异步渲染，domcontentloaded 时仍是骨架屏。
        // 用语义锚点做条件等待（不刷新页面、不做 UI 轮询、不固定睡眠）；
        // 超时后交给 extractFields 判定为 rulePending，走明确降级、不猜测、不落库。
        const anchors = rule.anchor_selectors?.[kind.pageKind] || [];
        if (anchors.length) {
          const waitMs = Math.min(Number(runtime.site_timeout_ms) || 10000, 10000);
          try { await page.waitForSelector(anchors[0], { timeout: waitMs }); }
          catch { /* 锚点未出现：由后续抽取判定为降级态 */ }
        }
        if (await auth.looksLikeChallenge(page, rule)) {
          await auth.mark(siteId, 'captcha_blocked');
          return { ...base, status: 'captcha_blocked', reason: '疑似验证页面，已暂停该站；不自动绕过' };
        }
        if (await auth.looksLikeLoginRequired(page, rule, entry)) {
          await auth.mark(siteId, 'expired');
          return { ...base, status: 'auth_expired', reason: '登录态已过期，本轮未采集该站；到「配置」页点该站的「登录」重新授权' };
        }
        if (kind.rulePending) return { ...base, status: 'rule_missing', reason: kind.reason };
        if (kind.pageKind === 'UNSUPPORTED') {
          return { ...base, status: 'failed', reason: kind.reason };
        }
        const extracted = await extractFields(page, rule, kind.pageKind);
        if (extracted.rulePending) {
          return { ...base, status: 'rule_missing', reason: '语义锚点未回填或页面结构已变' };
        }
        const url = page.url();
        const fieldResult = {
          pageKind: kind.pageKind,
          url,
          asOf: new Date().toISOString(),
          items: extracted.items,
          fields: extracted.fields,
          ruleVersion: rule.version || 'v1',
          rulePending: false,
        };
        const cap = {
          commandId: unit ? `${batchId}:${siteId}:${unit.query_id}` : `${batchId}:${siteId}`,
          type: 'CAPTURE_PAGE',
          site: siteId,
          batchId,
          queryId: unit?.query_id,
          expectedPageKind: kind.pageKind,
          expectedUrl: url,
          sampleKind: 'auto',
          market: rule.market || 'domestic',
          channel: siteId,
          keywords: unit?.keyword ? [unit.keyword] : (command.keywords ?? null),
          pages: unit?.page ? 1 : (command.pages ?? null),
        };
        const r = await services.capture.capture(cap, fieldResult);
        if (!r.ok) return { ...base, status: 'failed', reason: r.message };
        return { ...base, status: 'done', stored: r.data.stored.length, skipped: r.data.skipped.length };
      })();
      return await withTimeout(work, runtime.site_timeout_ms);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg === 'SITE_TIMEOUT') {
        return { ...base, status: 'failed', reason: '超过单站时间上限（示例值，待确认），已标记该站' };
      }
      if (/unauthorized|401|会话过期|登录已失效/i.test(msg)) {
        await auth.mark(siteId, 'expired');
        return { ...base, status: 'auth_expired', reason: '登录态已过期，本轮未采集该站；到「配置」页点该站的「登录」重新授权' };
      }
      if (/captcha|verify|slider|验证/i.test(msg)) {
        await auth.mark(siteId, 'captcha_blocked');
        return { ...base, status: 'captcha_blocked', reason: '遇到验证环节，已暂停该站；不自动绕过' };
      }
      return { ...base, status: 'failed', reason: msg, hint: '不自动重试；可停用该站或稍后再采一次' };
    } finally {
      if (browser) { try { await browser.close(); } catch { /* 已关闭 */ } }
    }
  }

  /** 双触发唯一入口：页面按钮与 Skill 脚本都调这里；每点一次生成一条采集记录。 */
  async function run(command = {}) {
    if (running) return failure('CAPTURE_RUNNING');
    const batchId = command.batchId || `batch:${Date.now()}`;
    const startedAt = new Date().toISOString();
    const writeRun = (patch) => repos.RunRepository.upsert({
      batch_id: batchId, started_at: startedAt, stored: 0, sites: [], message: '',
      analysis_mode: command.plan ? 'local_only' : null,
      intent_version: command.intent_version || null, plan_version: command.plan_version || null,
      keywords: command.keywords ?? null, plan_units: command.plan?.units || [], ...patch,
    });
    await writeRun({ state: 'running' });

    const enabledSites = (await repos.SiteRepository.enabled()).data || [];
    const units = command.plan?.units || [];
    const jobs = units.length
      ? units.map((unit) => ({ unit, site: enabledSites.find((site) => site.site_id === unit.site_id) }))
      : enabledSites.map((site) => ({ site, unit: null }));
    const label = ({ site, unit }) => ({
      site_id: site?.site_id || unit.site_id,
      name: site?.name || unit.site_id,
      ...(unit ? { query_id: unit.query_id, keyword: unit.keyword } : {}),
    });
    if (!jobs.length) {
      await writeRun({ state: 'not_started', ended_at: new Date().toISOString(), message: '还没有启用任何站点' });
      return failure('NO_ENABLED_SITE');
    }

    // 规则缺失是确定性配置问题，应在 Playwright 预检之前明确呈现；
    // 这样即使本机尚未安装浏览器，也不会掩盖“规则未回填”的真正下一步。
    const ruleOnly = [];
    for (const job of jobs) {
      const { site } = job;
      if (!site) {
        ruleOnly.push({ ...label(job), status: 'disabled', reason: '计划中的站点未启用' });
        continue;
      }
      const loaded = await repos.RuleRepository.get(site.site_id, site.rule_version || 'v1');
      const entry = loaded.ok ? (loaded.data.entry_urls || [])[0] : null;
      if (!entry) ruleOnly.push({ ...label(job), status: 'rule_missing', reason: '采集入口 URL 尚未实测回填' });
    }
    if (ruleOnly.length === jobs.length) {
      const endedAt = new Date().toISOString();
      await repos.TaskRepository.set({ state: 'partial', batch_id: batchId, started_at: startedAt, ended_at: endedAt, sites: ruleOnly, message: '站点规则未回填，未启动浏览器、未落库' });
      await writeRun({ state: 'partial', ended_at: endedAt, sites: ruleOnly, message: '站点规则未回填，未启动浏览器、未落库' });
      return ok({ state: 'partial', batchId, results: ruleOnly, stored: 0 });
    }

    const pre = await preflight();
    if (!pre.ok) {
      await writeRun({
        state: 'not_started', ended_at: new Date().toISOString(),
        reason: pre.code, message: pre.installHint || '自动采集组件未就绪',
      });
      return failure(pre.code, { field: 'Playwright' });
    }

    const runtime = await readRuntime(paths);
    running = true;
    stopRequested = false;
    const pending = jobs.map((job) => ({ ...label(job), status: 'pending' }));
    await repos.TaskRepository.set({
      state: 'running', batch_id: batchId, started_at: startedAt, ended_at: null,
      sites: pending, message: '',
    });
    await writeRun({ state: 'running', sites: pending });

    const results = [];
    for (const job of jobs) {
      const { site, unit } = job;
      if (stopRequested) {
        results.push({ ...label(job), status: 'disabled', reason: '本轮已停止' });
        continue;
      }
      if (!site) {
        results.push({ ...label(job), status: 'disabled', reason: '计划中的站点未启用' });
        continue;
      }
      const blocked = results.find((result) => result.site_id === site.site_id &&
        ['auth_required', 'auth_expired', 'captcha_blocked'].includes(result.status));
      if (blocked) {
        results.push({ ...label(job), status: blocked.status, reason: blocked.reason });
        continue;
      }
      await repos.TaskRepository.patch({
        sites: [
          ...results,
          { ...label(job), status: 'running' },
          ...pending.slice(results.length + 1),
        ],
      });
      const r = await runOne(site, pre.playwright, command, runtime, batchId, unit);
      results.push(r);
      await repos.TaskRepository.patch({ sites: results });
      await writeRun({ sites: results, stored: results.reduce((n, x) => n + (Number(x.stored) || 0), 0) });
    }

    const hasFailure = results.some((r) => r.status !== 'done');
    const state = stopRequested ? 'stopped' : hasFailure ? 'partial' : 'done';
    const endedAt = new Date().toISOString();
    const needAuth = results.some((r) => r.status === 'auth_expired' || r.status === 'auth_required');
    const message = needAuth
      ? '有站点需要重新登录：到「配置」页点该站的「登录」，本人在打开的浏览器里登录一次'
      : hasFailure ? '部分站点未完成，原因见逐站状态；已采数据不受影响' : '本轮采集完成';
    const stored = results.reduce((n, r) => n + (Number(r.stored) || 0), 0);
    await repos.TaskRepository.set({ state, ended_at: endedAt, sites: results, message });
    await writeRun({ state, ended_at: endedAt, sites: results, stored, message });
    running = false;
    return ok({ state, batchId, results, stored });
  }

  function stop() {
    if (!running) return false;
    stopRequested = true;
    return true;
  }

  return Object.freeze({ run, stop, preflight, auth, isRunning: () => running });
}
