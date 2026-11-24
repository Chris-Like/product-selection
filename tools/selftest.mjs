/**
 * 分层 / 安全 / 口径自检：16 项，零第三方依赖。
 * 用法：node tools/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function check(name, fn) {
  try {
    const r = fn();
    if (r === false || typeof r === 'string') results.push({ name, ok: false, detail: String(r || '检查未通过') });
    else results.push({ name, ok: true, detail: '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e && e.message ? e.message : e) });
  }
}

function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', '.auth', '.git'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}
function filesUnder(rel) { return walk(path.join(ROOT, rel)); }
function sources(rel) { return filesUnder(rel).map((p) => ({ rel: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') })); }

const REQUIRED = [
  '.codex-plugin/plugin.json', '.app.json', '.gitignore', 'package.json', 'README.md',
  'skills/auto-pick-studio/SKILL.md', 'skills/auto-pick-studio/agents/openai.yaml',
  'skills/auto-pick-studio/references/scope.md',
  'skills/auto-pick-studio/scripts/start.mjs',
  'skills/auto-pick-studio/scripts/capture.mjs',
  'skills/auto-pick-studio/scripts/status.mjs',
  'hosts/workbuddy.md',
  'app/core/repository/interface.js', 'app/store/file-store.js',
  'app/collector/run.js', 'app/collector/driver.js', 'app/collector/auth.js', 'app/collector/extract.js',
  'app/server/index.js', 'app/server/router.js', 'app/server/task.js', 'app/server/static.js',
  'app/web/index.html', 'app/web/app.js', 'app/web/style.css',
  'app/config/site-rules/taobao.json', 'app/config/runtime.json',
  'tools/field-probe.mjs', 'tests/e2e/cases.mjs',
];

check('① 目录骨架文件齐全', () => {
  const missing = REQUIRED.filter((r) => !exists(r));
  return missing.length ? `缺 ${missing.join(', ')}` : true;
});

check('② 所有 JS/MJS 语法通过 node --check', () => {
  const bad = [];
  for (const p of walk(ROOT)) {
    try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
    catch (e) { bad.push(path.relative(ROOT, p)); }
  }
  return bad.length ? `语法失败：${bad.join(', ')}` : true;
});

check('③ app/core 零浏览器 API（chrome.* / browser.*）', () => {
  const bad = sources('app/core').filter((f) => /\b(chrome|browser)\.\w/.test(f.text)).map((f) => f.rel);
  return bad.length ? `残留：${bad.join(', ')}` : true;
});

check('④ app/core 不依赖 server / collector / web / store（依赖单向）', () => {
  const bad = sources('app/core').filter((f) => /\.\.\/(server|collector|web|store)\//.test(f.text)).map((f) => f.rel);
  return bad.length ? `越界引用：${bad.join(', ')}` : true;
});

check('⑤ app/store 只依赖 app/core，不碰 collector / server / web', () => {
  const bad = sources('app/store').filter((f) => /\.\.\/(collector|server|web)\//.test(f.text)).map((f) => f.rel);
  return bad.length ? `越界引用：${bad.join(', ')}` : true;
});

check('⑥ app/collector 不依赖 server / web；页面不引入 Node 模块', () => {
  const a = sources('app/collector').filter((f) => /\.\.\/(server|web)\//.test(f.text)).map((f) => f.rel);
  const b = sources('app/web').filter((f) => /from\s+['"]node:/.test(f.text)).map((f) => f.rel);
  return [...a, ...b].length ? `越界：${[...a, ...b].join(', ')}` : true;
});

check('⑦ 页面无 innerHTML / eval / document.write（唯一安全渲染入口）', () => {
  const bad = sources('app/web').filter((f) => /innerHTML|\beval\(|document\.write/.test(f.text)).map((f) => f.rel);
  return bad.length ? `不安全渲染：${bad.join(', ')}` : true;
});

check('⑧ 站点规则只含 B0 实测证据，未核对字段保持空槽', () => {
  const rule = JSON.parse(read('app/config/site-rules/taobao.json'));
  // B0 之前：必须全空槽，一个选择器都不许填
  if (rule.status === 'pending_b0_probe') {
    const selectors = Object.values(rule.field_selector_map || {}).flatMap((g) => Object.values(g));
    if (selectors.some(Boolean)) return '存在已填选择器，但尚未 B0 实测';
    if (Object.values(rule.anchor_selectors || {}).some((a) => a.length)) return '存在已填语义锚点';
    return true;
  }
  // B0 之后：每个已填字段都必须在实测证据登记表里，且阈值仍不得编造
  const ev = rule._probe_evidence;
  if (!ev || !Array.isArray(ev.samples) || !ev.samples.length) return '已回填但缺少 B0 实测证据登记';
  const confirmed = new Set(Object.keys(ev.fields_confirmed || {}));
  const filled = [];
  for (const [kind, group] of Object.entries(rule.field_selector_map || {})) {
    for (const [field, sel] of Object.entries(group || {})) {
      if (sel) filled.push(kind + '.' + field);
    }
  }
  const unregistered = filled.filter((k) => !confirmed.has(k));
  if (unregistered.length) return '存在无实测证据的选择器：' + unregistered.join(', ');
  if (Object.values(rule.value_ranges || {}).some((v) => v != null)) return '存在已填值域阈值（应待实测）';
  if (Object.values(rule.field_selector_map['PG-1'] || {}).some(Boolean)) return 'PG-1 未核对却已填选择器';
  return true;
});

check('⑨ 阈值标注「示例值，待确认」', () => {
  const r = JSON.parse(read('app/config/runtime.json'));
  return r._note && r._note.includes('示例值，待确认') ? true : 'runtime.json 缺少阈值占位声明';
});

check('⑩ .gitignore 覆盖数据 / 登录态 / 密钥', () => {
  const g = read('.gitignore');
  return ['data/', 'playwright/.auth/', 'node_modules/'].every((k) => g.includes(k)) ? true : '忽略项不全';
});

check('⑪ 双宿主 manifest 与 Skill 示例 prompt 齐备', () => {
  const skill = read('skills/auto-pick-studio/SKILL.md');
  const prompts = (skill.match(/^- 「/gm) || []).length;
  if (prompts < 2) return 'SKILL.md 示例 prompt 不足 2 条';
  JSON.parse(read('.codex-plugin/plugin.json'));
  JSON.parse(read('.app.json'));
  return true;
});

const { ERROR_CODES, describeError } = await import('../app/core/shared/errors.js');
check('⑫ 新形态错误码齐全且每条都有文案 + 可执行下一步', () => {
  const need = ['PLAYWRIGHT_MISSING', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'CAPTCHA_BLOCKED', 'SITE_TIMEOUT', 'NO_ENABLED_SITE', 'CAPTURE_RUNNING'];
  const missing = need.filter((c) => !ERROR_CODES.includes(c));
  if (missing.length) return `缺错误码：${missing.join(', ')}`;
  for (const c of ERROR_CODES) {
    const d = describeError(c, { site: '淘宝', field: '价格' });
    if (!d.message || !d.hint || !d.icon) return `${c} 文案不完整`;
    if (/系统繁忙|未知错误|操作失败/.test(d.message)) return `${c} 文案不合格`;
  }
  return true;
});

check('⑬ 工程内不引用归档目录、无 MV3 残留', () => {
  const all = [...walk(ROOT)];
  const bad = all.filter((p) => {
    if (p.endsWith(path.join('tools', 'selftest.mjs'))) return false; // 自检脚本自身的检测模式不算残留
    const t = fs.readFileSync(p, 'utf8');
    return /archive-mv3|chrome\.storage|manifest\.json/.test(t);
  }).map((p) => path.relative(ROOT, p));
  return bad.length ? `残留：${bad.join(', ')}` : true;
});

check('⑭ 两个 tab 与轮次切换结构齐备', () => {
  const html = read('app/web/index.html');
  const js = read('app/web/app.js');
  const need = ['role="tablist"', 'id="tab-config"', 'id="tab-workbench"', 'id="run-strip"', 'id="runs-panel"', 'id="scope-select"'];
  const miss = need.filter((k) => !html.includes(k));
  if (miss.length) return `缺 ${miss.join(', ')}`;
  if (!js.includes('currentScope') || !js.includes("q.set('batchId'")) return '页面缺少轮次切换逻辑';
  if (/panel-capture|panel-results/.test(html)) return '仍是三段 tab 结构';
  return true;
});

check('⑮ 轮次记录与批次过滤闭环', () => {
  const store = read('app/store/file-store.js');
  const contract = read('app/store/index.js');
  const router = read('app/server/router.js');
  const query = read('app/core/service/query.service.js');
  const run = read('app/collector/run.js');
  if (!store.includes('RunRepository') || !contract.includes('RunRepository')) return '缺轮次仓储契约';
  if (!router.includes('/api/runs') || !router.includes('batchId')) return '缺轮次接口';
  if (!query.includes('findByBatch') || !query.includes('累计便利样本')) return '缺批次过滤或视图口径';
  if (!run.includes('writeRun')) return '采集器未生成轮次记录';
  if (query.includes('本次自动采集到的便利样本')) return '仍写本次但查累计';
  return true;
});

check('⑯ 密码不录入/不落盘；登录态自动保存与过期提醒闭环', () => {
  const joined = [
    'app/web/index.html', 'app/web/app.js', 'app/store/file-store.js',
    'app/store/index.js', 'app/store/paths.js', 'app/server/task.js',
    'app/server/router.js', 'app/collector/auth.js', 'app/collector/run.js',
  ].map((p) => read(p)).join('\n');
  if (/type="password"|credentials\.enc|CredentialRepository|loadOrCreateMasterKey|CRED_DISABLE_ALL/.test(joined)) {
    return '仍有密码录入或落盘链路';
  }
  const auth = read('app/collector/auth.js');
  const html = read('app/web/index.html');
  const js = read('app/web/app.js');
  const run = read('app/collector/run.js');
  if (!auth.includes('storageStateExpired') || !auth.includes('beginLogin') || !auth.includes('looksLikeLoginRequired')) {
    return '登录态自动保存或过期检测不完整';
  }
  if (!run.includes("'auth_expired'") || !html.includes('id="auth-alert"') || !js.includes('renderAuthAlert')) {
    return '过期提醒未落到基础页面';
  }
  if (!js.includes('login_url') || !html.includes('name="login_url"')) return '配置页缺登录入口维护';
  return true;
});

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
