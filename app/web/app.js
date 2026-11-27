/**
 * 页面逻辑：零构建、零依赖；动态文本一律走 lib/render.js 的 el / renderCell。
 * 工作台按任务、结果、数据源和配置切换视图。轮次和助手需求卡可直接打开。
 */
import { el, renderCell, clearNode } from './lib/render.js';
import { createResultChart } from './lib/result-chart.js';

const $ = (id) => document.getElementById(id);
let counterView = false;
let pollTimer = null;
let badgeTimer = null;
let currentScope = 'latest';
let runsCache = [];
let authStatesCache = {};
let authPollTimer = null;
let sessionToken = '';
let analysisMode = 'agent_assisted';
let activePlan = null;
let pendingDraft = null;
let savedProfessionalDraft = null;
let savedProfessionalPlanId = null;
let draftEdited = false;
let captureSubmitting = false;
let captureRunning = false;
let displayedTask = '';
let factsRequest = 0;
let resultRequest = 0;
let evidenceFilter = null;
let resultRows = [];
let resultPage = 1;
let resultPageSize = 20;
let resultFilterKey = '';
const updateResultChart = createResultChart($('result-chart'));
const updateProductChart = createResultChart($('product-chart'));
const returnSession = new URLSearchParams(location.search).get('assistant');
let effectivePlanLoaded = false;
let researchSession = null;
const workspaceTitles = { tasks: '选品任务', results: '商品结果', 'retail-research': '国内零售',
  'fastmoss-research': 'FastMoss 趋势', 'linkfox-research': 'LinkFox 选品与货源', config: '基础配置' };
let workspaceView = 'tasks';
const POLL_MS = 1000; // 示例值，待确认
const AUTH_POLL_MAX = 60; // 示例值，待确认：登录窗口状态轮询最多 60 次

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (['POST', 'PATCH', 'DELETE'].includes(options.method || 'GET')) headers['x-auto-pick-token'] = sessionToken;
  const init = { ...options, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const r = await fetch(path, init);
  return r.json();
}
const post = (p, body = {}) => api(p, { method: 'POST', body });

let toastTimer;
function toast(text) {
  const n = $('toast');
  n.textContent = String(text || '');
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove('show'), 5000);
}
function report(r, okText) {
  if (!r) return;
  if (r.ok === false) toast(`${r.message || '这一步没走通'} · ${r.hint || ''}`);
  else if (okText) toast(okText);
  else if (r.message) toast(r.message);
}
function tag(text, kind = '') {
  return el('span', { class: `tag ${kind}`, text });
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString('zh-CN', { hour12: false });
}
function showBadge(text) {
  const b = $('tab-badge');
  b.textContent = text;
  b.classList.remove('hidden');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => b.classList.add('hidden'), 5000);
}

function renderAnalysisMode() {
  const local = $('mode-local');
  const agent = $('mode-agent');
  if (!local || !agent) return;
  local.checked = analysisMode === 'local_only';
  agent.checked = analysisMode === 'agent_assisted';
  $('analysis-mode-note').textContent = analysisMode === 'agent_assisted'
    ? 'Agent 协作已启用：请直接在 Codex 或 WorkBuddy 对话中开始选品任务。'
    : '当前为纯本机模式：网页只负责采集与结果，不提供 AI 对话。';
}

async function loadEffectivePlan() {
  const r = await api('/api/effective-plan');
  if (!r.ok) return;
  const unchanged = effectivePlanLoaded && activePlan?.plan_id === r.data?.plan?.plan_id;
  activePlan = r.data?.plan ?? null;
  effectivePlanLoaded = true;
  $('btn-capture').disabled = !activePlan || captureSubmitting || captureRunning;
  if (unchanged) return;
  const box = $('plan-summary');
  clearNode(box);
  if (activePlan?.units?.length) {
    box.append(el('strong', { text: activePlan.units.map((unit) => unit.keyword || '默认入口').join(' / ') }),
      el('div', { class: 'footnote', text: `已确认 · 来源：${r.data.source === 'assistant' ? '智能选品助手' : '专业工作台'}` }));
    if (activePlan.max_price != null) {
      box.append(el('div', { class: 'footnote', text: `预算上限 ${activePlan.max_price} 元 · 采后统计` }));
    }
    const details = el('details', {}, [el('summary', { text: '查看采集范围' })]);
    for (const unit of activePlan.units) {
      details.append(el('div', { text: `${unit.site_id} · 第 ${unit.page} 页` }), el('code', { text: unit.entry_url }));
    }
    box.append(details);
  } else {
    box.textContent = '暂无已确认的计划。编辑并确认一份计划，即可开始采集。';
  }
}

function taskLabel(type) {
  return type === 'opportunity_discovery' ? '找机会' : type === 'candidate_follow_up' ? '跟踪候选' : '验证方向';
}

async function loadResearchStatus() {
  const r = await api(returnSession ? `/api/assistant-guide/${encodeURIComponent(returnSession)}` : '/api/research/latest');
  const payload = r.ok ? r.data : null;
  researchSession = payload?.session || null;
  const localDraft = localStorage.getItem('auto-pick-assistant-draft:new');
  const assistant = returnSession || (!localDraft && payload?.draft?.requirements ? researchSession?.session_id : null);
  const returnLink = $('return-to-assistant');
  returnLink.href = assistant ? `/assistant.html?session=${encodeURIComponent(assistant)}` : '/assistant.html';
  const taskCard = $('linked-task');
  taskCard.hidden = !returnSession || !payload?.draft?.requirements;
  if (!taskCard.hidden) {
    $('linked-task-title').textContent = payload.draft.requirements_summary || payload.draft.requirements;
    let picked = [];
    try { picked = Object.keys(JSON.parse(localStorage.getItem(`auto-pick-assistant-selection:${returnSession}`) || '{}')); }
    catch { /* 旧卡片没有勾选记录 */ }
    const count = payload.draft.recommendations?.length;
    $('linked-task-meta').textContent = [payload.draft.max_price == null ? '预算不限' : `预算上限 ¥${payload.draft.max_price}`,
      count ? `已选 ${payload.run?.plan_units?.length ?? payload.draft.recommendations.filter(({ name }) => picked.includes(name)).length} / ${count} 项` : null,
      payload.run ? STATE_TEXT[payload.run.state] || payload.run.state : '待采集'].filter(Boolean).join(' · ');
    const actions = $('linked-task-actions');
    const batch = payload.run?.batch_id;
    const action = batch ? resultUrl(batch) : returnLink.href;
    if (actions.firstElementChild?.getAttribute('href') !== action) {
      clearNode(actions);
      actions.append(el('a', { href: action, class: 'host-launch', text: batch ? '查看本轮结果' : '继续助手任务' }));
    }
  }
  const state = $('agent-task-state');
  const detail = $('agent-task-detail');
  if (!researchSession) {
    state.textContent = '暂无进行中的 AI 选品任务'; detail.textContent = ''; return;
  }
  const label = taskLabel(researchSession.task_type);
  const text = {
    agent_pending: '等待宿主 AI 在对话中继续引导',
    questioning: '等待你在宿主对话中回答',
    requirements_ready: '需求已整理，等待预览搜索词',
    plan_draft: '计划草案等待你在对话中确认',
    plan_confirmed: '计划已在对话中确认',
  }[researchSession.state] || researchSession.state;
  state.textContent = `当前任务：${label} · ${text}`;
  detail.textContent = researchSession.current_turn?.question ? `当前问题：${researchSession.current_turn.question}` : '';
}

function fillProfessionalDraft(draft) {
  if (!draft) return;
  $('pro-queries').value = (draft.queries || []).join('\n');
  $('pro-focus-scene').value = draft.focus_scene || '';
  $('pro-max-price').value = draft.max_price ?? '';
  $('pro-signal-watch').value = draft.signal_watch || '';
  $('pro-falsifier').value = draft.falsifier || '';
  $('pro-coverage-mode').value = draft.coverage_mode || 'single_query_exploration';
}

async function loadProfessionalPlan() {
  const r = await api('/api/professional-plan');
  if (!r.ok) return;
  const { draft, confirmed } = r.data || {};
  savedProfessionalDraft = draft;
  savedProfessionalPlanId = confirmed?.plan_id ?? null;
  pendingDraft = draft && draft.draft_id !== confirmed?.draft_id ? draft : null;
  if (pendingDraft || !activePlan) fillProfessionalDraft(draft);
  $('btn-pro-plan-confirm').disabled = !pendingDraft;
  $('pro-plan-state').textContent = pendingDraft ? '草案未生效，等待确认' : '修改后可生成新的草案';
}

async function draftProfessionalPlan() {
  const queries = $('pro-queries').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const r = await post('/api/professional-plan/draft', {
    queries, focus_scene: $('pro-focus-scene').value, signal_watch: $('pro-signal-watch').value,
    max_price: $('pro-max-price').valueAsNumber || null,
    falsifier: $('pro-falsifier').value, coverage_mode: $('pro-coverage-mode').value,
  });
  if (!r.ok) { report(r); return; }
  pendingDraft = r.data;
  savedProfessionalDraft = r.data;
  draftEdited = false;
  fillProfessionalDraft(pendingDraft);
  $('btn-pro-plan-confirm').disabled = false;
  $('pro-plan-state').textContent = '草案未生效，请检查后确认';
}

async function confirmProfessionalPlan() {
  if (!pendingDraft || draftEdited) return;
  const r = await post('/api/professional-plan/confirm', { expectedVersion: pendingDraft.version, siteId: 'taobao' });
  if (!r.ok) { report(r); return; }
  pendingDraft = null;
  savedProfessionalPlanId = r.data.plan.plan_id;
  $('btn-pro-plan-confirm').disabled = true;
  $('pro-plan-state').textContent = '专业计划已生效';
  await loadEffectivePlan();
}

async function loadFacts(batchId) {
  const request = ++factsRequest;
  const box = $('facts-content');
  clearNode(box);
  if (!batchId) {
    showProductChart([]);
    const entries = currentScope === 'all' ? runsCache.slice(-8).reverse().map((run) => ({
      label: batchLabel(run.batch_id), value: run.stored || 0, batch: run.batch_id,
    })) : [];
    showResultChart('各轮采集条数', '最近 8 轮以内的入库观察。点击条形查看对应轮次。', entries, (entry) => setScope(entry.batch));
    return;
  }
  const r = await api(`/api/facts?batchId=${encodeURIComponent(batchId)}`);
  if (request !== factsRequest) return;
  const facts = r.data;
  if (!facts?.raw_observation_count && !facts?.queries?.length) {
    showResultChart('', '', []);
    showProductChart([]);
    return;
  }
  const price = facts.price ? `价格展示值：${facts.price.min} ~ ${facts.price.max}（${facts.price.count} 条）` : '价格展示值：未获取';
  const missing = facts.missing_fields?.length ? `缺失字段：${facts.missing_fields.join('、')}` : '关键缺失字段：无';
  box.append(el('p', { class: 'hint', text: `共 ${facts.raw_observation_count} 条观察 · ${price} · ${missing}` }));
  async function selectEvidence(query = null, budgetGroup = null, budgetLabel = '') {
    evidenceFilter = query || budgetGroup ? { batchId, queryId: query?.query_id, keyword: query?.keyword, budgetGroup, budgetLabel } : null;
    if (counterView) {
      counterView = false;
      $('btn-counter').textContent = '反例视图';
    }
    await loadResults();
    if (evidenceFilter) $('btn-clear-evidence').focus({ preventScroll: true });
  }
  function detailButton(text, query = null, budgetGroup = null, budgetLabel = '') {
    return el('button', { type: 'button', class: 'ghost', text, onclick: () => selectEvidence(query, budgetGroup, budgetLabel) });
  }
  function budgetButtons(budget, query = null) {
    const groups = [
      ['at_or_below', `${budget.max_price} 元及以内`],
      ['above', '超预算'],
      ['unavailable', '无可比价格'],
    ];
    const controls = el('div', { class: 'evidence-options' });
    for (const [group, label] of groups) {
      controls.append(detailButton(`${label} ${budget[group]} 条`, query, group, label));
    }
    return controls;
  }
  const queries = facts.queries || [];
  showProductChart(queries, (query) => selectEvidence(query));
  if (facts.budget && facts.raw_observation_count) {
    const groups = [
      { key: 'at_or_below', label: '预算内', color: '#1677ff' },
      { key: 'above', label: '超预算', color: '#fa8c16' },
      { key: 'unavailable', label: '无可比价格', color: '#8c8c8c' },
    ].map((group) => ({ ...group, value: facts.budget[group.key] }));
    showResultChart('预算分布', `本轮预算上限 ¥${facts.budget.max_price}。按页面展示价统计观察条数。`, groups,
      ({ key, label }) => selectEvidence(null, key, label));
  } else {
    showResultChart('', '', []);
  }
  for (const query of queries) {
    box.append(el('div', { class: 'row' }, [
      el('strong', { class: 'grow', text: `${query.keyword} · ${query.raw_observation_count} 条观察` }),
      detailButton('查看明细', query),
      query.budget ? budgetButtons(query.budget, query) : el('span', { class: 'footnote', text: query.price
        ? `展示价 ${query.price.min}–${query.price.max} 元` : '暂无可比价格' }),
    ]));
  }
  if (facts.unattributed_observations && facts.queries?.length) {
    box.append(el('div', { class: 'footnote', text: `${facts.unattributed_observations} 条旧观察缺少查询归属，计入本轮合计。` }));
  }
  box.append(el('p', { class: 'hint', text: facts.declaration }));
}

function showProductChart(queries, select) {
  const panel = $('product-chart-panel');
  const picker = $('product-chart-select');
  panel.hidden = !queries.length;
  const entries = queries.map((query) => ({ label: query.keyword || '默认入口', value: query.raw_observation_count || 0, query }));
  clearNode(picker);
  picker.append(el('option', { value: '', text: '全部商品方向' }));
  for (const { label, value, query } of entries) {
    const status = ['done', 'unknown'].includes(query.status) ? '' : ` · ${STATE_TEXT[query.status] || '未完成'}`;
    picker.append(el('option', { value: query.query_id, text: `${label} · ${value} 条${status}` }));
  }
  picker.value = evidenceFilter?.queryId || '';
  picker.onchange = () => select?.(queries.find((query) => query.query_id === picker.value) || null);
  updateProductChart(entries, ({ query }) => select(query));
}

function showResultChart(title, note, entries, select) {
  $('result-chart-panel').hidden = !entries.length;
  $('result-chart-title').textContent = title;
  $('result-chart-note').textContent = note;
  const filters = $('result-chart-filters');
  clearNode(filters);
  for (const entry of entries) {
    filters.append(el('button', { type: 'button', class: 'ghost', text: `${entry.label} ${entry.value} 条`, onclick: () => select(entry) }));
  }
  updateResultChart(entries, select);
}

function resultUrl(batch) {
  const url = new URL(location.href);
  url.searchParams.delete('view');
  if (batch === 'latest') url.searchParams.delete('batch');
  else url.searchParams.set('batch', batch);
  url.hash = 'results';
  return `${url.pathname}${url.search}${url.hash}`;
}

function showWorkspace(view, updateUrl = true) {
  const isConfig = view === 'config';
  const previous = workspaceView;
  workspaceView = view;
  if (updateUrl) {
    const url = new URL(view === 'results' ? resultUrl(currentScope) : location.href, location.href);
    url.searchParams.delete('view');
    url.hash = view;
    if (url.href !== location.href) history.pushState(null, '', url);
  }
  $('workspace-title').textContent = workspaceTitles[view];
  $('panel-config').hidden = !isConfig;
  $('panel-workbench').hidden = isConfig;
  $('tab-config').classList.toggle('active', isConfig);
  $('tab-workbench').classList.toggle('active', !isConfig);
  $('tab-config').setAttribute('aria-selected', String(isConfig));
  $('tab-workbench').setAttribute('aria-selected', String(!isConfig));
  for (const section of document.querySelectorAll('[data-workspace-view]')) section.hidden = section.dataset.workspaceView !== view;
  for (const link of document.querySelectorAll('[data-workspace-link]')) {
    if (link.dataset.workspaceLink === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'retail-research') void loadRetailView();
  if (view === 'fastmoss-research' || view === 'linkfox-research') void loadProviderReports(view.split('-')[0]);
  if (previous !== view && updateUrl) window.scrollTo(0, 0);
}

function switchTab(name) {
  showWorkspace(name === 'config' ? 'config' : 'tasks');
}

function restoreWorkspace() {
  const params = new URLSearchParams(location.search);
  const hash = location.hash.slice(1);
  const view = params.get('view') === 'config' ? 'config'
    : Object.hasOwn(workspaceTitles, hash) ? hash
      : params.has('batch') ? 'results' : params.has('report') || hash === 'external-research' ? 'retail-research' : 'tasks';
  currentScope = params.get('batch') || 'latest';
  evidenceFilter = null;
  showWorkspace(view, false);
}

const AUTH_LABEL = {
  valid: '已登录', logging_in: '登录中', expired: '登录已过期',
  unknown: '未登录', captcha_blocked: '需人工验证',
};

async function loadSites() {
  const r = await api('/api/sites');
  const box = $('site-list');
  clearNode(box);
  const list = r.data || [];
  if (!list.length) {
    box.appendChild(el('div', { class: 'hint', text: '还没有站点。新增一个、勾选「已核验条款」后手动启用；这里不需要录入密码。' }));
    return;
  }
  for (const s of list) {
    const account = el('input', { value: s.account_label || '', placeholder: '账户标识', 'aria-label': '账户标识' });
    const loginUrl = el('input', { value: s.login_url || '', placeholder: '登录页地址（留空打开站点首页）', 'aria-label': '登录页地址' });
    const terms = el('input', { type: 'checkbox', 'aria-label': '已核验条款' });
    terms.checked = Boolean(s.terms_checked);
    const st = s.auth_status || 'unknown';
    const needAuth = st === 'expired' || st === 'captcha_blocked';
    const authKind = st === 'valid' ? 'ok' : needAuth ? 'warn' : '';

    const row = el('div', {
      class: `row site-row${needAuth ? ' attention' : ''}`,
      id: `site-row-${s.site_id}`,
      ...(needAuth ? { tabindex: '0' } : {}),
    }, [
      el('span', { class: 'grow', text: `${s.name}（${s.site_id}）` }),
      el('span', { class: 'footnote', text: s.host }),
      tag(s.enabled ? '已启用' : '已停用', s.enabled ? 'ok' : ''),
      tag(`登录态：${AUTH_LABEL[st] || st}`, authKind),
      el('label', { class: 'footnote' }, [terms, ' 已核验']),
      account,
      loginUrl,
      el('button', {
        class: 'ghost', text: '保存',
        onclick: async () => {
          const out = await post('/api/command', {
            type: 'SITE_UPDATE', siteId: s.site_id,
            patch: { account_label: account.value, login_url: loginUrl.value, terms_checked: terms.checked },
          });
          report(out, '已保存');
          await loadSites();
        },
      }),
      el('button', {
        class: 'ghost', text: s.enabled ? '停用' : '启用',
        onclick: async () => {
          const out = await post('/api/command', { type: 'SITE_TOGGLE', siteId: s.site_id, enabled: !s.enabled });
          report(out);
          await loadSites();
        },
      }),
      el('button', {
        class: 'ghost', text: needAuth ? '重新登录授权' : '登录',
        onclick: async () => {
          const out = await post(`/api/sites/${encodeURIComponent(s.site_id)}/auth`, {});
          report(out, '已打开浏览器窗口，请本人在里面登录或扫码；登录后关掉窗口即可自动保存');
          if (out.ok) startAuthPoll();
          await loadSites(); await loadState();
        },
      }),
      el('button', {
        class: 'ghost', text: '确认已登录',
        onclick: async () => {
          const out = await post(`/api/sites/${encodeURIComponent(s.site_id)}/auth/finish`, {});
          report(out, '登录态（cookies）已保存到本机');
          await loadSites(); await loadState();
        },
      }),
      el('button', {
        class: 'ghost', text: '取消登录',
        onclick: async () => {
          const out = await post(`/api/sites/${encodeURIComponent(s.site_id)}/auth/cancel`, {});
          report(out, '已取消本次登录，原有登录态未改动');
          await loadSites(); await loadState();
        },
      }),
      el('button', {
        class: 'ghost danger', text: '删除',
        onclick: async () => {
          const out = await post('/api/command', { type: 'SITE_REMOVE', siteId: s.site_id });
          report(out, '已移入可恢复区，点「恢复」或按 Ctrl/⌘+Z 可救回');
          await loadSites();
        },
      }),
    ]);
    box.appendChild(row);
  }
}

/** 过期提醒：跨 tab 常驻，点按钮直接回配置页并聚焦需授权的站点行。 */
function renderAuthAlert() {
  const names = new Map();
  for (const [id, st] of Object.entries(authStatesCache)) {
    if (st && (st.status === 'expired' || st.status === 'captcha_blocked')) names.set(id, st.site_id || id);
  }
  const last = runsCache[runsCache.length - 1];
  for (const s of last?.sites || []) {
    if (s.status === 'auth_expired' || s.status === 'auth_required') names.set(s.site_id, s.name || s.site_id);
  }
  const box = $('auth-alert');
  if (!names.size) { box.classList.add('hidden'); return; }
  $('auth-alert-text').textContent = `${[...names.values()].join('、')} 的登录态需要重新授权。请到「配置」页点该站的「登录」，本人在打开的浏览器里登录一次；工具不保存、不代填密码。`;
  box.classList.remove('hidden');
}

/** 登录窗口期间的轻量状态轮询；窗口结束或到上限即停止，不构成后台自动采集。 */
function startAuthPoll() {
  if (authPollTimer) return;
  let n = 0;
  authPollTimer = setInterval(async () => {
    n += 1;
    await loadState();
    const loggingIn = Object.values(authStatesCache).some((s) => s.status === 'logging_in');
    if (!loggingIn || n >= AUTH_POLL_MAX) {
      clearInterval(authPollTimer);
      authPollTimer = null;
      await loadSites();
    }
  }, 2000); // 示例值，待确认
}

const STATE_TEXT = {
  idle: '待运行', running: '运行中', partial: '部分失败', done: '完成', stopped: '已停止',
  pending: '排队中', disabled: '已跳过', auth_required: '未登录',
  auth_expired: '登录已过期', logging_in: '登录中',
  rule_missing: '规则未回填', captcha_blocked: '已暂停（验证）', failed: '未成功',
  not_started: '未开始',
};

function renderProgress(task) {
  displayedTask = taskKey(task);
  captureRunning = task?.state === 'running';
  $('btn-capture').disabled = !activePlan || captureSubmitting || captureRunning;
  $('btn-stop').disabled = !captureRunning;
  const text = STATE_TEXT[task?.state] || task?.state || '待运行';
  $('task-chip').textContent = text;
  $('task-chip').dataset.state = task?.state || '';
  const resultLink = $('task-results-link');
  resultLink.hidden = !task?.batch_id || task.state === 'running';
  if (!resultLink.hidden) resultLink.href = resultUrl(task.batch_id);
  if (task?.state === 'running') {
    const b = $('tab-badge');
    b.textContent = '运行中';
    b.classList.remove('hidden');
  }
  const box = $('task-progress');
  clearNode(box);
  if (task?.state === 'running' && task.sites?.length) {
    const processed = task.sites.filter((site) => !['pending', 'running'].includes(site.status)).length;
    box.append(el('p', { class: 'hint', text: `已处理 ${processed} 个搜索词，继续采集中。` }));
  }
  for (const s of task?.sites || []) {
    box.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'grow', text: [s.name || s.site_id, s.keyword].filter(Boolean).join(' · ') }),
      tag(STATE_TEXT[s.status] || s.status, s.status === 'done' ? 'ok' : (s.status === 'failed' || s.status === 'captcha_blocked') ? 'warn' : ''),
      el('span', { class: 'footnote', text: s.reason || '' }),
      s.stored != null ? el('span', { class: 'footnote', text: `入库 ${s.stored} 条` }) : null,
    ]));
  }
  $('task-message').textContent = task?.message || '';
}

function taskKey(task) {
  return [task?.batch_id, task?.state, task?.ended_at].join('|');
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const r = await api('/api/capture/status');
    if (r.ok) {
      renderProgress(r.data);
      if (r.data.state !== 'running') {
        stopPoll();
        await loadRuns();
        await loadResults();
        showBadge('本轮已更新');
      }
    }
  }, POLL_MS);
}

async function loadState() {
  try {
    const r = await api('/api/state');
    if (!r.ok) { $('service-state').textContent = '本机服务未就绪'; return; }
    $('service-state').textContent = `本机服务已连接 · schema ${r.data.schemaVersion}`;
    authStatesCache = r.data.authStates || {};
    analysisMode = r.data.analysis_mode || 'agent_assisted';
    renderAnalysisMode();
    await loadResearchStatus();
    renderAuthAlert();
    renderProgress(r.data.task);
    if (r.data.running) startPoll(); else stopPoll();
  } catch {
    $('service-state').textContent = '本机服务未启动';
  }
}

function scopeLabel() {
  if (currentScope === 'latest') return '本轮';
  if (currentScope === 'all') return '累计';
  const i = runsCache.findIndex((r) => r.batch_id === currentScope);
  return i >= 0 ? `第 ${i + 1} 轮` : '历史轮次';
}
function batchLabel(id) {
  const i = runsCache.findIndex((r) => r.batch_id === id);
  return i >= 0 ? `#${i + 1}` : '—';
}
function updateScopeButtons() {
  for (const scope of ['latest', 'all']) {
    const button = $(`scope-${scope}`);
    button.setAttribute('aria-pressed', String(currentScope === scope));
    button.classList.toggle('active', currentScope === scope);
  }
  $('scope-select').value = (currentScope === 'latest' || currentScope === 'all') ? '' : currentScope;
}

async function setScope(scope) {
  evidenceFilter = null;
  currentScope = scope;
  if (workspaceView === 'results') history.replaceState(null, '', resultUrl(scope));
  updateScopeButtons();
  await loadResults();
  await loadRuns();
}

async function loadRuns() {
  const r = await api('/api/runs');
  runsCache = r.data || [];
  renderAuthAlert();
  $('runs-count').textContent = String(runsCache.length);
  const latest = runsCache[runsCache.length - 1];
  const selected = currentScope === 'latest' ? latest : runsCache.find((run) => run.batch_id === currentScope);
  await loadFacts(selected?.batch_id);

  const sel = $('scope-select');
  clearNode(sel);
  sel.appendChild(el('option', { value: '', text: '选择轮次' }));
  const newestFirst = runsCache.slice().reverse();
  for (let i = 0; i < newestFirst.length; i += 1) {
    const run = newestFirst[i];
    const n = runsCache.length - i;
    sel.appendChild(el('option', {
      value: run.batch_id,
      text: `#${n} · ${fmtTime(run.started_at)} · ${STATE_TEXT[run.state] || run.state} · ${run.stored || 0} 条`,
    }));
  }
  updateScopeButtons();

  const box = $('run-list');
  clearNode(box);
  if (!runsCache.length) {
    box.appendChild(el('div', { class: 'hint', text: '点一次「采集」就会生成一条记录，失败或未开始也会留痕。' }));
    return;
  }
  for (let i = 0; i < newestFirst.length; i += 1) {
    const run = newestFirst[i];
    const n = runsCache.length - i;
    const isCurrent = currentScope === run.batch_id || (currentScope === 'latest' && i === 0);
    const siteSummary = (run.sites || [])
      .map((s) => `${s.name || s.site_id}：${STATE_TEXT[s.status] || s.status}`)
      .join(' · ');
    const row = el('div', {
      class: `row run-row${isCurrent ? ' current' : ''}`,
      title: '查看这轮采集结果',
      role: 'button',
      tabindex: '0',
    }, [
      el('span', { class: 'grow', text: `#${n} · ${fmtTime(run.started_at)}` }),
      tag(STATE_TEXT[run.state] || run.state || '未开始', run.state === 'done' ? 'ok' : (run.state === 'partial' || run.state === 'not_started') ? 'warn' : ''),
      el('span', { class: 'footnote', text: `${run.stored || 0} 条` }),
      el('span', { class: 'footnote', text: siteSummary || run.message || '' }),
    ]);
    const pick = () => {
      history.pushState(null, '', resultUrl(run.batch_id));
      showWorkspace('results', false);
      window.scrollTo(0, 0);
      void setScope(run.batch_id);
    };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    box.appendChild(row);
  }
}

async function loadResults() {
  const request = ++resultRequest;
  const q = new URLSearchParams();
  if (counterView) q.set('counterView', '1');
  q.set('batchId', currentScope);
  if (evidenceFilter) {
    q.set('evidenceBatch', evidenceFilter.batchId);
    if (evidenceFilter.queryId) q.set('evidenceQuery', evidenceFilter.queryId);
    if (evidenceFilter.budgetGroup) q.set('evidenceBudget', evidenceFilter.budgetGroup);
  }
  const r = await api(`/api/results?${q.toString()}`);
  if (request !== resultRequest || !r.ok) return;
  const filterKey = q.toString();
  if (filterKey !== resultFilterKey) resultPage = 1;
  resultFilterKey = filterKey;
  const d = r.data || {};
  if (evidenceFilter?.batchId !== d.activeBatchId) evidenceFilter = null;
  $('product-chart-select').value = evidenceFilter?.queryId || '';
  const cov = d.coverage || {};
  const counts = d.counts || { scope: 0, all: 0, latest: 0 };
  $('latest-count').textContent = String(counts.latest ?? 0);
  $('all-count').textContent = String(counts.all ?? 0);
  $('result-chip').textContent = `${scopeLabel()} ${counts.scope ?? 0} 条`;
  const activeRun = runsCache.find((x) => x.batch_id === d.activeBatchId);
  renderRunOutcome(activeRun, counts.scope);
  const plannedQueries = activeRun?.plan_units?.length ? activeRun.plan_units : null;
  const finishedQueries = activeRun?.sites?.filter((site) => site.query_id && site.status === 'done') || [];
  $('scope-note').textContent = activeRun
    ? `${fmtTime(activeRun.started_at)} 开始 · ${activeRun.stored || 0} 条入库`
    : (currentScope === 'all' ? '跨轮次汇总，每行都标了轮次' : '还没有采集记录');
  $('coverage').textContent = [
    `视图：${scopeLabel()}`,
    `覆盖：${cov.site || '未知'}`,
    plannedQueries ? `已完成查询：${finishedQueries.map((site) => site.keyword || '默认入口').join(' / ') || '无'}（${finishedQueries.length}/${plannedQueries.length}）` : `关键词批次：${cov.keywords ?? '未知'}`,
    plannedQueries ? `已完成页数：${finishedQueries.length}` : `页数：${cov.pages ?? '未知'}`,
    `时间范围：${cov.time_span ? cov.time_span.join(' ~ ') : '未知'}`,
    `样本量：${cov.record_count ?? 0}`,
    cov.declaration || '',
    `排序：${d.sortBasis || '未知'}`,
    '经验信号、非预测结论',
  ].join(' · ');

  resultRows = d.rows || [];
  $('evidence-controls').classList.toggle('hidden', !evidenceFilter);
  if (evidenceFilter) {
    const label = [evidenceFilter.keyword || '所有检索方向', evidenceFilter.budgetLabel].filter(Boolean).join(' · ');
    $('evidence-status').textContent = `${label} · 当前可见 ${resultRows.length} 条`;
  }
  renderResultTable();
}

function renderResultTable() {
  const box = $('result-list');
  clearNode(box);
  renderResultPagination();
  if (!resultRows.length) {
    if (evidenceFilter) box.append(el('div', { class: 'hint', text: '这组条件下暂无可见观察。' }));
    else if (counterView) box.append(el('div', { class: 'hint', text: '当前视图没有可展示的反例，可返回全部样本。' }));
    else box.append(el('div', { class: 'workspace-empty', text: '本视图暂无商品。可切换历史轮次，或在选品任务发起采集。' }));
    return;
  }
  const first = (resultPage - 1) * resultPageSize;
  const rows = resultRows.slice(first, first + resultPageSize);
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: '商品' }), el('th', { text: '展示价', class: 'price-column' }),
    el('th', { text: '来源' }), el('th', { text: '轮次' }), el('th', { text: '操作' }),
  ])]));
  const tbody = el('tbody');
  for (const row of rows) {
    const s = row.snapshot;
    const isLead = Boolean(row.projection?.is_lead_marker);
    const tr = el('tr', {}, [
      el('td', {}, [el('button', { class: 'product-link', text: s.title || '未取得商品标题', onclick: () => openProductDrawer(s) }),
        isLead ? tag('领先标的', 'ok') : null]),
      renderCell('td', s.price ?? '未获取', { class: `price-column ${s.field_status?.price === '值异常' ? 'abnormal' : ''}` }),
      renderCell('td', s.shop_name || s.site_id || '未获取'),
      renderCell('td', batchLabel(s.batch_id)),
      el('td', {}, [
        el('button', {
          class: 'ghost', text: isLead ? '取消打标' : '打标',
          onclick: async () => {
            const out = await post('/api/marker', {
              type: 'MARKER_SET', fingerprintId: row.fingerprintId, unset: isLead,
            });
            report(out, isLead ? '已取消打标' : '已标为领先标的');
            await loadResults();
          },
        }),
      ]),
    ]);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
  box.appendChild(el('div', { class: 'footnote', text: '「展示销量」是页面展示值，不等于真实销量；采购量也不等于销量。' }));
}

function renderResultPagination() {
  const nav = $('result-pagination');
  clearNode(nav);
  nav.hidden = !resultRows.length;
  if (nav.hidden) return;
  const pageCount = Math.ceil(resultRows.length / resultPageSize);
  resultPage = Math.min(resultPage, pageCount);
  const first = (resultPage - 1) * resultPageSize + 1;
  const range = el('span', { class: 'footnote', role: 'status', text: `第 ${first}–${Math.min(first + resultPageSize - 1, resultRows.length)} 条，共 ${resultRows.length} 条` });
  const go = (page) => {
    resultPage = page;
    renderResultTable();
    nav.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  };
  const pageButtons = el('div', { class: 'result-page-buttons' });
  const button = (label, page, props = {}) => el('button', { type: 'button', class: 'ghost', text: label, ...props, onclick: () => go(page) });
  pageButtons.append(button('上一页', resultPage - 1, { disabled: resultPage === 1 }));
  const pages = new Set([1, pageCount]);
  const low = pageCount <= 7 ? 1 : Math.max(1, Math.min(resultPage - 2, pageCount - 4));
  const high = pageCount <= 7 ? pageCount : Math.min(pageCount, low + 4);
  for (let page = low; page <= high; page += 1) pages.add(page);
  let previous = 0;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (page - previous > 1) pageButtons.append(el('span', { 'aria-hidden': 'true', text: '…' }));
    pageButtons.append(button(String(page), page, { 'aria-label': `第 ${page} 页`, 'aria-current': page === resultPage ? 'page' : null }));
    previous = page;
  }
  pageButtons.append(button('下一页', resultPage + 1, { disabled: resultPage === pageCount }));
  const size = el('select', { 'aria-label': '每页条数' }, [10, 20, 50].map((count) => el('option', { value: count, text: `${count} 条/页` })));
  size.value = resultPageSize;
  size.addEventListener('change', () => {
    resultPageSize = Number(size.value);
    resultPage = 1;
    renderResultTable();
    nav.querySelector('select')?.focus({ preventScroll: true });
  });
  nav.append(range, pageButtons, size);
}

function openProductDrawer(snapshot) {
  const drawer = $('product-detail');
  $('product-detail-title').textContent = snapshot.title || '商品详情';
  const box = $('product-detail-body');
  clearNode(box);
  const fields = [['展示价', snapshot.price], ['价格类型', snapshot.price_type], ['规格', snapshot.spec],
    ['站点', snapshot.site_id], ['店铺', snapshot.shop_name], ['展示销量', snapshot.sales_display_band],
    ['评价数', snapshot.review_count], ['采集时间', snapshot.as_of ? fmtTime(snapshot.as_of) : null], ['采集轮次', batchLabel(snapshot.batch_id)]];
  box.append(el('dl', { class: 'product-fields' }, fields.flatMap(([label, value]) => [
    el('dt', { text: label }), el('dd', { text: value ?? '未获取' }),
  ])));
  if (snapshot.source_url) box.append(el('a', { class: 'host-launch', href: snapshot.source_url, target: '_blank',
    rel: 'noopener noreferrer', text: '打开商品原页' }));
  drawer.showModal();
}

function renderRunOutcome(run, sampleCount) {
  const box = $('run-outcome');
  box.dataset.state = currentScope === 'all' ? '' : run?.state || '';
  clearNode(box);
  if (currentScope === 'all') {
    box.textContent = `累计可见 ${sampleCount ?? 0} 条观察`;
    return;
  }
  if (!run) {
    box.textContent = '暂无此轮采集记录。可在生效计划旁开始采集。';
    return;
  }
  const stored = run.stored || 0;
  const status = run.state === 'running' ? '采集中'
    : run.state === 'done' && !stored ? '本轮未取得可用样本'
      : STATE_TEXT[run.state] || '状态未知';
  box.append(el('strong', { text: `${status} · 入库 ${stored} 条` }));
  const problems = (run.sites || []).filter((site) => site.reason && site.status !== 'done');
  if (problems.length) {
    for (const site of problems) {
      box.append(el('div', { class: 'footnote', text: `${site.keyword || site.name || site.site_id}：${site.reason}` }));
    }
    const authIssue = problems.find((site) => ['auth_required', 'auth_expired', 'captcha_blocked'].includes(site.status));
    if (authIssue) {
      box.append(el('a', { href: `?view=config&site=${encodeURIComponent(authIssue.site_id)}`, text: '去完成站点授权' }));
    }
  } else if (run.state !== 'done' && run.message) {
    box.append(el('div', { class: 'footnote', text: run.message }));
  }
}

async function loadProviderReports(source, selectedReport) {
  const list = document.querySelector(`[data-reports="${source}"]`);
  try {
    const result = await api(`/api/provider-research?provider=${encodeURIComponent(source)}`);
    if (!result.ok) throw new Error();
    clearNode(list);
    const reports = result.data || [];
    const selected = selectedReport || new URLSearchParams(location.search).get('report');
    if (!reports.length) list.textContent = '暂无外部调研记录。';
    for (const report of reports) {
      const names = { fastmoss: 'FastMoss', linkfox: 'LinkFox', taobao_alliance: '淘宝联盟', retail_csv: '表格导入' };
      const provider = names[report.provider];
      const retail = ['retail_csv', 'taobao_alliance'].includes(report.provider);
      const block = el('details', { open: report.id === selected }, [
        el('summary', { text: `${provider} · ${report.platform} / ${report.market} · ${report.query} · ${report.items.length} 条` }),
        el('p', { class: 'footnote', text: `来源：${report.tool} · ${retail ? '观察时间' : '统计时间窗'}：${report.window}` }),
      ]);
      const rows = el('div', { class: 'list' });
      function budgetGroup(item) {
        if (item.price == null || item.currency !== 'CNY') return 'unknown';
        return item.price <= report.budget ? 'budget' : 'over';
      }
      function renderItems(group = 'all') {
        clearNode(rows);
        const items = report.items.filter((item) => group === 'all' || budgetGroup(item) === group);
        if (!items.length) rows.append(el('p', { class: 'hint', text: '此分组暂无候选。' }));
        for (const item of items) {
          rows.append(el('div', { class: 'row' }, [
          el('strong', { class: 'grow', text: item.title }),
          el('span', { class: 'footnote', text: item.price == null ? '价格未提供' : `${item.price} ${item.currency}${item.price_type ? `（${item.price_type}）` : ''}` }),
          item.units_sold == null ? null : el('span', { class: 'footnote', text: `来源口径销量 ${item.units_sold}` }),
          retail ? el('span', { class: 'footnote', text: item.spec || '规格待核对' }) : null,
          item.url?.startsWith('https://') ? el('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: '打开原页核验' }) : el('span', { class: 'footnote', text: item.id }),
          ]));
        }
      }
      if (retail) block.append(el('p', { class: 'hint', text: '运费或优惠待核对，价格以商品页和结算页为准。' }));
      if (retail && report.budget != null) {
        const groups = { budget: `${report.budget} 元及以内`, over: '超预算', unknown: '无可比价格', all: '全部候选' };
        const buttons = el('div', { class: 'inline-actions', role: 'group', 'aria-label': '预算分组' });
        for (const [group, label] of Object.entries(groups)) {
          const count = report.items.filter((item) => group === 'all' || budgetGroup(item) === group).length;
          const button = el('button', { class: 'ghost', type: 'button', 'aria-pressed': String(group === 'budget'),
            text: `${label} ${count} 条`, onclick: () => {
              for (const other of buttons.children) other.setAttribute('aria-pressed', String(other === button));
              renderItems(group);
            } });
          buttons.append(button);
        }
        block.append(buttons);
      }
      renderItems(retail && report.budget != null ? 'budget' : 'all');
      block.append(rows);
      list.append(block);
    }
  } catch {
    list.textContent = '暂时无法读取外部调研记录。';
  }
}

let savedAssistantHost = null;
function renderAssistantHost(config) {
  savedAssistantHost = config;
  $('assistant-host').value = config.host;
  $('assistant-host-status').textContent = config.host === 'codex'
    ? '网页内生成建议使用本机已登录的 Codex CLI。'
    : 'WorkBuddy 可在宿主对话中使用。网页内生成建议请选择 Codex。';
}

async function loadRetailView() {
  await Promise.all([loadProviderReports('taobao_alliance'), loadProviderReports('retail_csv')]);
  try {
    $('retail-api-state').textContent = (await api('/api/retail/status')).data.configured
      ? '已配置接口，查询后会生成独立候选报告。' : '接口未配置。可以先导入下方的 CSV。';
  } catch { $('retail-api-state').textContent = '暂时无法检查接口状态。'; }
}

function bind() {
  $('assistant-host').addEventListener('change', async (event) => {
    const select = event.currentTarget;
    const host = select.value;
    select.disabled = true;
    try {
      const result = await post('/api/assistant-host', { host });
      if (result.ok) renderAssistantHost(result.data);
      else { if (savedAssistantHost) renderAssistantHost(savedAssistantHost); report(result); }
    } catch {
      if (savedAssistantHost) renderAssistantHost(savedAssistantHost);
      $('assistant-host-status').textContent = '未能保存选择，请刷新重试。';
    } finally { select.disabled = false; }
  });
  for (const link of document.querySelectorAll('[data-workspace-link]')) {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showWorkspace(link.dataset.workspaceLink);
    });
  }
  window.addEventListener('popstate', () => {
    restoreWorkspace();
    void loadRuns().then(loadResults);
  });
  for (const trigger of document.querySelectorAll('[data-refresh-reports]')) {
    trigger.addEventListener('click', () => loadProviderReports(trigger.dataset.refreshReports));
  }
  for (const kind of ['import', 'search']) {
    $(`retail-${kind}-form`).addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const feedback = $('retail-feedback');
      const submit = form.querySelector('button');
      submit.disabled = true;
      feedback.textContent = kind === 'import' ? '正在导入…' : '正在查询…';
      try {
        const budget = fields.get('budget') ? Number(fields.get('budget')) : null;
        let payload;
        if (kind === 'import') {
          const file = fields.get('file');
          if (file.size > 100_000) throw new Error('请选择 100 KB 以内的 CSV 文件');
          payload = { csv: await file.text(), budget, platform: fields.get('platform'),
            source: fields.get('source'), observedAt: fields.get('observedAt') };
        } else {
          payload = { queries: fields.get('queries').split(/\r?\n/), budget };
        }
        const r = await post(`/api/retail/${kind}`, payload);
        if (!r.ok) { feedback.textContent = [r.message, r.hint].filter(Boolean).join('。'); return; }
        if (kind === 'import') {
          feedback.textContent = `已导入 ${r.data.items.length} 条候选。`;
          await loadProviderReports('retail_csv', r.data.id);
        } else {
          feedback.textContent = r.data.map((row) => `${row.query}：${row.report ? row.report.items.length + ' 条' : row.message || '没有返回候选'}`).join(' · ');
          await loadProviderReports('taobao_alliance', r.data.find((row) => row.report)?.report.id);
        }
      } catch (error) { feedback.textContent = error.message || '操作未完成'; }
      finally { submit.disabled = false; }
    });
  }
  $('tab-config').addEventListener('click', () => switchTab('config'));
  $('tab-workbench').addEventListener('click', () => switchTab('workbench'));
  $('scope-latest').addEventListener('click', () => setScope('latest'));
  $('scope-all').addEventListener('click', () => setScope('all'));
  $('scope-select').addEventListener('change', (e) => { if (e.target.value) setScope(e.target.value); });
  $('btn-clear-evidence').addEventListener('click', async () => {
    evidenceFilter = null;
    await loadResults();
    $('result-chart-filters').querySelector('button')?.focus({ preventScroll: true });
  });
  for (const node of document.querySelectorAll('input[name="analysis-mode"]')) {
    node.addEventListener('change', async (e) => {
      const r = await post('/api/settings', { analysis_mode: e.target.value });
      if (r.ok) { analysisMode = r.data.mode; renderAnalysisMode(); }
      report(r);
    });
  }

  $('site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const site = {
      site_id: String(f.get('site_id') || '').trim(),
      name: String(f.get('name') || '').trim(),
      host: String(f.get('host') || '').trim(),
      account_label: String(f.get('account_label') || '').trim(),
      login_url: String(f.get('login_url') || '').trim(),
      terms_checked: f.get('terms_checked') === 'on',
    };
    const r = await post('/api/sites', { site });
    report(r, '已新增，默认停用；勾选已核验条款后启用，再点「登录」授权');
    e.target.reset();
    await loadSites();
  });

  $('auth-alert-go').addEventListener('click', async () => {
    switchTab('config');
    await loadSites();
    const row = document.querySelector('.site-row.attention');
    if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); }
    toast('已到配置页，点该站的「重新登录授权」即可');
  });

  $('btn-capture').addEventListener('click', async () => {
    if (!activePlan || captureSubmitting) return;
    captureSubmitting = true;
    $('btn-capture').disabled = true;
    $('task-message').textContent = '正在提交采集…';
    try {
      const r = await post('/api/workbench-capture', { expectedPlanId: activePlan.plan_id });
      report(r, r.ok ? '本轮采集已结束，可查看本轮结果' : '');
      if (r.ok) {
        currentScope = r.data.batchId;
        $('task-results-link').href = resultUrl(currentScope);
      }
      await Promise.all([loadState(), loadRuns(), loadEffectivePlan()]);
      await loadResults();
    } catch {
      toast('未能读取采集状态，请查看采集记录');
    } finally {
      captureSubmitting = false;
      $('btn-capture').disabled = !activePlan || captureRunning;
    }
  });
  $('btn-edit-plan').addEventListener('click', () => {
    $('professional-plan').open = true;
    if (!pendingDraft && !draftEdited && activePlan) {
      const draft = activePlan.plan_id === savedProfessionalPlanId ? savedProfessionalDraft : null;
      fillProfessionalDraft(draft || { queries: activePlan.units.map((unit) => unit.keyword), max_price: activePlan.max_price });
    }
    $('pro-queries').focus();
  });
  $('professional-plan-form').addEventListener('input', () => {
    draftEdited = true;
    $('btn-pro-plan-confirm').disabled = true;
    $('pro-plan-state').textContent = '有未保存的修改，请重新生成草案';
  });
  $('professional-plan-form').addEventListener('submit', async (e) => { e.preventDefault(); await draftProfessionalPlan(); });
  $('btn-pro-plan-confirm').addEventListener('click', confirmProfessionalPlan);
  $('btn-stop').addEventListener('click', async () => {
    report(await post('/api/capture/stop', {}), '已请求停止');
    await loadState();
  });

  $('btn-temp-off').addEventListener('click', async () => {
    await post('/api/temp-sort', { value: true });
    await loadResults();
    toast('已临时关闭领先标的优先；刷新页面会恢复默认');
  });
  $('btn-counter').addEventListener('click', async () => {
    evidenceFilter = null;
    counterView = !counterView;
    $('btn-counter').textContent = counterView ? '返回全部' : '反例视图';
    await loadResults();
  });

  $('btn-undo').addEventListener('click', async () => {
    report(await post('/api/undo', {}), '已撤销，可按 Ctrl/⌘+Z 或点「恢复」');
    await loadResults();
  });
  $('btn-restore').addEventListener('click', async () => {
    report(await post('/api/restore', {}), '已恢复');
    await loadSites(); await loadResults();
  });

  $('btn-clear').addEventListener('click', () => $('clear-confirm').classList.remove('hidden'));
  $('btn-clear-no').addEventListener('click', () => $('clear-confirm').classList.add('hidden'));
  $('btn-clear-yes').addEventListener('click', async () => {
    const r = await post('/api/clear', { confirmToken: 'clear-all-inline-confirm' });
    $('clear-confirm').classList.add('hidden');
    report(r, '已清空；可恢复区保留，点「恢复」或按 Ctrl/⌘+Z 可救回');
    await Promise.all([loadResults(), loadRuns()]);
  });

  document.addEventListener('keydown', async (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '1' || e.key === 'ArrowLeft') switchTab('config');
      if (e.key === '2' || e.key === 'ArrowRight') switchTab('workbench');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      report(await post('/api/restore', {}), '已恢复');
      await loadSites(); await loadResults();
    }
    if (e.key === 'Escape') $('clear-confirm').classList.add('hidden');
  });
}

async function init() {
  const boot = await api('/api/bootstrap');
  sessionToken = boot.data?.token || '';
  bind();
  api('/api/assistant-host').then((result) => {
    if (!result.ok) throw new Error();
    renderAssistantHost(result.data);
    $('assistant-host').disabled = false;
  }).catch(() => { $('assistant-host-status').textContent = '暂时无法读取 AI 配置。'; });
  await post('/api/session/reset', {}); // 页面 load 复位临时排序，不依赖会话存储
  const params = new URLSearchParams(location.search);
  restoreWorkspace();
  await Promise.all([loadState(), loadSites(), loadRuns(), loadEffectivePlan()]);
  await loadProfessionalPlan();
  await loadResults();
  if (params.get('view') === 'config' && params.get('site')) {
    const row = $(`site-row-${params.get('site')}`);
    if (row) {
      row.tabIndex = -1;
      row.scrollIntoView({ block: 'center' });
      row.focus();
    }
  }
  setInterval(() => {
    loadResearchStatus().catch(() => {});
    loadEffectivePlan().catch(() => {});
    if (!pollTimer) {
      api('/api/capture/status').then((r) => {
        if (!r.ok || taskKey(r.data) === displayedTask) return;
        renderProgress(r.data);
        if (r.data.state === 'running') startPoll();
        else return loadRuns().then(loadResults);
      }).catch(() => {});
    }
  }, 3000);
}

init();
