/**
 * 登录态管理（D3=B′）：不录入、不保存任何密码。
 * 本人点「登录」→ 打开有头浏览器到站点登录起始页 → 本人手动输入或扫码
 * → 系统把 storageState（cookies）存到本机 → 采集时复用免登录。
 * 过期判定只依据本地 cookie 有效期与页面重定向 / 规则提示，不虚构站点特征。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ok, err } from '../core/shared/result.js';
import { failure } from '../core/shared/errors.js';

/** 通用登录跳转兜底词：通用 URL 语义，不是站点实测结论；可由规则 login_required_hints 覆盖。 */
const GENERIC_LOGIN_PATH_HINTS = Object.freeze([
  /\/login\b/i, /\/signin\b/i, /\/passport\b/i, /\/auth\b/i, /\/login\.htm/i,
]);

/** 只在本机读 storageState；读不到返回 null，不抛异常。 */
export async function readStorageState(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return null; }
}

/**
 * 本地 cookie 过期判定：只有「所有带有效期的 cookie 都已过期」才判过期。
 * 空状态 / 只有会话 cookie 不据此判定，避免把合法会话误判为过期。
 */
export function storageStateExpired(state) {
  const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
  if (!cookies.length) return false;
  const withExpiry = cookies.filter((c) => Number(c.expires) > 0);
  if (!withExpiry.length) return false;
  const now = Date.now() / 1000;
  return withExpiry.every((c) => Number(c.expires) <= now);
}

/** 页面是否被重定向到登录：跨 host、命中规则 URL 片段、或落在通用登录路径。 */
export function loginRedirected(currentUrl, entryUrl, rule = {}) {
  const hints = Array.isArray(rule.login_required_hints) ? rule.login_required_hints : [];
  try {
    const cur = new URL(currentUrl);
    const entry = new URL(entryUrl);
    if (cur.host !== entry.host) return true;
    if (hints.some((h) => typeof h === 'string' && cur.href.includes(h))) return true;
    return GENERIC_LOGIN_PATH_HINTS.some((re) => re.test(cur.pathname));
  } catch {
    return false;
  }
}

export function createAuthManager({ repos, sessions = new Map(), snapshotIntervalMs = 1500 } = {}) {
  async function status(siteId) {
    const meta = (await repos.AuthStateRepository.meta(siteId)).data || {};
    const exists = await repos.AuthStateRepository.exists(siteId);
    const target = repos.AuthStateRepository.pathFor(siteId);
    const state = exists ? await readStorageState(target) : null;
    return {
      site_id: siteId,
      status: meta.status || 'unknown',
      exists,
      path: target,
      updated_at: meta.updated_at || null,
      cookie_count: Array.isArray(state?.cookies) ? state.cookies.length : 0,
      logging_in: sessions.has(siteId),
    };
  }

  async function mark(siteId, next) {
    await repos.AuthStateRepository.setMeta(siteId, { status: next });
    await repos.SiteRepository.update(siteId, { auth_status: next });
    return ok({ site_id: siteId, status: next });
  }

  /** 采集前门禁：登录态缺失 → AUTH_REQUIRED；cookie 全过期 → AUTH_EXPIRED 并落状态。 */
  async function requireValid(siteId, { markExpired = true } = {}) {
    const s = await status(siteId);
    if (!s.exists || s.status !== 'valid') {
      return failure(s.status === 'expired' ? 'AUTH_EXPIRED' : 'AUTH_REQUIRED', { site: siteId });
    }
    const state = await readStorageState(s.path);
    if (!state) return failure('AUTH_REQUIRED', { site: siteId });
    if (storageStateExpired(state)) {
      if (markExpired) await mark(siteId, 'expired');
      return failure('AUTH_EXPIRED', { site: siteId });
    }
    return ok(s);
  }

  async function finalize(siteId) {
    const s = sessions.get(siteId);
    if (!s || s.finalized) return s?.result || 'none';
    s.finalized = true;
    s.closed = true;
    if (s.timer) clearInterval(s.timer);
    try {
      const st = await s.context.storageState();
      s.latest = Array.isArray(st.cookies) ? st.cookies.length : s.latest;
      await fs.writeFile(s.pending, JSON.stringify(st), 'utf8');
    } catch { /* 窗口已关闭，用最后一次定时快照 */ }

    if (s.latest > s.baseline) {
      try {
        await fs.copyFile(s.pending, s.target);
        await fs.rm(s.pending, { force: true });
        await mark(siteId, 'valid');
        s.result = 'saved';
      } catch {
        s.result = 'failed';
      }
    } else {
      await fs.rm(s.pending, { force: true }).catch(() => undefined);
      await mark(siteId, s.prevStatus === 'valid' ? 'valid' : 'unknown');
      s.result = 'no_cookies';
    }
    sessions.delete(siteId);
    return s.result;
  }

  /** 打开有头浏览器，本人在里面登录；登录期间持续快照，关窗即自动保存。 */
  async function beginLogin(siteId, { playwright, url, intervalMs } = {}) {
    if (!playwright) return failure('PLAYWRIGHT_MISSING', { site: siteId });
    if (!url) return failure('RULE_MISSING', { site: siteId, field: '登录入口' });
    await cancelLogin(siteId, { silent: true });
    const prev = await status(siteId);

    let browser;
    try {
      browser = await playwright.chromium.launch({ headless: false });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const target = repos.AuthStateRepository.pathFor(siteId);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const session = {
        browser, context, page, target, pending: `${target}.pending`,
        baseline: 0, latest: 0, timer: null, finalized: false, closed: false,
        prevStatus: prev.status, result: 'none',
      };
      try {
        const initial = await context.storageState();
        session.baseline = Array.isArray(initial.cookies) ? initial.cookies.length : 0;
      } catch { /* 首次状态读不到按 0 处理 */ }

      const tick = async () => {
        if (session.closed) return;
        try {
          const st = await context.storageState();
          session.latest = Array.isArray(st.cookies) ? st.cookies.length : session.latest;
          await fs.writeFile(session.pending, JSON.stringify(st), 'utf8');
        } catch { /* 窗口正在关闭，忽略单次快照 */ }
      };
      await tick();
      const ms = Math.max(500, Number(intervalMs ?? snapshotIntervalMs) || 1500);
      session.timer = setInterval(() => { void tick(); }, ms);
      session.timer.unref?.();
      sessions.set(siteId, session);
      browser.on('disconnected', () => { void finalize(siteId); });
      await mark(siteId, 'logging_in');
      return ok({
        site_id: siteId, url,
        message: '已打开浏览器窗口，请本人在里面登录或扫码；登录完成后关闭窗口即可自动保存，也可点「确认已登录」',
      });
    } catch (e) {
      if (browser) { try { await browser.close(); } catch { /* 已关闭 */ } }
      return err('AUTH_REQUIRED', `登录窗口没能打开：${String(e && e.message ? e.message : e)}`,
        '确认已安装 Playwright 浏览器，或在配置页填一个可打开的登录页地址');
    }
  }

  /** 显式确认：立刻把最后一次快照落盘；没检测到新 cookies 则如实说明，不假装成功。 */
  async function finishLogin(siteId) {
    const s = sessions.get(siteId);
    if (!s) return err('AUTH_REQUIRED', '这次登录会话已结束', '重新点「登录」再试一次');
    const result = await finalize(siteId);
    try { await s.browser.close(); } catch { /* 已关闭 */ }
    if (result === 'saved') return ok({ site_id: siteId, path: s.target, status: 'valid' });
    return err('AUTH_REQUIRED', '还没有检测到新的登录信息',
      '请在打开的浏览器里完成登录，再点一次「确认已登录」；或关掉窗口让它自动保存');
  }

  /** 取消：丢弃本次快照，不覆盖已有的有效登录态。 */
  async function cancelLogin(siteId, { silent = false } = {}) {
    const s = sessions.get(siteId);
    if (!s) return ok();
    s.finalized = true;
    s.closed = true;
    if (s.timer) clearInterval(s.timer);
    await fs.rm(s.pending, { force: true }).catch(() => undefined);
    sessions.delete(siteId);
    try { await s.browser.close(); } catch { /* 已关闭 */ }
    if (!silent) await mark(siteId, s.prevStatus || 'unknown');
    return ok();
  }

  /** 挑战页判定：只依据站点规则配置的提示词；未配置一律不判定，不虚构特征。 */
  async function looksLikeChallenge(page, rule) {
    const hints = rule?.challenge_hints || [];
    if (!hints.length) return false;
    for (const hint of hints) {
      try {
        if (typeof hint === 'string' && (await page.locator(hint).count()) > 0) return true;
      } catch { /* 单个提示词不可用不阻断 */ }
    }
    return false;
  }

  /** 过期页面判定：规则提示选择器 + URL 重定向双路，任一路命中即认为需重新授权。 */
  async function looksLikeLoginRequired(page, rule, entryUrl) {
    const hints = Array.isArray(rule?.login_required_hints) ? rule.login_required_hints : [];
    for (const hint of hints) {
      try {
        if (typeof hint === 'string' && (await page.locator(hint).count()) > 0) return true;
      } catch { /* 单个提示词不可用不阻断 */ }
    }
    return loginRedirected(page.url(), entryUrl, rule);
  }

  return Object.freeze({
    status, requireValid, mark, beginLogin, finishLogin, cancelLogin,
    looksLikeChallenge, looksLikeLoginRequired, sessions,
  });
}
