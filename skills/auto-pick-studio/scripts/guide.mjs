/**
 * 宿主 AI 协作桥接。此脚本只在本机 Skill 中运行，并读取服务启动时创建的短期令牌。
 * 用法：
 *   node scripts/guide.mjs start direction_validation
 *   node scripts/guide.mjs next
 *   node scripts/guide.mjs readiness
 *   node scripts/guide.mjs session <sessionId>
 *   node scripts/guide.mjs question <sessionId> <version> <field> <question> [why]
 *   node scripts/guide.mjs answer <sessionId> <version> <answer>
 *   node scripts/guide.mjs draft <sessionId> <version> <keyword> [signalWatch] [falsifier] [maxPrice]
 *   node scripts/guide.mjs confirm <sessionId> <version>
 *   node scripts/guide.mjs confirm-and-capture <sessionId> <version>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bridgeFile = path.join(root, 'data', '.agent-bridge.json');
const [command, ...args] = process.argv.slice(2);

async function bridge() {
  try { return JSON.parse(await fs.readFile(bridgeFile, 'utf8')); }
  catch { throw new Error('选品台未运行。先执行 node skills/auto-pick-studio/scripts/start.mjs'); }
}
async function request(method, pathname, body) {
  const b = await bridge();
  const r = await fetch(`http://127.0.0.1:${b.port}${pathname}`, {
    method, headers: { 'content-type': 'application/json', 'x-auto-pick-agent-token': b.token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await r.json();
  if (!payload.ok) throw new Error(`${payload.message || '请求失败'}${payload.hint ? `：${payload.hint}` : ''}`);
  const data = payload.data;
  if (['stage', 'session'].includes(command) && data?.draft?.requirements) {
    data.assistant_url = `http://127.0.0.1:${b.port}/assistant.html?session=${encodeURIComponent(data.session.session_id)}`;
  }
  if (command === 'readiness' || data?.setup) {
    const setup = data.setup || data;
    if (!setup.ready) setup.setup_url = `http://127.0.0.1:${b.port}/?view=config&site=${encodeURIComponent(setup.site_id)}`;
  }
  if (['confirm-and-capture', 'session'].includes(command) && data?.run?.batch_id) {
    data.results_url = `http://127.0.0.1:${b.port}/?batch=${encodeURIComponent(data.run.batch_id)}#results`;
  }
  console.log(JSON.stringify(data, null, 2));
}

try {
  if (command === 'next') await request('GET', '/api/agent-bridge/next');
  else if (command === 'readiness') await request('GET', '/api/agent-bridge/readiness');
  else if (command === 'session') await request('GET', `/api/agent-bridge/sessions/${encodeURIComponent(args[0] || '')}`);
  else if (command === 'start') await request('POST', '/api/agent-bridge/sessions', { taskType: args[0] });
  else if (command === 'question') {
    const [sessionId, version, field, question, why = '这一步用于明确下一轮检索与观察口径。'] = args;
    await request('POST', `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, { action: 'guidance', expectedVersion: Number(version), guidance: { type: 'question', field, question, why_now: why } });
  } else if (command === 'answer') {
    const [sessionId, version, ...answer] = args;
    await request('POST', `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, { action: 'answer', expectedVersion: Number(version), answer: answer.join(' ') });
  } else if (command === 'draft' || command === 'stage') {
    const [sessionId, version, keyword, signal_watch = '', falsifier = '检查是否存在与该方向不相符的样本。', maxPrice, requirements] = args;
    const queries = (keyword || '').split('|').map((query) => query.trim()).filter(Boolean);
    const max_price = maxPrice ? Number(maxPrice) : null;
    const type = command === 'stage' ? 'guided_plan' : 'plan_draft';
    await request('POST', `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, { action: 'guidance', expectedVersion: Number(version), guidance: { type, requirements, queries, signal_watch, falsifier, max_price } });
  } else if (command === 'preview') {
    const [sessionId, version] = args;
    await request('POST', `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, { action: 'preview', expectedVersion: Number(version) });
  } else if (command === 'confirm' || command === 'confirm-and-capture') {
    const [sessionId, version] = args;
    await request('POST', `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, { action: command, expectedVersion: Number(version), siteId: 'taobao' });
  } else {
    throw new Error('用法：start | next | readiness | session | question | answer | stage | preview | draft | confirm | confirm-and-capture');
  }
} catch (e) {
  console.error(String(e.message || e));
  process.exitCode = 1;
}
