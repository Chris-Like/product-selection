import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisService, localAssistantGuidance, needsLocalDraftRepair } from '../../app/core/service/analysis.service.js';

test('本机选品草案保留明确预算和商品偏好', () => {
  const requirement = '我想买 20 元以内的文具，优先考虑笔记本和中性笔。';
  const guidance = localAssistantGuidance(requirement);
  assert.deepEqual(guidance.queries, ['笔记本', '中性笔', '文具']);
  assert.equal(guidance.max_price, 20);
  assert.equal(guidance.requirements, requirement);
  assert.equal(localAssistantGuidance('A5 笔记本').max_price, null);
});

test('识别 30 快钱的原始输入，旧草案可自动识别并修复', () => {
  const requirements = '我选品30快钱以内的文具，要求质量好 学生比较实用且愿意买的 不得不买的文具';
  const guidance = localAssistantGuidance(requirements);
  assert.equal(guidance.requirements, requirements);
  assert.equal(guidance.max_price, 30);
  assert.equal(guidance.recommendations.length, 25);
  assert.deepEqual(guidance.queries.slice(0, 3), ['A5 横线笔记本', '0.5mm 中性笔套装', '学生透明文件袋']);
  assert.equal(needsLocalDraftRepair({ local_fallback: true, queries: ['30快钱以内的文具'] }), true);
});

test('旧本机需求卡可重新整理 30 块钱以内的学生文具', async () => {
  const requirements = '我选品30块钱以内我选品30块钱以内的文具，要求质量好 学生比较实用且愿意买的 不得不买的文具 的文具，要求质量好 学生比较实用且愿意买的 不得不买的文具';
  const guidance = localAssistantGuidance(requirements);
  assert.equal(guidance.max_price, 30);
  assert.equal(guidance.queries.length, 25);
  assert.deepEqual(guidance.queries.slice(0, 3), ['A5 横线笔记本', '0.5mm 中性笔套装', '学生透明文件袋']);
  assert.deepEqual(guidance.recommendations.map(({ name }) => name), guidance.queries);
  assert.match(guidance.recommendations[0].check, /纸张克重/);
  assert.match(guidance.falsifier, /愿意购买需再验证/);
  assert.equal(localAssistantGuidance('我选品３０块钱内的文具，学生用').max_price, 30);

  const service = make();
  await service.setMode('agent_assisted');
  const started = await service.startAgentResearch({ taskType: 'direction_validation' });
  const sessionId = started.data.session.session_id;
  const staged = await service.applyAgentGuidance({ sessionId, expectedVersion: 1, localFallback: true,
    guidance: { type: 'guided_plan', requirements, queries: ['30块钱以内我选品30块钱以内的文具'] } });
  assert.equal(needsLocalDraftRepair(staged.data.draft), true);
  assert.equal(needsLocalDraftRepair({ ...staged.data.draft, local_queries_edited: true }), false);
  await service.updateGuidedPlan({ sessionId, expectedVersion: 2, action: 'preview' });
  const refreshed = await service.updateGuidedPlan({ sessionId, expectedVersion: 3, action: 'refresh_local' });
  assert.equal(refreshed.data.draft.max_price, 30);
  assert.deepEqual(refreshed.data.draft.queries, guidance.queries);
  assert.deepEqual(refreshed.data.draft.recommendations, guidance.recommendations);
  assert.match(refreshed.data.draft.requirements_summary, /^学生实用文具/);
  assert.equal(needsLocalDraftRepair(refreshed.data.draft), false);
  assert.equal(refreshed.data.session.state, 'plan_draft');
  const confirmed = await service.confirmPlan({ sessionId, expectedVersion: refreshed.data.session.version });
  assert.deepEqual(confirmed.data.plan.units.map(({ keyword }) => keyword), guidance.queries);
});

function make(rows = []) {
  const kv = new Map();
  const settings = { value: { analysis_mode: 'local_only' }, get: async () => ({ data: settings.value }), patch: async (p) => { settings.value = { ...settings.value, ...p }; } };
  const analysis = { get: async (k) => ({ ok: true, data: kv.get(k) || null }), set: async (k, v) => { kv.set(k, v); return { ok: true, data: v }; }, list: async (prefix = '') => ({ ok: true, data: [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })) }) };
  const snapshots = { listAll: async () => ({ data: rows }), findByBatch: async () => ({ data: rows }) };
  const rules = { get: async () => ({ ok: true, data: { entry_urls: ['https://s.taobao.com/search?q=%E8%BF%9E%E8%A1%A3%E8%A3%99'] } }) };
  return createAnalysisService({ analysis, settings, snapshots, rules });
}

test('按查询对照预算，缺价与旧观察不会被归入预算内或错误的检索方向', async () => {
  const s = make([
    { record_status: 'stored', query_id: 'q:1', item_id: 'same', price: 50 },
    { record_status: 'stored', query_id: 'q:2', item_id: 'same', price: 65 },
    { record_status: 'stored', query_id: 'q:2', item_id: 'other', price: null },
    { record_status: 'stored', price: 10, field_status: { price: '值异常' } },
    { record_status: 'undone', query_id: 'q:1', price: 1 },
  ]);
  const draft = await s.draftProfessionalPlan({ queries: ['桌面收纳', '床边收纳'], max_price: 50 });
  const { plan } = (await s.confirmProfessionalPlan({ expectedVersion: draft.data.version })).data;
  const { data } = await s.facts('example', { plan, queryResults: [{ query_id: 'q:1', status: 'done' }] });
  assert.deepEqual(data.budget, { max_price: 50, at_or_below: 1, above: 1, unavailable: 2 });
  assert.equal(data.queries[0].status, 'done');
  assert.equal(data.queries[1].budget.unavailable, 1);
  assert.equal(data.unattributed_observations, 1);
  assert.equal(data.conservative_unit_count, 2);
});

test('需求卡先预览再确认，修改后的搜索词成为执行计划', async () => {
  const s = make();
  await s.setMode('agent_assisted');
  const { data: { session } } = await s.startAgentResearch({ taskType: 'opportunity_discovery' });
  const sessionId = session.session_id;
  const staged = await s.applyAgentGuidance({ sessionId, expectedVersion: 1,
    guidance: { type: 'guided_plan', requirements: '找宿舍能用的收纳用品', queries: ['床边收纳'], max_price: 50 } });
  assert.equal(staged.data.session.state, 'requirements_ready');
  assert.equal((await s.confirmPlan({ sessionId, expectedVersion: 2 })).ok, false);
  const preview = await s.updateGuidedPlan({ sessionId, expectedVersion: 2, action: 'preview' });
  assert.equal(preview.data.session.state, 'plan_draft');
  const edit = await s.updateGuidedPlan({ sessionId, expectedVersion: 3, action: 'edit', queries: ['床边挂篮，免打孔'] });
  assert.equal(edit.data.session.version, 4);
  assert.equal((await s.confirmPlan({ sessionId, expectedVersion: 3 })).ok, false);
  const confirmed = await s.confirmPlan({ sessionId, expectedVersion: 4 });
  assert.equal(confirmed.data.plan.max_price, 50);
  assert.equal(new URL(confirmed.data.plan.units[0].entry_url).searchParams.get('q'), '床边挂篮，免打孔');
});

test('返回需求卡可以修改需求与预算，更新后仍要确认搜索词', async () => {
  const s = make();
  await s.setMode('agent_assisted');
  const started = await s.startAgentResearch({ taskType: 'opportunity_discovery' });
  const sessionId = started.data.session.session_id;
  await s.applyAgentGuidance({ sessionId, expectedVersion: 1, guidance: {
    type: 'guided_plan', requirements: '宿舍收纳', queries: ['床边挂篮'], signal_watch: '挂篮尺寸', max_price: 50,
  } });
  await s.updateGuidedPlan({ sessionId, expectedVersion: 2, action: 'preview' });
  const updated = await s.updateGuidedPlan({ sessionId, expectedVersion: 3, action: 'requirements',
    requirements: '厨房收纳', max_price: 80 });
  assert.equal(updated.data.draft.requirements, '厨房收纳');
  assert.equal(updated.data.draft.requirements_changed, true);
  assert.equal(updated.data.draft.signal_watch, null);
  assert.deepEqual(updated.data.draft.queries, ['床边挂篮']);
  assert.equal((await s.confirmPlan({ sessionId, expectedVersion: 3 })).ok, false);
  const confirmed = await s.confirmPlan({ sessionId, expectedVersion: 4 });
  assert.equal(confirmed.data.plan.max_price, 80);
});

test('冷启动模板如实标注无本地事实，纯本机不创建 Agent 请求', async () => {
  const s = make();
  const guide = await s.guide();
  assert.match(guide.data.candidates[0].basis, /暂无本地事实依据/);
  const req = await s.createRequest({ kind: 'guide' });
  assert.equal(req.ok, false);
  assert.equal(req.code, 'PERMISSION_DENIED');
});

test('intent → 确定性 plan；Agent 模式才允许创建待处理请求', async () => {
  const s = make();
  const intent = await s.setIntent({ batchId: 'b1', keywords: ['通勤外套'] });
  const plan = await s.compile({ batchId: 'b1' });
  assert.equal(intent.ok, true);
  assert.equal(plan.data.units[0].keyword, '通勤外套');
  await s.setMode('agent_assisted');
  const req = await s.createRequest({ kind: 'guide', batchId: 'b1' });
  assert.equal(req.ok, true);
  assert.equal(req.data.state, 'agent_pending');
});

test('一句话意图会整理为可编辑检索词，并写入实际搜索 URL', async () => {
  const s = make();
  const intent = await s.setIntent({ batchId: 'b2', user_message: '我想找小个子秋冬通勤连衣裙，预算 200 元以内' });
  const plan = await s.compile({ batchId: 'b2' });
  assert.deepEqual(intent.data.keywords, ['小个子秋冬通勤连衣裙']);
  assert.equal(new URL(plan.data.units[0].entry_url).searchParams.get('q'), '小个子秋冬通勤连衣裙');
});

test('本机任务访谈一次一问，确认计划后才生成可执行 plan', async () => {
  const s = make();
  const started = await s.startResearch({ taskType: 'direction_validation' });
  assert.equal(started.ok, true);
  assert.match(started.data.question.question, /验证什么商品/);
  const first = await s.answerResearch({ sessionId: started.data.session.session_id, expectedVersion: 1, answer: '小个子秋冬通勤连衣裙' });
  assert.equal(first.data.session.state, 'questioning');
  assert.match(first.data.question.question, /最想先验证/);
  const second = await s.answerResearch({ sessionId: started.data.session.session_id, expectedVersion: 2, answer: '哪些样本不符合这个方向' });
  assert.equal(second.data.session.state, 'plan_draft');
  assert.deepEqual(second.data.draft.queries, ['小个子秋冬通勤连衣裙']);
  const confirmed = await s.confirmPlan({ sessionId: started.data.session.session_id, expectedVersion: 3 });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.session.state, 'plan_confirmed');
  assert.equal(new URL(confirmed.data.plan.units[0].entry_url).searchParams.get('q'), '小个子秋冬通勤连衣裙');
});

test('本机访谈的跳过不会阻断草案，旧版本回答会被拒绝', async () => {
  const s = make();
  const started = await s.startResearch({ taskType: 'opportunity_discovery' });
  const stale = await s.answerResearch({ sessionId: started.data.session.session_id, expectedVersion: 9, answer: '已有类目或使用场景' });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_WRITE');
  const first = await s.answerResearch({ sessionId: started.data.session.session_id, expectedVersion: 1, skip: true });
  const second = await s.answerResearch({ sessionId: started.data.session.session_id, expectedVersion: 2, skip: true });
  assert.equal(first.ok, true);
  assert.equal(second.data.session.state, 'plan_draft');
  assert.equal(second.data.draft.queries.length, 0);
});

test('宿主 AI 桥接只能领取待处理任务，并在用户确认前不生成采集计划', async () => {
  const s = make();
  await s.setMode('agent_assisted');
  const started = await s.startAgentResearch({ taskType: 'direction_validation' });
  const picked = await s.nextAgentSession();
  assert.equal(picked.data.session.session_id, started.data.session.session_id);
  const asked = await s.applyAgentGuidance({ sessionId: started.data.session.session_id, expectedVersion: 1, guidance: { type: 'question', field: 'direction_text', question: '这次想验证哪个方向？' } });
  assert.equal(asked.data.session.state, 'questioning');
  const answered = await s.acceptAgentAnswer({ sessionId: started.data.session.session_id, expectedVersion: 2, answer: '小个子通勤连衣裙' });
  assert.equal(answered.data.session.state, 'agent_pending');
  const draft = await s.applyAgentGuidance({ sessionId: started.data.session.session_id, expectedVersion: 3, guidance: { type: 'plan_draft', queries: ['小个子通勤连衣裙'], falsifier: '检查是否混入礼服或睡裙' } });
  assert.equal(draft.data.session.state, 'plan_draft');
  const confirmed = await s.confirmPlan({ sessionId: started.data.session.session_id, expectedVersion: 4 });
  assert.equal(confirmed.data.plan.units[0].keyword, '小个子通勤连衣裙');
  const active = await s.activeResearch();
  assert.equal(active.data.session.state, 'plan_confirmed');
  assert.equal(active.data.plan.plan_id, confirmed.data.plan.plan_id);
});

test('专业工作台可以编辑多检索词草案，但确认前没有可执行计划', async () => {
  const s = make();
  const drafted = await s.draftProfessionalPlan({
    queries: ['宿舍收纳', '桌面收纳'], focus_scene: '大学生宿舍',
    signal_watch: '价格展示是否集中', falsifier: '检查是否混入大件家具', coverage_mode: 'compared_queries',
  });
  assert.equal(drafted.ok, true);
  assert.deepEqual(drafted.data.queries, ['宿舍收纳', '桌面收纳']);
  const before = await s.getProfessionalPlan();
  assert.equal(before.data.plan, null);
  const confirmed = await s.confirmProfessionalPlan({ expectedVersion: drafted.data.version });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.plan.units.length, 2);
  const after = await s.getProfessionalPlan();
  assert.equal(after.data.plan.plan_id, confirmed.data.plan.plan_id);
});
