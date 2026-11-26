import { el, clearNode } from './lib/render.js';

const step = document.querySelector('#guide-step');
const stages = document.querySelector('#guide-stages');
const panel = document.querySelector('#guide-body');
const message = document.querySelector('#guide-message');
const nextCard = document.querySelector('#guide-next');
const nextBody = document.querySelector('#guide-next-body');
const nextToggle = document.querySelector('#guide-next-toggle');
const sessionId = new URLSearchParams(location.search).get('session');
const endpoint = `/api/assistant-guide/${encodeURIComponent(sessionId || '')}`;
const configUrl = (site) => {
  const params = new URLSearchParams({ view: 'config' });
  if (sessionId) params.set('assistant', sessionId);
  if (site) params.set('site', site);
  return `/?${params}`;
};

async function request(path, body) {
  const token = body ? (await request('/api/bootstrap')).token : null;
  const response = await fetch(path, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auto-pick-token': token },
    body: JSON.stringify(body),
  } : {});
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.message || '本机选品服务暂时不可用，请刷新重试。');
  return result.data;
}

function action(text, work, status = message) {
  const button = el('button', { type: 'button', text });
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try { await work(); }
    catch (error) { status.textContent = error.message; }
    finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
  return button;
}

function showStage(current, title) {
  stages.hidden = false;
  for (const [index, item] of Array.from(stages.children).entries()) {
    const number = index + 1;
    item.classList.toggle('complete', number < current);
    if (number === current) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.firstElementChild.textContent = number < current ? '✓' : number;
  }
  step.textContent = title;
}

function captureProgress(run, queryCount) {
  const completed = (run?.sites || []).filter((item) => !['pending', 'running'].includes(item.status)).length;
  return run?.state === 'running'
    ? `正在采集，已处理 ${completed} / ${queryCount} 个搜索词，已记录 ${run.stored || 0} 条。`
    : '正在准备采集…';
}

function watchCapture(onUpdate) {
  let stopped = false;
  let timer;
  async function poll() {
    try {
      const payload = await request(endpoint);
      if (!stopped) onUpdate(payload);
    } catch {
      // 保留最近一次状态，等待本机服务恢复连接。
    }
    if (!stopped) timer = setTimeout(poll, 1500);
  }
  timer = setTimeout(poll, 500);
  return () => { stopped = true; clearTimeout(timer); };
}

nextToggle.addEventListener('click', () => {
  nextBody.hidden = !nextBody.hidden;
  nextToggle.setAttribute('aria-expanded', String(!nextBody.hidden));
  if (nextBody.hidden) return;
  const goal = nextBody.querySelector('textarea') || renderIntake(nextBody);
  goal.focus();
});

function renderResult({ session, draft, run, facts, capture_error }) {
  showStage(3, '采集结果');
  clearNode(panel);
  panel.append(el('p', { text: draft.requirements }));
  if (!run) {
    const notice = el('div', { class: 'inline-actions' });
    panel.append(el('p', { text: capture_error?.message || '本轮还没有采集记录。' }),
      action('开始采集', async () => {
        const result = await capture(session.version - 1, draft.queries.length, notice);
        if (result) {
          renderResult({ session, draft, ...result });
          step.focus();
        }
      }), notice);
    nextCard.hidden = false;
    return;
  }
  if (run.state === 'running' && !run.ended_at) {
    const progress = el('p', { class: 'guide-outcome', dataset: { state: 'running' }, role: 'status', text: captureProgress(run, draft.queries.length) });
    panel.append(progress);
    const stop = watchCapture((payload) => {
      if (payload.run?.ended_at) {
        stop();
        renderResult(payload);
      } else {
        const text = captureProgress(payload.run, draft.queries.length);
        if (progress.textContent !== text) progress.textContent = text;
      }
    });
    return;
  }
  const status = { done: '采集完成', partial: '采集部分完成', stopped: '采集已停止',
    not_started: '采集未开始' }[run.state] || '请查看本轮状态';
  panel.append(el('div', { class: 'guide-outcome', dataset: { state: run.state }, role: 'status' }, [
    el('strong', { text: status }), el('span', { text: `本轮共采集 ${run.stored || 0} 条商品观察。` }),
  ]));
  if (run.state === 'done' && !run.stored) {
    panel.append(el('p', { class: 'hint', text: '这轮搜索没有返回商品，可以换一组搜索词再试。' }));
  } else if (run.state !== 'done' && (capture_error?.message || run.message)) {
    panel.append(el('p', { class: 'hint', text: capture_error?.message || run.message }));
  }
  if (facts?.budget && facts.raw_observation_count) {
    const budget = facts.budget;
    panel.append(el('p', { text: `按页面展示价统计，${budget.max_price} 元及以内 ${budget.at_or_below} 条，超预算 ${budget.above} 条，缺可比价格 ${budget.unavailable} 条。` }));
  }
  for (const item of run.sites || []) {
    if (item.status !== 'done' && item.reason) {
      panel.append(el('p', { class: 'hint', text: `${item.keyword || item.name}：${item.reason}` }));
    }
  }
  if (run.batch_id && run.stored > 0) {
    const params = new URLSearchParams({ batch: run.batch_id, assistant: sessionId });
    panel.append(el('a', { href: `/?${params}#results`, text: '查看本轮商品明细' }));
  }
  nextCard.hidden = false;
}

async function capture(version, queryCount, notice) {
  message.textContent = captureProgress(null);
  const stop = watchCapture(({ run }) => {
    const progress = run?.ended_at ? '正在汇总采集结果…' : captureProgress(run, queryCount);
    if (message.textContent !== progress) message.textContent = progress;
  });
  try {
    const result = await request(endpoint, { action: 'capture', expectedVersion: version });
    if (result.setup) {
      message.textContent = result.setup.message;
      clearNode(notice);
      notice.append(el('a', { href: configUrl(result.setup.site_id), target: '_blank', rel: 'noopener', text: '打开站点设置' }),
        el('span', { class: 'hint', text: ' 设置完成后，回来再点「开始采集」。' }));
      return null;
    }
    message.textContent = '';
    return result;
  } catch (error) {
    const current = await request(endpoint).catch(() => null);
    if (current?.run) {
      message.textContent = '';
      return current;
    }
    throw error;
  } finally {
    stop();
  }
}

function render(payload, { showRequirements = false, editedQueries } = {}) {
  const { session, draft } = payload;
  clearNode(panel);
  if (session.state === 'plan_confirmed') { renderResult(payload); return; }
  if (!['requirements_ready', 'plan_draft'].includes(session.state)) {
    step.textContent = '请回到对话继续';
    return;
  }
  const needsPreview = showRequirements || session.state === 'requirements_ready';
  showStage(needsPreview ? 1 : 2, needsPreview ? '修改需求' : '选品建议');
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
  panel.append(el('h3', { text: '这次要找的商品' }), el('p', { text: draft.requirements }));
  if (draft.max_price != null) panel.append(el('p', { class: 'hint', text: `预算上限 ${draft.max_price} 元，用于结果统计。` }));
  if (draft.requirements_changed) panel.append(el('p', { class: 'hint', text: '需求已更新。请确认下方的原搜索词是否仍然合适。' }));
  const input = el('textarea', { id: 'guided-queries', rows: 3, maxlength: 250 });
  input.value = editedQueries ?? draft.queries.join('\n');
  panel.append(el('label', { for: 'guided-queries', text: 'AI 推荐的搜索词（每行一个，可修改）' }), input,
    el('p', { class: 'hint', text: '最多 3 个搜索词，每个词查看淘宝搜索结果的第一页。' }));
  if (draft.signal_watch) panel.append(el('p', { text: `这轮重点看：${draft.signal_watch}` }));
  if (draft.falsifier) panel.append(el('p', { class: 'hint', text: `同时核对：${draft.falsifier}` }));
  const notice = el('div', { class: 'inline-actions' });
  let version = session.version;
  let captureDraft = draft;
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
    try {
      if (input.value !== savedText) {
        const updated = await request(endpoint, { action: 'edit', expectedVersion: version, queries: input.value.split(/\r?\n/) });
        version = updated.session.version;
        captureDraft = updated.draft;
        savedText = input.value;
      }
      const result = await capture(version, captureDraft.queries.length, notice);
      if (!result) return;
      renderResult({ session: { ...session, version: version + 1 }, draft: captureDraft, ...result });
      step.focus();
    } finally {
      input.disabled = false;
      back.disabled = false;
    }
  });
  panel.append(el('p', { class: 'hint', text: '待采集。确认搜索词后，点击「开始采集」。' }),
    el('div', { class: 'inline-actions' }, [back, start]), notice);
}

function renderIntake(target) {
  const status = el('p', { class: 'hint assistant-intake-status', role: 'status' });
  const hostStatus = el('p', { class: 'hint', role: 'status' });
  const hostControls = el('div', { class: 'inline-actions' });
  const handoffHint = el('p', { class: 'hint' });
  let hostLabel = 'Codex 或 WorkBuddy';
  const goal = el('textarea', { id: 'assistant-intake', rows: 4, maxlength: 500,
    placeholder: '例如：我想买 20 元以内的文具，优先考虑笔记本和中性笔。' });
  const handoff = el('div', { class: 'assistant-handoff', hidden: true });
  const prompt = el('textarea', { id: 'assistant-prompt', rows: 4, readonly: true });
  function makePrompt() {
    const text = goal.value.trim();
    if (!text) { goal.focus(); throw new Error('请先写下你想找什么。'); }
    return `请使用 auto-pick-studio（智能选品助手）开始一个新的选品任务。我的需求：${text}\n请给出需求摘要、搜索词及选品关注点，并给我「打开需求卡」的链接。我会在确认后点击「开始采集」。`;
  }
  const prepare = action('手动复制需求', () => {
    prompt.value = makePrompt();
    handoff.hidden = false;
    handoffHint.textContent = `粘贴到已安装选品助手的 ${hostLabel} 新对话，再点 AI 返回的「打开需求卡」。`;
    prompt.focus();
    prompt.select();
  }, status);
  const copy = action('复制需求', async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      status.textContent = `已复制，粘贴到 ${hostLabel} 的新对话即可。`;
    } catch {
      prompt.focus();
      prompt.select();
      status.textContent = '文字已选中，按 Ctrl+C 复制。';
    }
  }, status);
  goal.addEventListener('input', () => {
    handoff.hidden = true;
    status.textContent = '';
  });
  handoff.append(el('label', { for: 'assistant-prompt', text: '发给 AI 的需求' }), prompt, copy, handoffHint);

  function launchButton(config) {
    if (config.host === 'workbuddy' && config.mode === 'prefill') {
      return action('在 WorkBuddy 打开', async () => {
        const result = await request('/api/assistant-host/workbuddy-link', { prompt: makePrompt() });
        location.assign(result.url);
      }, status);
    }
    if (config.host !== 'codex') return null;
    const link = el('a', { class: 'host-launch', href: 'codex://threads/new', text: '在 Codex 打开' });
    link.addEventListener('click', (event) => {
      try {
        const query = new URLSearchParams({ prompt: makePrompt() });
        if (config.workspace) query.set('path', config.workspace);
        link.href = `codex://threads/new?${query}`;
        status.textContent = '需求已准备好。请在 Codex 对话中核对并发送。';
      } catch (error) { event.preventDefault(); status.textContent = error.message; }
    });
    return link;
  }

  async function loadHost() {
    hostStatus.textContent = '正在读取 AI 配置…';
    try {
      const config = await request('/api/assistant-host');
      if (!['codex', 'workbuddy'].includes(config?.host)) throw new Error('AI 配置不可用');
      hostLabel = config.host === 'workbuddy' ? 'WorkBuddy' : 'Codex';
      hostStatus.textContent = config.host === 'workbuddy' && config.mode === 'manual'
        ? 'WorkBuddy 直连尚未配置，可以手动复制需求。' : `当前使用 ${hostLabel}`;
      const launch = launchButton(config);
      if (launch) hostControls.prepend(launch);
      retry.remove();
    } catch {
      hostStatus.textContent = '暂时无法读取 AI 配置，仍可填写并手动复制需求。';
      hostControls.append(retry);
    }
  }
  const retry = action('重试连接 AI', loadHost, status);
  retry.classList.add('ghost');
  hostControls.append(prepare);
  target.append(el('label', { for: 'assistant-intake', text: target === panel ? '这次的选品需求' : '下一个商品的需求' }),
    goal, hostControls, hostStatus, handoff, status);
  target.append(el('p', { class: 'hint' }, [el('a', { href: configUrl(), text: '切换 AI' })]));
  target.append(el('p', { class: 'hint' }, [el('a', { href: '/#retail-research', text: '已有搜索词？直接查国内商品' })]));
  void loadHost();
  return goal;
}

async function init() {
  if (!sessionId) {
    step.textContent = '说一句你想找什么';
    renderIntake(panel);
    return;
  }
  document.querySelector('#assistant-workbench').href = `/?assistant=${encodeURIComponent(sessionId)}`;
  document.querySelector('#assistant-settings').href = configUrl();
  try {
    const payload = await request(endpoint);
    if (payload.session.state === 'requirements_ready') {
      try {
        render(await request(endpoint, { action: 'preview', expectedVersion: payload.session.version }));
      } catch {
        render(await request(endpoint).catch(() => payload));
      }
    } else {
      render(payload);
    }
  } catch (error) {
    step.textContent = '暂时无法打开需求卡';
    panel.append(el('a', { href: '/assistant.html', class: 'host-launch', text: '新建选品需求' }));
    message.textContent = error.message;
  }
}

init();
