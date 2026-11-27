import { createHash, randomUUID } from 'node:crypto';
import { ok, err } from '../shared/result.js';
import { budgetGroup, comparableDisplayPrice } from '../domain/snapshot/display-price.js';

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const templates = [
  ['price', '先看本轮价格分布'], ['shop', '先看店铺聚集与分散'], ['counter', '先找不符合当前直觉的样本'],
];
const TASK_TYPES = new Set(['opportunity_discovery', 'direction_validation', 'candidate_follow_up']);
const budgetLimit = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
export const GUIDED_QUERY_LIMIT = 25;
const studentStationeryDirections = [
  { name: 'A5 横线笔记本', reason: '适合课堂笔记和错题整理，适用科目多。', check: '比较页数、纸张克重和是否透墨。' },
  { name: '0.5mm 中性笔套装', reason: '用于作业和考试练习，属于日常消耗品。', check: '核对每套支数、颜色、是否含笔杆，检查断墨和漏墨评价。' },
  { name: '学生透明文件袋', reason: '便于分科收纳试卷和讲义，也方便查看袋内内容。', check: '核对能否平放 A4 纸、封口做工和每套数量。' },
  { name: '单词卡片环扣套装', reason: '方便按单元整理和随身复习。', check: '核对张数、纸张厚度及环扣闭合。' },
  { name: '简约学生笔袋', reason: '集中收纳日常用笔、橡皮和尺子。', check: '核对长度、拉链和内层缝线。' },
  { name: '学生软抄作业本', reason: '用于随堂练习和日常作业。', check: '核对内页格式、册数和装订。' },
  { name: 'B5 方格笔记本', reason: '适合计算过程、草图和表格整理。', check: '核对格距、页数和纸张透墨情况。' },
  { name: 'A4 错题活页本', reason: '可按科目增减页面，便于复习。', check: '核对孔距、是否含内页和环扣强度。' },
  { name: '学生按动自动铅笔', reason: '便于草稿和画图，免去削笔。', check: '核对笔芯直径、按动顺畅度和夹芯稳定性。' },
  { name: 'HB 学生铅笔套装', reason: '适合日常书写和草图练习。', check: '核对支数、笔芯是否易断和外壳做工。' },
  { name: '学生考试 2B 铅笔', reason: '适用于需要铅笔填涂的练习。', check: '确认笔芯标识、实际考试要求和套装配件。' },
  { name: '学生软橡皮擦', reason: '适合日常修改铅笔字迹。', check: '检查擦除残留、掉屑及是否容易擦破纸。' },
  { name: '带屑盒卷笔刀', reason: '便于收集笔屑，适合书桌或笔袋使用。', check: '核对可用笔径、屑盒盖和刀片固定情况。' },
  { name: '学生修正带套装', reason: '可用于允许涂改的日常笔记和作业。', check: '核对长度、带宽和是否易断带。' },
  { name: '学生低饱和荧光笔', reason: '便于标记重点和区分知识层级。', check: '核对颜色数量及纸背是否透色。' },
  { name: '红色批注中性笔', reason: '方便订正、批注和区分原题。', check: '核对是否含笔杆、颜色和出墨稳定性。' },
  { name: '透明学生直尺', reason: '便于画线和读取刻度。', check: '核对尺寸、刻度清晰度和边缘做工。' },
  { name: '学生几何尺套装', reason: '覆盖直线、角度和常用几何作图。', check: '核对三角尺和量角器是否齐全、刻度是否清晰。' },
  { name: '学生安全圆规', reason: '用于课堂几何作图和练习。', check: '核对防护盖、转轴松紧及可替换笔芯。' },
  { name: '可移除索引标签贴', reason: '便于标记教材章节和错题页。', check: '核对尺寸和移除后是否残胶。' },
  { name: '学生便签纸套装', reason: '适合记录待办和临时学习提示。', check: '核对实际张数、粘性及书写手感。' },
  { name: 'A4 学生试卷分类册', reason: '可按科目集中归档已完成的试卷。', check: '核对内袋数量、能否放入 A4 纸和封面耐用性。' },
  { name: 'A4 学生书皮套装', reason: '便于保护频繁取用的教材封面。', check: '核对适配书本尺寸、厚度及是否需要剪裁。' },
  { name: '学生固体胶棒套装', reason: '适合手工课及粘贴纸质笔记。', check: '核对每支净重、封口情况和粘贴效果。' },
  { name: '学生长尾夹套装', reason: '用于临时固定卷子和多页讲义。', check: '核对夹口尺寸、数量及弹簧力度。' },
];

function priceFacts(rows, ceiling) {
  const prices = rows.map(comparableDisplayPrice).filter((price) => price !== null);
  return {
    raw_observation_count: rows.length,
    price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices), count: prices.length } : null,
    budget: ceiling == null ? null : {
      max_price: ceiling,
      at_or_below: prices.filter((price) => budgetGroup(price, ceiling) === 'at_or_below').length,
      above: prices.filter((price) => budgetGroup(price, ceiling) === 'above').length,
      unavailable: rows.length - prices.length,
    },
  };
}

/**
 * 这是本机的“意图整理”，不是模型推理：只把用户的一句话压成可编辑的检索词。
 * 它故意不扩词、不推荐商品，也不把价格/人群等限制偷偷变成筛选条件。
 */
function keywordFromMessage(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const first = raw.split(/[，,；;。！？!?\n]/)[0] || raw;
  return first
    .replace(/^(我想|想要|想找|帮我|请|需要|给我|帮忙)(找|看看|采集|搜索|选|挑)?/u, '')
    .replace(/^(一款|一些|几款)/u, '')
    .trim()
    .slice(0, 80);
}

function normalizeSelectionText(text) {
  return text.normalize('NFKC').replace(/(\d)\s*[快塊](?=\s*[钱錢])/gu, '$1块')
    .replace(/(块\s*)錢/gu, '$1钱').replace(/以內|之內/gu, (unit) => `${unit[0]}内`).trim();
}

export function localAssistantGuidance(requirements) {
  const text = normalizeSelectionText(requirements);
  const budget = /(?:预算\s*(?:上限\s*)?(?:为|是|:|控制在|不超过|不高于)?\s*(\d+(?:\.\d{1,2})?)\s*(?:人民币|元|块\s*钱?|圆)?(?:\s*(?:以内|以下|之内|内))?|(?:不超过|不高于|最多|至多)\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块\s*钱?|圆)|(\d+(?:\.\d{1,2})?)\s*(?:元|块\s*钱?|圆)\s*(?:以内|以下|之内|内))/u;
  const match = text.match(budget);
  const subject = text.replaceAll(new RegExp(budget.source, 'gu'), '').split(/[，,；;。！？!?]/u)[0]
    .replace(/^(?:(?:我\s*)?(?:想要?|准备|希望)?\s*(?:帮我\s*)?(?:做选品|选品|选购|购买|买|找)\s*)+/u, '')
    .replace(/^\s*的\s*/u, '')
    .split(/(?:要求|希望|优先考虑|优先找)/u)[0].trim();
  const keyword = keywordFromMessage(subject);
  const preferences = text.match(/(?:优先考虑|优先找)\s*([^。！？；;]+)/u)?.[1];
  const preferred = preferences ? preferences.split(/[、，,]|和/u).map(keywordFromMessage).filter(Boolean) : [];
  const stationery = /^(?:学生(?:用|实用)?\s*)?文具(?:用品)?$/u.test(keyword);
  const studentStationery = stationery && /学生|上学|课堂/u.test(text);
  const recommendations = stationery ? studentStationeryDirections : [];
  const seeds = recommendations.length && (studentStationery || !preferred.length) ? recommendations.map(({ name }) => name) : [keyword];
  const queries = [...new Set([...preferred, ...seeds].filter(Boolean))].slice(0, seeds.length > 1 ? GUIDED_QUERY_LIMIT : 3);
  const taskType = /选品|销售机会|好卖/u.test(text) ? 'opportunity_discovery' : 'direction_validation';
  const maxPrice = match ? budgetLimit(Number(match[1] || match[2] || match[3])) : null;
  const summary = studentStationery ? '学生实用文具，优先核对做工、材质和日常使用需求。' : null;
  return { requirements, summary, recommendations, queries, taskType, max_price: maxPrice,
    signal_watch: studentStationery ? '核对学生日常用途、套装数量与规格。质量可先查纸张厚度、笔芯规格或文件袋材质，再抽查评价或样品。' : null,
    falsifier: studentStationery ? '排除低价配件、规格不明和大包装起批。是否愿意购买需再验证。' : null };
}

export function needsLocalDraftRepair(draft) {
  return Boolean(draft?.local_fallback && !draft.local_queries_edited && draft.queries?.some((query) =>
    /^(?:我(?:想|选品)|帮我)|^\s*\d+(?:\.\d+)?\s*(?:元|块\s*钱?|圆)\s*(?:以内|以下|之内|内)/u.test(normalizeSelectionText(query))));
}

function entryForKeyword(entry, keyword) {
  const url = new URL(entry);
  // B0 已实测淘宝搜索入口使用 q；未声明该参数的站点不擅自拼接 URL。
  if (keyword && url.searchParams.has('q')) url.searchParams.set('q', keyword);
  return url.toString();
}

function localQuestion(session) {
  const turn = Number(session.turn || 0);
  const common = { source: 'local_template', is_estimate: true, evidence_keys: [] };
  if (session.task_type === 'opportunity_discovery') {
    if (turn === 0) return { ...common, field: 'seed_type', question: '你想从哪里开始找？', why_now: '这会决定本轮探索从类目场景、近期看到的词，还是已有竞品切入。', suggested_answers: ['已有类目或使用场景', '近期看到的词', '某个竞品或店铺', '我还不确定'] };
    if (turn === 1) return { ...common, field: 'category_or_scene', question: '请补充一个想研究的类目、使用场景或词。', why_now: '当前还不能形成可执行的站内检索词；留空时只能使用站点默认入口。', suggested_answers: [] };
  }
  if (session.task_type === 'direction_validation') {
    if (turn === 0) return { ...common, field: 'direction_text', question: '你想验证什么商品、风格或使用场景？', why_now: '我会把你的描述整理为可编辑的检索词，不把它当作已证实的市场事实。', suggested_answers: [] };
    if (turn === 1) return { ...common, field: 'signal_watch', question: '这一轮最想先验证什么？', why_now: '它只决定事实层的关注口径和反例，不会过滤任何采集到的样本。', suggested_answers: ['页面中有哪些不同款式/风格', '价格展示是否集中', '哪些样本不符合这个方向', '我自己说明'] };
  }
  if (session.task_type === 'candidate_follow_up') {
    if (turn === 0) return { ...common, field: 'candidate_ref', question: '请选择本机历史候选，或填写一个已支持站点的候选描述。', why_now: 'M1 只支持为下一次手动复采建立基线，不会启动后台监控。', suggested_answers: [] };
    if (turn === 1) return { ...common, field: 'watch_fields', question: '下一次手动复采时主要想看什么变化？', why_now: '这会成为下一轮的观察口径；没有同口径历史时不会输出趋势结论。', suggested_answers: ['价格展示', '展示销量', '店铺/标题变化', '我自己说明'] };
  }
  return null;
}

function draftFromSession(session) {
  const answers = session.answers || {};
  const raw = session.task_type === 'direction_validation' ? answers.direction_text
    : session.task_type === 'opportunity_discovery' ? answers.category_or_scene
      : null;
  const keyword = keywordFromMessage(raw);
  const unknown = [];
  if (!keyword) unknown.push('尚未提供可执行检索词，将使用站点默认入口；可在确认前补充');
  if (!answers.signal_watch && session.task_type === 'direction_validation') unknown.push('未设置本轮关注点');
  return {
    draft_id: `draft:${randomUUID()}`, session_id: session.session_id, task_type: session.task_type,
    source: session.mode === 'agent_assisted' ? 'host_llm' : 'local_template',
    is_estimate: true, as_of: new Date().toISOString(),
    known: Object.entries(answers).filter(([, value]) => value).map(([field, value]) => ({ field, value, source: 'user_input' })),
    unknown, keyword, queries: keyword ? [keyword] : [],
    signal_watch: answers.signal_watch || null,
    falsifier: answers.falsifier || null,
    coverage_note: '仅限本轮已配置站点和实际检索范围，不构成市场判断。',
  };
}

export function createAnalysisService({ analysis, settings, snapshots, rules }) {
  const getMode = async () => (await settings.get()).data.analysis_mode || 'local_only';
  async function setMode(mode) {
    if (!['local_only', 'agent_assisted'].includes(mode)) return err('STORAGE_FAILED', '分析模式无效', '请选择纯本机或 Agent 协作');
    await settings.patch({ analysis_mode: mode }); return ok({ mode });
  }
  async function guide(siteId = 'taobao') {
    const rows = (await snapshots.listAll()).data || [];
    const fact = rows.length ? `基于本机已采 ${rows.length} 条原始观察` : '暂无本地事实依据；这是探索性默认项';
    return ok({ mode: await getMode(), candidates: templates.map(([id, text]) => ({ candidate_id: `template:${id}`, text, basis: fact, source: 'local_template', is_estimate: false })) });
  }
  async function setIntent(c = {}) {
    const batchId = c.batchId || `batch:${Date.now()}`;
    const supplied = (c.keywords || []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, c.guided ? GUIDED_QUERY_LIMIT : 3);
    const keywords = supplied.length ? supplied : (() => {
      const keyword = keywordFromMessage(c.user_message);
      return keyword ? [keyword] : [];
    })();
    const intent = {
      intent_id: `intent:${randomUUID()}`, batch_id: batchId, version: 1,
      mode: c.mode || await getMode(), source: c.source || 'user_text',
      as_of: new Date().toISOString(), user_message: String(c.user_message || '').slice(0, 500),
      keywords, pages: 1, focus_scene: c.focus_scene || null,
      falsifier: c.falsifier || null,
      coverage_mode: c.coverage_mode === 'compared_queries' ? 'compared_queries' : 'single_query_exploration',
      max_price: budgetLimit(c.max_price),
    };
    await analysis.set(`intent:${batchId}`, intent); return ok(intent);
  }
  async function compile(c = {}) {
    const intent = (await analysis.get(`intent:${c.batchId}`)).data;
    const rule = (await rules.get(c.siteId || 'taobao', 'v1')).data;
    const entry = rule?.entry_urls?.[0];
    if (!entry) return err('RULE_MISSING', '采集入口尚未实测回填', '完成 B0 实测后再检索');
    const q = new URL(entry).searchParams.get('q') || '';
    const keywords = intent?.keywords?.length ? intent.keywords : [q];
    const plan = { plan_id: `plan:${randomUUID()}`, batch_id: c.batchId, intent_id: intent?.intent_id || null, intent_version: intent?.version || null, plan_version: 1, source: 'deterministic_compiler', as_of: new Date().toISOString(), units: keywords.map((keyword, i) => ({ query_id: `q:${i + 1}`, site_id: c.siteId || 'taobao', keyword, page: 1, entry_url: entryForKeyword(entry, keyword) })), coverage_declaration: { queries: keywords, planned_units: keywords.length, executed_units: [], failed_units: [], has_control_query: intent?.coverage_mode === 'compared_queries' } };
    plan.max_price = intent?.max_price ?? null;
    await analysis.set(`plan:${c.batchId}`, plan); return ok(plan);
  }
  async function facts(batchId, { plan, queryResults = [] } = {}) {
    const rows = ((await snapshots.findByBatch(batchId)).data || []).filter((x) => x.record_status === 'stored');
    const ceiling = budgetLimit(plan?.max_price);
    const units = plan?.units || [];
    const knownQueries = new Set(units.map((unit) => unit.query_id));
    const value = {
      batch_id: batchId, source: 'deterministic_facts', as_of: new Date().toISOString(),
      ...priceFacts(rows, ceiling),
      conservative_unit_count: new Set(rows.map((row) => row.item_id || row.source_url).filter(Boolean)).size || null,
      missing_fields: ['review_count', 'price_type'].filter((field) => rows.some((row) => row.field_status?.[field] === '未获取')),
      queries: units.map((unit) => {
        const result = queryResults.find((entry) => entry.query_id === unit.query_id);
        return {
          query_id: unit.query_id, keyword: unit.keyword, status: result?.status ?? 'unknown',
          ...priceFacts(rows.filter((row) => row.query_id === unit.query_id), ceiling),
        };
      }),
      unattributed_observations: rows.filter((row) => !knownQueries.has(row.query_id)).length,
      declaration: '本轮便利样本。价格为页面展示值，预算统计以观察条数为单位。',
    };
    await analysis.set(`facts:${batchId}`, value); return ok(value);
  }
  async function createRequest(c = {}) {
    if (await getMode() !== 'agent_assisted') return err('PERMISSION_DENIED', '当前为纯本机模式', '到配置页切换为 Agent 协作后再创建请求');
    const request = { request_id: `req:${randomUUID()}`, kind: c.kind, batch_id: c.batchId || null, session_id: c.sessionId || null, turn: Number(c.turn) || 0, expected_version: Number(c.expectedVersion) || 1, state: 'agent_pending', created_at: new Date().toISOString(), expires_at: Date.now() + 15 * 60 * 1000 };
    request.input_digest = hash(request); await analysis.set(`agent-request:${request.request_id}`, request); return ok(request);
  }

  async function startResearch(c = {}) {
    if (!TASK_TYPES.has(c.taskType)) return err('STORAGE_FAILED', '未知的选品任务', '请选择找机会、验证方向或跟踪候选');
    const mode = c.mode || await getMode();
    const session = {
      session_id: `session:${randomUUID()}`, task_type: c.taskType, mode,
      state: mode === 'agent_assisted' ? 'agent_pending' : 'questioning',
      turn: 0, answers: {}, current_turn: null, draft_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1,
    };
    let request = null;
    if (mode === 'agent_assisted') {
      request = await createRequest({ kind: 'guidance', sessionId: session.session_id, turn: 0, expectedVersion: session.version });
      if (!request.ok) return request;
      session.request_id = request.data.request_id;
    } else {
      const question = localQuestion(session);
      session.current_turn = question ? { ...question, turn_id: `turn:${randomUUID()}`, turn: 0, as_of: new Date().toISOString() } : null;
      if (session.current_turn) await analysis.set(`session-turn:${session.session_id}:0`, session.current_turn);
    }
    await analysis.set(`session:${session.session_id}`, session);
    return ok({ session, question: session.current_turn, request: request?.data || null });
  }

  async function getResearch(sessionId) {
    if (!sessionId) return err('STORAGE_FAILED', '缺少访谈标识', '重新从任务卡开始');
    const session = (await analysis.get(`session:${sessionId}`)).data;
    if (!session) return err('STORAGE_FAILED', '找不到这次选品访谈', '刷新页面后从任务卡重新开始');
    const draft = session.draft_id ? (await analysis.get(`plan-draft:${sessionId}`)).data : null;
    const plan = session.batch_id ? (await analysis.get(`plan:${session.batch_id}`)).data : null;
    return ok({ session, question: session.current_turn, draft, plan });
  }

  async function activeResearch() {
    const sessions = (await analysis.list('session:')).data || [];
    const latest = sessions.map((x) => x.value)
      .filter((x) => x && x.mode === 'agent_assisted' && x.state !== 'cancelled')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return latest ? getResearch(latest.session_id) : ok(null);
  }

  async function getProfessionalPlan() {
    const draft = (await analysis.get('professional-plan:draft')).data;
    const confirmed = (await analysis.get('professional-plan:confirmed')).data;
    const plan = confirmed?.batch_id ? (await analysis.get(`plan:${confirmed.batch_id}`)).data : null;
    return ok({ draft, confirmed, plan });
  }

  async function effectivePlan() {
    const { confirmed, plan } = (await getProfessionalPlan()).data;
    const sessions = (await analysis.list('session:')).data || [];
    const latest = sessions.map(({ value }) => value)
      .filter((session) => session?.state === 'plan_confirmed' && session.mode === 'agent_assisted')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (latest && (!plan || latest.updated_at > confirmed.confirmed_at)) {
      const research = (await getResearch(latest.session_id)).data;
      if (research?.plan) return ok({ plan: research.plan, source: 'assistant' });
    }
    return ok(plan ? { plan, source: 'professional' } : null);
  }

  async function draftProfessionalPlan(c = {}) {
    const queries = (c.queries || []).map((x) => keywordFromMessage(x)).filter(Boolean).slice(0, 3);
    if (!queries.length) return err('STORAGE_FAILED', '至少填写一个检索词', '每行填写一个要检索的商品、场景或风格');
    const previous = (await analysis.get('professional-plan:draft')).data;
    const draft = {
      draft_id: `professional-draft:${randomUUID()}`, version: (previous?.version || 0) + 1,
      source: 'professional_workbench', as_of: new Date().toISOString(), queries,
      focus_scene: String(c.focus_scene || '').trim().slice(0, 300) || null,
      signal_watch: String(c.signal_watch || '').trim().slice(0, 300) || null,
      falsifier: String(c.falsifier || '').trim().slice(0, 300) || null,
      max_price: budgetLimit(c.max_price),
      coverage_mode: c.coverage_mode === 'compared_queries' ? 'compared_queries' : 'single_query_exploration',
      coverage_note: '仅限本轮已配置站点与实际检索范围，不构成市场判断。',
    };
    await analysis.set('professional-plan:draft', draft);
    return ok(draft);
  }

  async function confirmProfessionalPlan(c = {}) {
    const draft = (await analysis.get('professional-plan:draft')).data;
    if (!draft) return err('STALE_WRITE', '没有待确认的专业计划草案', '先生成一份计划草案');
    if (Number(c.expectedVersion) !== Number(draft.version)) return err('STALE_WRITE', '专业计划草案已变化', '刷新后确认最新草案');
    const batchId = `batch:${randomUUID()}`;
    const intent = await setIntent({ batchId, keywords: draft.queries, source: draft.source, focus_scene: draft.focus_scene, falsifier: draft.falsifier, coverage_mode: draft.coverage_mode, max_price: draft.max_price, mode: 'professional' });
    if (!intent.ok) return intent;
    const plan = await compile({ batchId, siteId: c.siteId || 'taobao' });
    if (!plan.ok) return plan;
    const confirmed = { confirmed_id: `professional-confirmed:${randomUUID()}`, draft_id: draft.draft_id, batch_id: batchId, plan_id: plan.data.plan_id, confirmed_at: new Date().toISOString() };
    await analysis.set('professional-plan:confirmed', confirmed);
    return ok({ draft, confirmed, intent: intent.data, plan: plan.data });
  }

  async function answerResearch(c = {}) {
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const session = found.data.session;
    if (session.mode !== 'local_only') return err('PERMISSION_DENIED', '当前访谈等待 AI 会话引导', '在 Codex / WorkBuddy 会话中明确启动 AI 引导，或切换为本机快速计划');
    if (session.state !== 'questioning' || !session.current_turn) return err('STALE_WRITE', '当前问题已变化', '刷新后继续本次访谈');
    if (Number(c.expectedVersion) !== Number(session.version)) return err('STALE_WRITE', '回答基于旧版本', '刷新后重新提交回答');
    const question = session.current_turn;
    const value = c.skip ? null : String(c.answer || '').trim().slice(0, 500);
    const answers = { ...session.answers, [question.field]: value };
    const nextSession = { ...session, answers, turn: session.turn + 1, version: session.version + 1, current_turn: null, updated_at: new Date().toISOString() };
    const next = localQuestion(nextSession);
    if (next) {
      nextSession.current_turn = { ...next, turn_id: `turn:${randomUUID()}`, turn: nextSession.turn, as_of: new Date().toISOString() };
      await analysis.set(`session-turn:${nextSession.session_id}:${nextSession.turn}`, nextSession.current_turn);
    } else {
      const draft = draftFromSession(nextSession);
      nextSession.state = 'plan_draft'; nextSession.draft_id = draft.draft_id;
      await analysis.set(`plan-draft:${nextSession.session_id}`, draft);
    }
    await analysis.set(`session:${nextSession.session_id}`, nextSession);
    return ok({ session: nextSession, question: nextSession.current_turn, draft: nextSession.draft_id ? (await analysis.get(`plan-draft:${nextSession.session_id}`)).data : null });
  }

  async function confirmPlan(c = {}) {
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const session = found.data.session;
    if (session.state !== 'plan_draft' || !found.data.draft) return err('STALE_WRITE', '当前没有可确认的计划草案', '完成本次访谈后再确认计划');
    if (Number(c.expectedVersion) !== Number(session.version)) return err('STALE_WRITE', '计划草案已变化', '刷新后重新确认');
    const draft = found.data.draft;
    const batchId = `batch:${randomUUID()}`;
    const intent = await setIntent({ batchId, keywords: draft.queries, guided: Boolean(draft.requirements), source: draft.source, focus_scene: session.answers.category_or_scene || session.answers.direction_text || null, falsifier: draft.falsifier, max_price: draft.max_price, task_type: session.task_type, mode: session.mode });
    if (!intent.ok) return intent;
    const plan = await compile({ batchId, siteId: c.siteId || 'taobao' });
    if (!plan.ok) return plan;
    const confirmed = { ...session, state: 'plan_confirmed', batch_id: batchId, plan_id: plan.data.plan_id, version: session.version + 1, updated_at: new Date().toISOString(), current_turn: null };
    await analysis.set(`session:${confirmed.session_id}`, confirmed);
    return ok({ session: confirmed, intent: intent.data, plan: plan.data });
  }

  async function cancelResearch(c = {}) {
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const session = found.data.session;
    const cancelled = { ...session, state: 'cancelled', current_turn: null, version: session.version + 1, updated_at: new Date().toISOString(), cancel_reason: String(c.reason || '').slice(0, 200) || null };
    await analysis.set(`session:${cancelled.session_id}`, cancelled);
    return ok(cancelled);
  }
  async function nextAgentSession() {
    const sessions = (await analysis.list('session:')).data || [];
    const pending = sessions.map((x) => x.value)
      .filter((x) => x?.mode === 'agent_assisted' && x.state === 'agent_pending')
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))[0] || null;
    return ok(pending ? { session: pending, request: (await analysis.get(`agent-request:${pending.request_id}`)).data } : null);
  }
  async function startAgentResearch(c = {}) {
    if (await getMode() !== 'agent_assisted') return err('PERMISSION_DENIED', '当前未启用 Agent 协作', '请先在配置页选择 Agent 协作');
    return startResearch({ ...c, mode: 'agent_assisted' });
  }
  async function applyAgentGuidance(c = {}) {
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const session = found.data.session;
    const type = c.guidance?.type;
    const revisingGuide = type === 'guided_plan' && found.data.draft?.requirements &&
      ['requirements_ready', 'plan_draft'].includes(session.state);
    if (session.mode !== 'agent_assisted' || (session.state !== 'agent_pending' && !revisingGuide)) {
      return err('STALE_WRITE', '当前任务不等待 AI 回写', '读取当前任务状态后继续');
    }
    if (Number(c.expectedVersion) !== Number(session.version)) return err('STALE_WRITE', 'AI 基于旧版本生成内容', '重新领取任务后再提交');
    if (type === 'question') {
      const field = String(c.guidance.field || '').trim().slice(0, 64);
      const question = String(c.guidance.question || '').trim().slice(0, 300);
      if (!field || !question) return err('STORAGE_FAILED', 'AI 问题不完整', '需包含字段名和一个明确问题');
      const suggested = Array.isArray(c.guidance.suggested_answers) ? c.guidance.suggested_answers.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 5) : [];
      const next = { ...session, state: 'questioning', current_turn: { turn_id: `turn:${randomUUID()}`, turn: session.turn, field, question, why_now: String(c.guidance.why_now || '').trim().slice(0, 300), suggested_answers: suggested, source: 'host_llm', is_estimate: true, evidence_keys: [], as_of: new Date().toISOString() }, version: session.version + 1, updated_at: new Date().toISOString() };
      await analysis.set(`session-turn:${next.session_id}:${next.turn}`, next.current_turn);
      await analysis.set(`session:${next.session_id}`, next);
      return ok({ session: next, question: next.current_turn });
    }
    if (type === 'plan_draft' || type === 'guided_plan') {
      const guided = type === 'guided_plan';
      const queries = Array.isArray(c.guidance.queries) ? c.guidance.queries.map((x) => keywordFromMessage(x)).filter(Boolean).slice(0, guided ? GUIDED_QUERY_LIMIT : 3) : [];
      const draft = { ...draftFromSession(session), draft_id: `draft:${randomUUID()}`, source: 'host_llm', queries, keyword: queries[0] || '', signal_watch: c.guidance.signal_watch ? String(c.guidance.signal_watch).slice(0, 200) : null, falsifier: c.guidance.falsifier ? String(c.guidance.falsifier).slice(0, 300) : null, unknown: Array.isArray(c.guidance.unknown) ? c.guidance.unknown.map((x) => String(x).slice(0, 200)).slice(0, 5) : [] };
      draft.max_price = budgetLimit(c.guidance.max_price);
      if (guided && c.localFallback) {
        draft.source = 'local_template';
        draft.local_fallback = true;
        draft.requirements_summary = c.guidance.summary || null;
      }
      if (guided && Array.isArray(c.guidance.recommendations)) {
        draft.recommendations = c.guidance.recommendations.filter((item) =>
          [item?.name, item?.reason, item?.check].every((text) => typeof text === 'string' && text.trim()))
          .slice(0, GUIDED_QUERY_LIMIT).map(({ name, reason, check }) => ({ name: name.slice(0, 80), reason: reason.slice(0, 200), check: check.slice(0, 200) }));
      }
      draft.requirements = guided ? String(c.guidance.requirements || '').trim().slice(0, 500) : null;
      if (guided && (!draft.requirements || !queries.length)) {
        return err('STORAGE_FAILED', '需求或搜索词建议为空', '先补齐需求摘要和至少一个搜索词');
      }
      const next = { ...session, state: guided ? 'requirements_ready' : 'plan_draft', draft_id: draft.draft_id, current_turn: null, version: session.version + 1, updated_at: new Date().toISOString() };
      await analysis.set(`plan-draft:${next.session_id}`, draft);
      await analysis.set(`session:${next.session_id}`, next);
      return ok({ session: next, draft });
    }
    return err('STORAGE_FAILED', '未知的 AI 回写类型', '只支持 question 或 plan_draft');
  }

  async function updateGuidedPlan(c = {}) {
    if (!['preview', 'edit', 'requirements', 'refresh_local'].includes(c.action)) {
      return err('STORAGE_FAILED', '未知的引导操作', '请刷新需求卡');
    }
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const { session, draft } = found.data;
    const states = c.action === 'requirements' ? ['requirements_ready', 'plan_draft']
      : [c.action === 'preview' ? 'requirements_ready' : 'plan_draft'];
    if (session.mode !== 'agent_assisted' || !draft?.requirements ||
      !states.includes(session.state) || session.version !== Number(c.expectedVersion)) {
      return err('STALE_WRITE', '当前步骤已变化', '刷新后查看最新需求或搜索词');
    }
    if (c.action === 'edit') {
      const queries = Array.isArray(c.queries)
        ? [...new Set(c.queries.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))] : [];
      if (!queries.length || queries.length > GUIDED_QUERY_LIMIT || queries.some((query) => query.length > 80)) {
        return err('STORAGE_FAILED', `请输入 1 至 ${GUIDED_QUERY_LIMIT} 个搜索词，每个最多 80 字`, '检查已勾选商品的搜索词');
      }
      await analysis.set(`plan-draft:${session.session_id}`, { ...draft, queries, keyword: queries[0],
        ...(draft.local_fallback ? { local_queries_edited: true } : {}) });
    }
    if (c.action === 'refresh_local') {
      if (!draft.local_fallback) return err('PERMISSION_DENIED', '仅本机草案支持重新整理', '可直接编辑搜索词');
      const guidance = localAssistantGuidance(draft.requirements);
      if (!guidance.queries.length) return err('STORAGE_FAILED', '请补充具体商品名', '修改需求后再试');
      await analysis.set(`plan-draft:${session.session_id}`, {
        ...draft, queries: guidance.queries, keyword: guidance.queries[0], max_price: draft.max_price ?? guidance.max_price,
        requirements_summary: guidance.summary, recommendations: guidance.recommendations,
        signal_watch: guidance.signal_watch, falsifier: guidance.falsifier,
        requirements_changed: false, local_queries_edited: false,
      });
    }
    if (c.action === 'requirements') {
      const requirements = typeof c.requirements === 'string' ? c.requirements.trim() : '';
      const maxPrice = budgetLimit(c.max_price);
      if (!requirements || requirements.length > 500 || (c.max_price !== null && maxPrice === null)) {
        return err('STORAGE_FAILED', '请填写需求，预算需为正数或留空', '修改后再检查搜索词');
      }
      const changed = requirements !== draft.requirements;
      const localGuidance = changed && draft.local_fallback ? localAssistantGuidance(requirements) : null;
      await analysis.set(`plan-draft:${session.session_id}`, {
        ...draft, requirements, max_price: maxPrice,
        requirements_summary: changed ? localGuidance?.summary ?? null : draft.requirements_summary,
        recommendations: changed ? localGuidance?.recommendations ?? [] : draft.recommendations,
        requirements_changed: changed || draft.requirements_changed || false,
        signal_watch: changed ? localGuidance?.signal_watch ?? null : draft.signal_watch,
        falsifier: changed ? localGuidance?.falsifier ?? null : draft.falsifier,
      });
    }
    await analysis.set(`session:${session.session_id}`, { ...session, state: 'plan_draft',
      version: session.version + 1, updated_at: new Date().toISOString() });
    return getResearch(session.session_id);
  }
  async function acceptAgentAnswer(c = {}) {
    const found = await getResearch(c.sessionId);
    if (!found.ok) return found;
    const session = found.data.session;
    if (session.mode !== 'agent_assisted' || session.state !== 'questioning' || !session.current_turn) return err('STALE_WRITE', '当前没有等待回答的问题', '刷新后领取下一条待处理任务');
    if (Number(c.expectedVersion) !== Number(session.version)) return err('STALE_WRITE', '回答基于旧版本', '刷新后重新提交回答');
    const question = session.current_turn;
    const answers = { ...session.answers, [question.field]: c.skip ? null : String(c.answer || '').trim().slice(0, 500) };
    const next = { ...session, answers, turn: session.turn + 1, state: 'agent_pending', current_turn: null, version: session.version + 1, updated_at: new Date().toISOString() };
    const request = await createRequest({ kind: 'guidance', sessionId: next.session_id, turn: next.turn, expectedVersion: next.version });
    if (!request.ok) return request;
    next.request_id = request.data.request_id;
    await analysis.set(`session:${next.session_id}`, next);
    return ok({ session: next, request: request.data });
  }
  return Object.freeze({ getMode, setMode, guide, setIntent, compile, facts, createRequest, startResearch, getResearch, activeResearch, getProfessionalPlan, effectivePlan, draftProfessionalPlan, confirmProfessionalPlan, answerResearch, confirmPlan, cancelResearch, nextAgentSession, startAgentResearch, applyAgentGuidance, acceptAgentAnswer, updateGuidedPlan });
}
