import { el, clearNode } from './lib/render.js';

const step = document.querySelector('#guide-step');
const stages = document.querySelector('#guide-stages');
const panel = document.querySelector('#guide-body');
const message = document.querySelector('#guide-message');
const nextCard = document.querySelector('#guide-next');
const nextBody = document.querySelector('#guide-next-body');
const nextToggle = document.querySelector('#guide-next-toggle');
let sessionId = new URLSearchParams(location.search).get('session');
let endpoint;
const draftKey = () => `auto-pick-assistant-draft:${sessionId || 'new'}`;
const configUrl = (site) => {
  const params = new URLSearchParams({ view: 'config' });
  if (sessionId) params.set('assistant', sessionId);
  if (site) params.set('site', site);
  return `/?${params}`;
};

function setSession(id) {
  sessionId = id;
  endpoint = `/api/assistant-guide/${encodeURIComponent(id)}`;
  document.querySelector('#assistant-workbench').href = `/?assistant=${encodeURIComponent(id)}`;
  document.querySelector('#assistant-settings').href = configUrl();
}

async function request(path, body) {
  const token = body ? (await request('/api/bootstrap')).token : null;
  const response = await fetch(path, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auto-pick-token': token },
    body: JSON.stringify(body),
  } : {});
  const result = await response.json().catch(() => null);
  if (response.status === 404 && path === '/api/assistant-guide' && body) {
    throw new Error('当前选品台服务没有加载新接口。请在最新项目目录重启 npm start，再回到本页重试。');
  }
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
  panel.append(el('h3', { text: '本次选品目标' }), el('p', { text: draft.requirements_summary || draft.requirements }));
  if (draft.max_price != null) panel.append(el('p', { class: 'hint', text: `预算上限 ${draft.max_price} 元，用于结果统计。` }));
  if (draft.requirements_changed) panel.append(el('p', { class: 'hint', text: '需求已更新。请确认下方的原搜索词是否仍然合适。' }));
  const input = el('textarea', { id: 'guided-queries', rows: 3, maxlength: 2025 });
  input.value = editedQueries ?? draft.queries.join('\n');
  if (draft.local_fallback) {
    panel.append(el('p', { class: 'guide-outcome', dataset: { state: 'partial' },
      text: 'Codex 未能及时返回，以下是本机草案。采集后需要核对价格、规格和需求证据。' }));
  }
  panel.append(el('h3', { text: '推荐优先看的商品' }));
  const recommendations = draft.recommendations || [];
  const selectionKey = `auto-pick-assistant-selection:${session.session_id}`;
  let savedSelection = {};
  try { savedSelection = JSON.parse(localStorage.getItem(selectionKey) || '{}') || {}; } catch { /* 使用空选择 */ }
  const choices = recommendations.map((item, index) => {
    const id = `guide-selection-${index}`;
    const check = el('input', { type: 'checkbox', id });
    const query = el('input', { type: 'text', id: `${id}-query`, maxlength: 80 });
    check.checked = Object.hasOwn(savedSelection, item.name);
    query.value = check.checked ? savedSelection[item.name] : item.name;
    const editor = el('div', { class: 'guide-query-editor' }, [el('label', { for: query.id, text: `${item.name}的搜索词` }), query]);
    const row = el('li', {}, [el('label', { for: id, class: 'guide-product-choice' }, [check, el('strong', { text: item.name })]),
      el('p', { text: item.reason }), el('p', { class: 'hint', text: `采集后核对：${item.check}` })]);
    return { item, check, query, editor, row };
  });
  const selectionStatus = el('p', { class: 'hint', role: 'status' });
  const all = el('button', { type: 'button', class: 'ghost', text: '全选' });
  const none = el('button', { type: 'button', class: 'ghost', text: '清空选择' });
  if (choices.length) {
    panel.append(el('div', { class: 'inline-actions' }, [all, none]),
      el('ol', { class: 'guide-recommendations' }, choices.map(({ row }) => row)));
  } else {
    panel.append(el('p', { class: 'hint', text: '当前没有具体商品建议。可以补充用途，或先采集候选，再根据实际价格和规格比较。' }));
  }
  if (draft.signal_watch) panel.append(el('p', { text: `这轮重点看：${draft.signal_watch}` }));
  if (draft.falsifier) panel.append(el('p', { class: 'hint', text: `同时核对：${draft.falsifier}` }));
  const queriesPanel = el('details', { class: 'guide-search-settings' }, [
    el('summary', { text: '查看或编辑采集搜索词' }),
    el('p', { class: 'hint', text: '每个选中的搜索词查看淘宝搜索结果的第一页。' }),
    ...(choices.length ? choices.map(({ editor }) => editor) : [el('label', { for: 'guided-queries', text: '搜索词（每行一个，可修改）' }), input]),
  ]);
  panel.append(queriesPanel);
  if (editedQueries !== undefined) queriesPanel.open = true;
  const notice = el('div', { class: 'inline-actions' });
  let version = session.version;
  let captureDraft = draft;
  let savedText = draft.queries.join('\n');
  let start;
  function syncSelection() {
    if (!choices.length) return;
    const selected = choices.filter(({ check }) => check.checked);
    selectionStatus.textContent = `已选 ${selected.length} / ${choices.length} 个，采集只执行已选商品。`;
    for (const { check, editor } of choices) editor.hidden = !check.checked;
    start.disabled = !selected.length;
    all.disabled = selected.length === choices.length;
    none.disabled = !selected.length;
    localStorage.setItem(selectionKey, JSON.stringify(Object.fromEntries(selected.map(({ item, query }) => [item.name, query.value]))));
  }
  const refresh = draft.local_fallback ? action('重新整理搜索词', async () => {
    start.disabled = true;
    back.disabled = true;
    try {
      render(await request(endpoint, { action: 'refresh_local', expectedVersion: version }));
      step.focus();
    } finally {
      start.disabled = false;
      back.disabled = false;
      syncSelection();
    }
  }) : null;
  refresh?.classList.add('ghost');
  const back = action('上一步', async () => {
    start.disabled = true;
    if (refresh) refresh.disabled = true;
    try {
      const current = await request(endpoint);
      const unchanged = current.session.version === version;
      render(current, { showRequirements: unchanged, editedQueries: unchanged && !choices.length ? input.value : undefined });
      step.focus();
    } finally {
      start.disabled = false;
      if (refresh) refresh.disabled = false;
      syncSelection();
    }
  });
  back.classList.add('ghost');
  start = action('开始采集', async () => {
    clearNode(notice);
    input.disabled = true;
    back.disabled = true;
    if (refresh) refresh.disabled = true;
    try {
      const selected = choices.filter(({ check }) => check.checked);
      const terms = choices.length ? selected.map(({ query }) => query.value.trim()) : input.value.split(/\r?\n/);
      if (!terms.length || (choices.length && terms.some((term) => !term))) {
        if (selected.length) queriesPanel.open = true;
        throw new Error('请至少勾选一个商品，并填写搜索词。');
      }
      for (const { check, query } of choices) { check.disabled = true; query.disabled = true; }
      all.disabled = true;
      none.disabled = true;
      const submitted = terms.join('\n');
      if (submitted !== savedText) {
        const updated = await request(endpoint, { action: 'edit', expectedVersion: version, queries: terms });
        version = updated.session.version;
        captureDraft = updated.draft;
        savedText = submitted;
      }
      const result = await capture(version, captureDraft.queries.length, notice);
      if (!result) return;
      renderResult({ session: { ...session, version: version + 1 }, draft: captureDraft, ...result });
      step.focus();
    } finally {
      input.disabled = false;
      back.disabled = false;
      if (refresh) refresh.disabled = false;
      for (const { check, query } of choices) { check.disabled = false; query.disabled = false; }
      syncSelection();
    }
  });
  for (const { check, query } of choices) {
    check.addEventListener('change', syncSelection);
    query.addEventListener('input', syncSelection);
  }
  for (const [button, checked] of [[all, true], [none, false]]) {
    button.addEventListener('click', () => {
      for (const { check } of choices) check.checked = checked;
      syncSelection();
    });
  }
  syncSelection();
  panel.append(el('p', { class: 'hint', text: '待采集。确认搜索词后，点击「开始采集」。' }),
    el('div', { class: 'inline-actions guide-capture-actions' }, [back, start, refresh, choices.length ? selectionStatus : null]), notice);
}

function renderIntake(target) {
  const status = el('p', { class: 'hint assistant-intake-status', role: 'status' });
  const goal = el('textarea', { id: 'assistant-intake', rows: 4, maxlength: 500,
    placeholder: '例如：我想买 20 元以内的文具，优先考虑笔记本和中性笔。' });
  const key = draftKey();
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { stored = null; }
  goal.value = stored?.requirements || '';
  status.textContent = stored?.message || '';
  const save = (draft) => {
    stored = draft;
    localStorage.setItem(key, JSON.stringify(draft));
  };
  goal.addEventListener('input', () => {
    save({ requirements: goal.value });
    status.textContent = '';
  });
  const next = action('下一步：生成选品建议', async () => {
    const requirements = goal.value.trim();
    if (!requirements) {
      goal.focus();
      throw new Error('请先写下你想找什么。');
    }
    if (target === panel) {
      showStage(2, '正在生成选品建议');
      step.focus();
    }
    status.textContent = '正在等待 Codex 生成建议。若未及时返回，将先展示可编辑的本机草案。';
    goal.readOnly = true;
    try {
      if (!stored?.id) save({ id: crypto.randomUUID(), requirements });
      let job = stored.started ? null : await request('/api/assistant-guide', { jobId: stored.id, requirements });
      if (job && !job.id) throw new Error('请重启选品台服务，加载最新的任务恢复接口。');
      if (job) {
        goal.value = job.requirements;
        save({ id: job.id, requirements: job.requirements, started: true });
      }
      const progressUrl = `/api/assistant-guide?job=${encodeURIComponent(stored.id)}`;
      while (!job || job.state === 'running') {
        if (job) await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await request(progressUrl);
        if (!job) {
          const message = '本机服务已重启或任务已过期。需求已保留，可以重新生成。';
          save({ requirements: goal.value, message });
          throw new Error(message);
        }
      }
      if (job.state === 'failed') {
        save({ requirements: goal.value, message: job.message });
        throw new Error(job.message);
      }
      const result = job.result;
      save({ requirements: goal.value, resultSession: result.session.session_id });
      setSession(result.session.session_id);
      const url = new URL(location.href);
      url.searchParams.set('session', sessionId);
      history.pushState(null, '', url);
      clearNode(nextBody);
      nextBody.hidden = true;
      nextCard.hidden = true;
      nextToggle.setAttribute('aria-expanded', 'false');
      message.textContent = '';
      render(result);
      step.focus();
    } catch (error) {
      if (target === panel) showStage(1, '说一句你想找什么');
      throw error;
    } finally {
      goal.readOnly = false;
    }
  }, status);
  const controls = el('div', { class: 'inline-actions' }, [next, el('a', { href: configUrl(), target: '_blank', rel: 'noopener', text: 'AI 配置' })]);
  if (stored?.resultSession) {
    controls.append(el('a', { href: `/assistant.html?session=${encodeURIComponent(stored.resultSession)}`, text: '查看上次生成的建议' }));
  }
  target.append(el('label', { for: 'assistant-intake', text: target === panel ? '这次的选品需求' : '下一个商品的需求' }),
    goal, controls, status,
    el('p', { class: 'hint' }, [el('a', { href: '/#retail-research', text: '已有搜索词？直接查国内商品' })]));
  if (stored?.id) next.click();
  return goal;
}

async function init() {
  if (!sessionId) {
    showStage(1, '说一句你想找什么');
    renderIntake(panel);
    return;
  }
  setSession(sessionId);
  try {
    const payload = await request(endpoint);
    const initialAction = payload.needs_local_repair ? 'refresh_local'
      : payload.session.state === 'requirements_ready' ? 'preview' : null;
    if (initialAction) {
      try {
        render(await request(endpoint, { action: initialAction, expectedVersion: payload.session.version }));
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
  if (!nextCard.hidden && localStorage.getItem(draftKey())) nextToggle.click();
}

window.addEventListener('popstate', () => location.reload());
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
init();
