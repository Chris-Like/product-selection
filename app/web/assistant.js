import { el, clearNode } from './lib/render.js';

const step = document.querySelector('#guide-step');
const panel = document.querySelector('#guide-body');
const message = document.querySelector('#guide-message');
const sessionId = new URLSearchParams(location.search).get('session');
const endpoint = `/api/assistant-guide/${encodeURIComponent(sessionId || '')}`;
let token = '';
const configUrl = (site) => {
  const params = new URLSearchParams({ view: 'config' });
  if (sessionId) params.set('assistant', sessionId);
  if (site) params.set('site', site);
  return `/?${params}`;
};

async function request(path, body) {
  const response = await fetch(path, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auto-pick-token': token },
    body: JSON.stringify(body),
  } : {});
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || '未能读取任务，请刷新重试。');
  return result.data;
}

function action(text, work) {
  const button = el('button', { type: 'button', text });
  button.addEventListener('click', async () => {
    button.disabled = true;
    message.textContent = '';
    try { await work(); }
    catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
  return button;
}

function renderResult(run, facts) {
  step.textContent = '3 / 3 · 查看结果';
  clearNode(panel);
  if (!run) {
    panel.textContent = '计划已确认。请回到对话或专业工作台查看采集进度。';
    return;
  }
  const status = { done: '采集完成', partial: '部分查询未完成', stopped: '采集已停止',
    not_started: '采集未开始', running: '仍在采集' }[run.state] || '请查看本轮状态';
  panel.append(el('p', { text: run.ended_at ? `${status}，共入库 ${run.stored || 0} 条观察。` : status }));
  if (facts?.budget && facts.raw_observation_count) {
    const budget = facts.budget;
    panel.append(el('p', { text: `${budget.max_price} 元及以内 ${budget.at_or_below} 条，超预算 ${budget.above} 条，缺可比价格 ${budget.unavailable} 条。` }));
  }
  for (const item of run.sites || []) {
    if (item.status !== 'done' && item.reason) {
      panel.append(el('p', { class: 'hint', text: `${item.keyword || item.name}：${item.reason}` }));
    }
  }
  const params = new URLSearchParams({ batch: run.batch_id, assistant: sessionId });
  panel.append(el('a', { href: `/?${params}#results`, text: '查看商品明细' }));
  if (!run.ended_at) panel.append(action('刷新进度', async () => render(await request(endpoint))));
}

function render(payload, { showRequirements = false, editedQueries } = {}) {
  const { session, draft, run, facts } = payload;
  clearNode(panel);
  if (session.state === 'plan_confirmed') { renderResult(run, facts); return; }
  if (!['requirements_ready', 'plan_draft'].includes(session.state)) {
    step.textContent = '请回到对话继续';
    return;
  }
  const needsPreview = showRequirements || session.state === 'requirements_ready';
  step.textContent = needsPreview ? '1 / 3 · 这次想找什么' : '2 / 3 · 检查搜索词';
  if (needsPreview) {
    const requirements = el('textarea', { id: 'guided-requirements', rows: 4, maxlength: 500 });
    requirements.value = draft.requirements;
    const budget = el('input', { id: 'guided-budget', type: 'number', min: '0.01', step: '0.01', placeholder: '不限预算' });
    budget.value = draft.max_price ?? '';
    panel.append(el('label', { for: 'guided-requirements', text: '这次的选品需求' }), requirements,
      el('div', { class: 'inline-actions' }, [el('label', { for: 'guided-budget', text: '预算上限（元）' }), budget]),
      el('p', { class: 'hint', text: '可以在这里改需求。下一步会保留原搜索词，供你按新需求检查或修改。' }),
      action(session.state === 'requirements_ready' ? '生成搜索词' : '下一步：检查搜索词', async () => {
        const text = requirements.value.trim();
        if (!text) { requirements.focus(); throw new Error('请先填写选品需求。'); }
        if (!budget.reportValidity()) return;
        const maxPrice = budget.value === '' ? null : budget.valueAsNumber;
        if (text !== draft.requirements || maxPrice !== (draft.max_price ?? null)) {
          const updated = await request(endpoint, { action: 'requirements', expectedVersion: session.version,
            requirements: text, max_price: maxPrice });
          render(updated, { editedQueries });
        } else if (session.state === 'requirements_ready') {
          render(await request(endpoint, { action: 'preview', expectedVersion: session.version }));
        } else {
          render(payload, { editedQueries });
        }
        step.focus();
      }),
      el('p', { class: 'hint', text: '如果想让 AI 重新推荐搜索词，可以回到原对话继续。' }));
    return;
  }
  panel.append(el('p', { text: draft.requirements }));
  if (draft.max_price != null) panel.append(el('p', { class: 'hint', text: `预算上限 ${draft.max_price} 元，用于结果统计。` }));
  if (draft.requirements_changed) panel.append(el('p', { class: 'hint', text: '需求已更新。请确认下方的原搜索词是否仍然合适。' }));
  const input = el('textarea', { id: 'guided-queries', rows: 3, maxlength: 250 });
  input.value = editedQueries ?? draft.queries.join('\n');
  panel.append(el('label', { for: 'guided-queries', text: '搜索词（每行一个，可修改）' }), input,
    el('p', { class: 'hint', text: '最多 3 个搜索词，每个词查看淘宝搜索结果的第一页。' }));
  if (draft.signal_watch) panel.append(el('p', { text: `这轮重点看：${draft.signal_watch}` }));
  if (draft.falsifier) panel.append(el('p', { class: 'hint', text: `同时核对：${draft.falsifier}` }));
  const notice = el('div', { class: 'inline-actions' });
  let version = session.version;
  let savedText = draft.queries.join('\n');
  let start;
  const back = action('上一步', async () => {
    start.disabled = true;
    try {
      const current = await request(endpoint);
      const unchanged = current.session.version === version;
      render(current, { showRequirements: unchanged, editedQueries: unchanged ? input.value : undefined });
      step.focus();
    } finally {
      start.disabled = false;
    }
  });
  back.classList.add('ghost');
  start = action('开始采集', async () => {
    clearNode(notice);
    input.disabled = true;
    back.disabled = true;
    message.textContent = '正在提交采集，完成后会在这里显示结果。';
    try {
      if (input.value !== savedText) {
        const updated = await request(endpoint, { action: 'edit', expectedVersion: version, queries: input.value.split(/\r?\n/) });
        version = updated.session.version;
        savedText = input.value;
      }
      const result = await request(endpoint, { action: 'capture', expectedVersion: version });
      if (result.setup) {
        message.textContent = result.setup.message;
        notice.append(el('a', { href: configUrl(result.setup.site_id),
          target: '_blank', rel: 'noopener', text: '打开站点设置' }),
          el('span', { class: 'hint', text: '设置完成后，回来再点「开始采集」。' }));
        return;
      }
      message.textContent = result.capture_error?.message || '';
      renderResult(result.run, result.facts);
      step.focus();
    } finally {
      input.disabled = false;
      back.disabled = false;
    }
  });
  panel.append(el('div', { class: 'inline-actions' }, [back, start]), notice);
}

function renderIntake(config) {
  step.textContent = '说一句你想找什么';
  const hostLabel = config.host === 'workbuddy' ? 'WorkBuddy' : 'Codex';
  const goal = el('textarea', { id: 'assistant-intake', rows: 4, maxlength: 500,
    placeholder: '例如：我想买 20 元以内的文具，优先考虑笔记本和中性笔。' });
  const handoff = el('div', { class: 'assistant-handoff', hidden: true });
  const prompt = el('textarea', { id: 'assistant-prompt', rows: 4, readonly: true });
  function makePrompt() {
    const text = goal.value.trim();
    if (!text) { goal.focus(); throw new Error('请先写下你想找什么。'); }
    return `请使用 auto-pick-studio（智能选品助手）帮我选品。我的需求：${text}\n请根据需求准备搜索词，并给我「打开需求卡」的链接。`;
  }
  const prepare = action(config.mode === 'manual' ? '准备 WorkBuddy 需求' : '手动复制需求', () => {
    prompt.value = makePrompt();
    handoff.hidden = false;
    prompt.focus();
    prompt.select();
  });
  const copy = action('复制需求', async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      message.textContent = `已复制，粘贴到 ${hostLabel} 对话即可。`;
    } catch {
      prompt.focus();
      prompt.select();
      message.textContent = '文字已选中，按 Ctrl+C 复制。';
    }
  });
  goal.addEventListener('input', () => {
    handoff.hidden = true;
    message.textContent = '';
  });
  handoff.append(el('label', { for: 'assistant-prompt', text: '发给 AI 的需求' }), prompt,
    copy, el('p', { class: 'hint', text: `粘贴到已安装选品助手的 ${hostLabel} 对话，再点 AI 返回的「打开需求卡」。` }));
  const buttons = el('div', { class: 'inline-actions' });
  if (config.host === 'codex') {
    const link = el('a', { class: 'host-launch', href: 'codex://threads/new', text: '在 Codex 打开' });
    link.addEventListener('click', (event) => {
      try {
        const query = new URLSearchParams({ prompt: makePrompt() });
        if (config.workspace) query.set('path', config.workspace);
        link.href = `codex://threads/new?${query}`;
        message.textContent = '需求已准备好。请在 Codex 对话中核对并发送。';
      } catch (error) { event.preventDefault(); message.textContent = error.message; }
    });
    buttons.append(link);
  } else if (config.mode === 'prefill') {
    buttons.append(action('在 WorkBuddy 打开', async () => {
      const result = await request('/api/assistant-host/workbuddy-link', { prompt: makePrompt() });
      location.assign(result.url);
    }));
  }
  buttons.append(prepare);
  panel.append(el('p', { class: 'hint' }, [`当前使用 ${hostLabel} · `, el('a', { href: configUrl(), text: '切换 AI' })]),
    el('label', { for: 'assistant-intake', text: '这次的选品需求' }), goal, buttons, handoff);
  if (config.mode === 'manual') panel.append(el('p', { class: 'hint', text: 'WorkBuddy 直连尚未配置，请先使用复制方式。' }));
}

async function init() {
  if (sessionId) {
    document.querySelector('#assistant-workbench').href = `/?assistant=${encodeURIComponent(sessionId)}`;
    document.querySelector('#assistant-settings').href = configUrl();
  }
  try {
    token = (await request('/api/bootstrap')).token;
    if (!sessionId) {
      renderIntake(await request('/api/assistant-host'));
      return;
    }
    render(await request(endpoint));
  } catch (error) {
    step.textContent = '暂时无法打开需求卡';
    message.textContent = error.message;
  }
}

init();
