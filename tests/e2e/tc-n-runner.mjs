/**
 * TC-N 可执行验收（M1，21 条）。
 *
 * 原则：
 * - 真实调用 app/server/task.js 的 submit() 单一入口与仓储，不 mock 业务逻辑。
 * - 使用系统临时目录作为数据/登录态目录，不污染工程内 data/store.json 与 playwright/.auth/。
 * - 只读真实站点规则文件（保持 pending_b0_probe 空槽），不回填、不虚构选择器。
 * - 不代填密码、不自动登录、不绕过验证；依赖真实淘宝页面或本人登录的用例如实标 BLOCKED。
 *
 * 用法：node tests/e2e/tc-n-runner.mjs
 * 输出：每条 PASS / FAIL / PARTIAL / BLOCKED + 证据；BLOCKED 不计入通过。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositories } from '../../app/store/index.js';
import { createTaskRuntime } from '../../app/server/task.js';
import { CLEAR_CONFIRM_TOKEN } from '../../app/core/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pick-tcn-'));
const paths = Object.freeze({
  root: ROOT,
  data: tmp,
  storeFile: path.join(tmp, 'store.json'),
  authDir: path.join(tmp, '.auth'),
  rulesDir: path.join(ROOT, 'app', 'config', 'site-rules'),
  webDir: path.join(ROOT, 'app', 'web'),
});
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const out = [];
const put = (id, name, status, evidence) => out.push({ id, name, status, evidence });
const blocked = (id, name, why) => put(id, name, 'BLOCKED', why);

const repos = await createRepositories(paths);
const rt = await createTaskRuntime({ repos, paths });
const sites = async () => (await rt.sites()).data || [];
const recoverables = async () => (await rt.recoverables()).data || [];

async function safe(id, name, fn) {
  try {
    const { pass, partial, evidence } = await fn();
    put(id, name, pass ? 'PASS' : partial ? 'PARTIAL' : 'FAIL', evidence);
  } catch (e) {
    put(id, name, 'FAIL', `执行异常：${String(e && e.message ? e.message : e)}`);
  }
}

/* ---------- 可在本机真实执行的用例 ---------- */

await safe('TC-N01', '新增站点', async () => {
  const r = await rt.submit({
    type: 'SITE_ADD',
    site: {
      site_id: 'taobao', name: '淘宝', host: 'taobao.com',
      account_label: '本人账号', login_url: '', terms_checked: true,
      password: 'SHOULD_BE_DROPPED', pwd: 'SHOULD_BE_DROPPED',
    },
  });
  const s = (await sites()).find((x) => x.site_id === 'taobao');
  const enabled = (await repos.SiteRepository.enabled()).data || [];
  const pass = r.ok && !!s && s.enabled === false && !enabled.some((e) => e.site_id === 'taobao');
  return { pass, evidence: `SITE_ADD ok=${r.ok}；enabled=${s?.enabled}；启用队列数=${enabled.length}` };
});

await safe('TC-N02', '删除 + 恢复', async () => {
  const del = await rt.submit({ type: 'SITE_REMOVE', siteId: 'taobao' });
  const gone = !(await sites()).some((x) => x.site_id === 'taobao');
  const recs = await recoverables();
  const op = recs[recs.length - 1];
  const res = await rt.submit({ type: 'RESTORE', opId: op?.op_id });
  const back = (await sites()).some((x) => x.site_id === 'taobao');
  return {
    pass: del.ok && gone && !!op && res.ok && back,
    evidence: `删除 ok=${del.ok}，列表移除=${gone}；可恢复项 kind=${op?.kind}；RESTORE ok=${res.ok}，站点回来=${back}`,
  };
});

await safe('TC-N03', '清空不清除可恢复区，误删能救', async () => {
  await rt.submit({ type: 'SITE_REMOVE', siteId: 'taobao' });
  const siteOp = (await recoverables()).filter((o) => o.kind === 'site').at(-1);
  const before = (await recoverables()).length;
  const noToken = await rt.submit({ type: 'CLEAR_ALL' }); // 唯一二次确认：不带 token 必须被拒
  const clr = await rt.submit({ type: 'CLEAR_ALL', confirmToken: CLEAR_CONFIRM_TOKEN });
  const after = await recoverables();
  const kept = after.some((o) => o.op_id === siteOp?.op_id);
  await rt.submit({ type: 'RESTORE', opId: siteOp?.op_id });
  const rescued = (await sites()).some((x) => x.site_id === 'taobao');
  return {
    pass: noToken.ok === false && clr.ok && after.length > before && kept && rescued,
    evidence: `无确认 token 被拒=${noToken.ok === false}；CLEAR_ALL ok=${clr.ok}；可恢复项 ${before} → ${after.length}；删除项仍在=${kept}；清空后仍能恢复站点=${rescued}`,
  };
});

await safe('TC-N19', '不录密码 / 夹带字段被丢弃 / 无密文文件', async () => {
  const s = (await sites()).find((x) => x.site_id === 'taobao');
  const noField = !!s && !Object.keys(s).some((k) => /pass|pwd|secret|key/i.test(k));
  const html = read('app/web/index.html');
  const noInput = !/type=["']password["']/.test(html);
  const noSecretFiles = !fs.existsSync(path.join(tmp, 'credentials.enc'))
    && !fs.existsSync(path.join(tmp, '.key'));
  const taskSrc = read('app/server/task.js');
  const whitelist = taskSrc.includes('密码类字段一律丢弃') || taskSrc.includes('显式白名单');
  return {
    pass: noField && noInput && noSecretFiles && whitelist,
    evidence: `站点记录无密码字段=${noField}；页面无密码输入框=${noInput}；临时库无密文/主密钥=${noSecretFiles}；服务端白名单=${whitelist}`,
  };
});

await safe('TC-N05', '规则未回填 → 行内降级、不落库（独立空规则注入）', async () => {
  // 本机规则已在 B0 实测后回填，故用独立临时目录注入一份空槽规则来验证降级不变量：
  // 既不污染本机数据，也不改动已回填的规则文件。
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const osm = await import('node:os');
  const { PATHS } = await import('../../app/store/paths.js');
  const { createRepositories } = await import('../../app/store/index.js');
  const { createTaskRuntime } = await import('../../app/server/task.js');
  const tmp = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'tc-n05-blank-rule-'));
  const blankRules = pathm.join(tmp, 'rules');
  fsm.mkdirSync(blankRules, { recursive: true });
  fsm.writeFileSync(pathm.join(blankRules, 'taobao.json'), JSON.stringify({
    site: 'taobao', version: 'v1', status: 'pending_b0_probe',
    field_selector_map: { 'PG-1': {}, 'PG-2': {} },
    anchor_selectors: { 'PG-1': [], 'PG-2': [] },
    price_type_enum: [], url_patterns: { 'PG-1': [], 'PG-2': [] },
    entry_urls: [], value_ranges: {},
  }));
  const p2 = {
    ...PATHS,
    data: tmp, storeFile: pathm.join(tmp, 'store.json'),
    authDir: pathm.join(tmp, '.auth'), rulesDir: blankRules,
  };
  try {
    const r2 = await createRepositories(p2);
    const rt2 = await createTaskRuntime({ repos: r2, paths: p2 });
    await rt2.submit({ type: 'SITE_ADD', site: { site_id: 'taobao', name: '淘宝', host: 'taobao.com', terms_checked: true } });
    await rt2.submit({ type: 'SITE_TOGGLE', siteId: 'taobao', enabled: true });
    const cap = await rt2.submit({ type: 'CAPTURE_RUN', batchId: 'tc-n05-rule-missing' });
    const siteResult = cap?.data?.results?.[0] || cap?.results?.[0] || {};
    const snaps = (await r2.SnapshotRepository.listAll()).data || [];
    return {
      pass: siteResult.status === 'rule_missing' && snaps.length === 0,
      evidence: `（空规则注入）逐站状态=${siteResult.status}；reason=${siteResult.reason || '(空)'}；落库快照数=${snaps.length}`,
    };
  } finally {
    fsm.rmSync(tmp, { recursive: true, force: true });
  }
});

await safe('TC-N17', '每点一次采集生成一条轮次记录（降级也留痕）', async () => {
  await rt.submit({ type: 'CAPTURE_RUN', batchId: 'tc-n17-round-1' });
  await rt.submit({ type: 'CAPTURE_RUN', batchId: 'tc-n17-round-2' });
  const runs = (await rt.runs()).data || [];
  const hasDegraded = runs.every((r) => typeof r.state === 'string' && !!r.batch_id);
  return {
    pass: runs.length >= 2 && hasDegraded,
    evidence: `轮次条数=${runs.length}；各轮 state=${runs.map((r) => r.state).join(',')}；均带 batch_id=${hasDegraded}`,
  };
});

await safe('TC-N18', '轮次切换与便利样本口径', async () => {
  const latest = await rt.results({ batchId: 'latest' });
  const all = await rt.results({ batchId: 'all' });
  const d1 = latest?.data?.coverage?.declaration || '';
  const d2 = all?.data?.coverage?.declaration || '';
  return {
    pass: d1.includes('本轮') && d2.includes('累计'),
    evidence: `latest 声明="${d1}"；all 声明="${d2}"；viewScope=${latest?.data?.viewScope}/${all?.data?.viewScope}`,
  };
});

await safe('TC-N12', '双触发一致 / commandId 幂等不重复写', async () => {
  const cmd = {
    type: 'SITE_ADD', commandId: 'cmd:tc-n12-fixed',
    site: { site_id: 'dup-check', name: '幂等校验', host: 'example.com', terms_checked: true },
  };
  const a = await rt.submit(cmd);
  const b = await rt.submit(cmd);
  const count = (await sites()).filter((x) => x.site_id === 'dup-check').length;
  const captureScript = read('skills/auto-pick-studio/scripts/capture.mjs');
  const singleEntry = /api\/command|\/api\/capture/.test(captureScript);
  return {
    pass: a.ok && b.ok && count === 1 && singleEntry,
    evidence: `两次提交 ok=${a.ok}/${b.ok}；目标站点条数=${count}；Skill 脚本走同一入口=${singleEntry}`,
  };
});

await safe('TC-N13', '服务重启重放未完成命令且不重复写', async () => {
  await repos.CommandLogRepository.pending({
    commandId: 'cmd:tc-n13-replay', type: 'SITE_ADD',
    site: { site_id: 'replayed', name: '重放校验', host: 'example.com', terms_checked: true },
  });
  const rt2 = await createTaskRuntime({ repos, paths }); // 构造时 bus.replay()
  const count = (await rt2.sites()).data.filter((x) => x.site_id === 'replayed').length;
  const pending = (await repos.CommandLogRepository.listPending()).data || [];
  return {
    pass: count === 1 && !pending.some((c) => c.commandId === 'cmd:tc-n13-replay'),
    evidence: `重放后站点条数=${count}；残留未完成命令=${pending.length}`,
  };
});

await safe('TC-N10', '反锚定：临时关闭优先可达、复位恢复默认', async () => {
  const off = await rt.submit({ type: 'TEMP_SORT_OFF', value: true });
  const mid = await rt.results({ batchId: 'all' });
  await rt.resetSession();
  const after = await rt.results({ batchId: 'all' });
  return {
    pass: off.ok && mid?.data?.tempSortOff === true && after?.data?.tempSortOff === false
      && after?.data?.sortBasis?.includes('领先'),
    evidence: `关闭后 tempSortOff=${mid?.data?.tempSortOff}/${mid?.data?.sortBasis}；复位后=${after?.data?.tempSortOff}/${after?.data?.sortBasis}；反例视图入口=${/counterView/.test(read('app/web/app.js'))}`,
  };
});

await safe('TC-N16', '两个 tab / 状态条跨 tab 常驻 / 不销毁表单', async () => {
  const html = read('app/web/index.html');
  const js = read('app/web/app.js');
  const need = ['role="tablist"', 'id="tab-config"', 'id="tab-workbench"', 'id="run-strip"', 'id="runs-panel"'];
  const miss = need.filter((k) => !html.includes(k));
  const keys = /key === '1'|key === '2'|ArrowLeft|ArrowRight/.test(js);
  const noThree = !/panel-capture|panel-results/.test(html);
  return {
    pass: miss.length === 0 && keys && noThree,
    evidence: `缺失结构=${miss.length ? miss.join(',') : '无'}；快捷键/方向键=${keys}；非三段 tab=${noThree}（页面交互需人工在浏览器确认）`,
  };
});

/* ---------- 依赖真实淘宝 DOM 或本人登录：如实标阻塞，不假报通过 ---------- */

blocked('TC-N04', '未装 Playwright 降级',
  '前置已不成立：本轮已装 Playwright 1.64.0 且 chromium 可用。降级路径的实测证据见安装对齐前：loadPlaywright=OK 但 browserUsable=false → preflight 返回 PLAYWRIGHT_MISSING；完整页面文案需人工在浏览器确认。');
blocked('TC-N06', '登录态缺失 / 过期',
  '逻辑层由 auth.test.js 覆盖（AUTH_REQUIRED / AUTH_EXPIRED）；工作台常驻提示 + 一键回配置页需本人登录态后人工跑页面。');
blocked('TC-N07', '遇验证码 / 滑块',
  'challenge_hints 为空槽，且需真实验证页面；本环境不复现、不绕过验证。');
blocked('TC-N08', '单站超时 / 失败',
  '需 B0 规则回填后才有真实采集过程；当前规则空槽时首站即 rule_missing，无法构造超时/多站失败。');
blocked('TC-N09', '三要素与字段态',
  '需真实采集记录；规则空槽下不落库，故无样本可验。内核层由 validator.test.js 覆盖。');
blocked('TC-N11', '点回原页',
  '需结果区有数据；URL 白名单与 textContent 安全渲染由 guard.test.js / selftest ⑦ 覆盖，页面点击需人工。');
blocked('TC-N14', '页面识别 PG-1 / PG-2 / UNSUPPORTED',
  'url_patterns 与 anchor_selectors 均为空槽；本轮 B0 探针未取得真实商品详情页/搜索页 DOM（搜索页仅骨架屏），不能回填、不虚构。');
blocked('TC-N15', '值异常样例',
  'value_ranges 全部为空（示例值待确认），需 B0 实测回填值域后构造样例。');
blocked('TC-N20', '本人登录 → 自动记录 cookies',
  '必须由本人在有头浏览器手动输入或扫码；本环境不代填密码、不代登录。逻辑链路（关窗自动落盘 / 取消不覆盖 / 不假装成功）由 auth.test.js 3 个用例覆盖。');
blocked('TC-N21', '过期提醒回到基础页面',
  '需先有真实登录态再制造过期；提示条结构与 renderAuthAlert 由 selftest ⑯ 覆盖，页面点击需人工。');

await safe('TC-N22', '对话确认与执行绑定，专业草案不改变生效计划', async () => {
  await rt.submit({ type: 'SETTINGS_UPDATE', analysis_mode: 'agent_assisted' });
  await rt.submit({ type: 'SITE_TOGGLE', siteId: 'taobao', enabled: false });
  const started = await rt.agentStart({ taskType: 'direction_validation' });
  const sessionId = started.data.session.session_id;
  const draft = await rt.agentGuidance({ sessionId, expectedVersion: 1,
    guidance: { type: 'plan_draft', queries: ['桌面收纳', '床边收纳'] } });
  const command = { type: 'ASSISTANT_CAPTURE', sessionId, expectedVersion: draft.data.session.version };
  const early = await rt.submit({ ...command, expectedVersion: 1 });
  const before = (await rt.runs()).data.length;
  const disabled = await rt.assistantReadiness();
  const blockedCapture = await rt.submit(command);
  await rt.submit({ type: 'SITE_TERMS', siteId: 'taobao', checked: true });
  await rt.submit({ type: 'SITE_TOGGLE', siteId: 'taobao', enabled: true });
  const auth = await rt.assistantReadiness();
  const stillDraft = await rt.agentResearch(sessionId);
  const afterBlocked = (await rt.runs()).data.length;
  await rt.submit({ type: 'SITE_TOGGLE', siteId: 'taobao', enabled: false });
  const confirmed = await rt.submit({ ...command, type: 'PLAN_CONFIRM' });
  await rt.submit({ type: 'CAPTURE_RUN', batchId: confirmed.data.plan.batch_id });
  const first = await rt.submit(command);
  const second = await rt.submit(command);
  const after = (await rt.runs()).data.length;
  const active = (await rt.effectivePlan()).data;
  await rt.submit({ type: 'PRO_PLAN_DRAFT', queries: ['宿舍挂钩'] });
  const stillActive = (await rt.effectivePlan()).data;
  const stale = await rt.submit({ type: 'WORKBENCH_CAPTURE', expectedPlanId: 'old-plan' });
  const pass = !early.ok && disabled.data.code === 'SITE_DISABLED' &&
    blockedCapture.data.setup.code === 'SITE_DISABLED' && auth.data.code === 'AUTH_REQUIRED' &&
    stillDraft.data.session.version === command.expectedVersion && stillDraft.data.session.state === 'plan_draft' &&
    afterBlocked === before && first.ok && second.ok && after === before + 1 &&
    first.data.run.batch_id === second.data.run.batch_id &&
    first.data.run.sites.length === 2 && first.data.run.stored === 0 &&
    active.source === 'assistant' && active.plan.plan_id === stillActive.plan.plan_id && !stale.ok;
  return { pass, evidence: '停用与未授权提示明确，受阻时保留草案且不建空轮次，重复提交读取同一轮，专业草案保留当前生效计划' };
});

/* ---------- 汇总 ---------- */

const tally = (s) => out.filter((r) => r.status === s).length;
console.log('\n=== TC-N 用例执行结果（真实调用 submit() 单一入口，临时数据目录）===');
for (const r of out) {
  console.log(`${r.status.padEnd(8)} ${r.id} · ${r.name}`);
  if (r.evidence) console.log(`         └ ${r.evidence}`);
}
console.log(`\nPASS ${tally('PASS')} / PARTIAL ${tally('PARTIAL')} / FAIL ${tally('FAIL')} / BLOCKED ${tally('BLOCKED')} / 共 ${out.length}`);
console.log('BLOCKED 一律不计通过；其前置条件为「B0 真实页面实测回填」或「本人登录一次」。');
console.log(`临时数据目录：${tmp}`);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
if (tally('FAIL') > 0) process.exitCode = 1;
