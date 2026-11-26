/** 本机 HTTP 路由：静态页 + JSON API；所有写操作经 runtime.submit() 单一入口。 */
import { serveStatic } from './static.js';
import { providerReportInput } from '../core/service/provider-research.js';

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

function reply(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function createRouter({ runtime, paths, sessionToken = null, agentToken = null }) {
  return async function handle(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    if (!p.startsWith('/api/')) return serveStatic(paths.webDir, p, res);

    const isWrite = ['POST', 'PATCH', 'DELETE'].includes(req.method);
    const body = isWrite ? await readJson(req) : {};
    const siteMatch = p.match(/^\/api\/sites\/([^/]+)$/);
    const authMatch = p.match(/^\/api\/sites\/([^/]+)\/auth$/);
    const authFinish = p.match(/^\/api\/sites\/([^/]+)\/auth\/finish$/);
    const authCancel = p.match(/^\/api\/sites\/([^/]+)\/auth\/cancel$/);
    const researchMatch = p.match(/^\/api\/research-sessions\/([^/]+)$/);
    const researchAnswer = p.match(/^\/api\/research-sessions\/([^/]+)\/answers$/);
    const researchConfirm = p.match(/^\/api\/research-sessions\/([^/]+)\/plan\/confirm$/);
    const researchCancel = p.match(/^\/api\/research-sessions\/([^/]+)\/cancel$/);
    const agentSession = p.match(/^\/api\/agent-bridge\/sessions\/([^/]+)$/);
    const guidedSession = p.match(/^\/api\/assistant-guide\/([^/]+)$/);

    try {
      // 宿主 AI 的本机桥接独立于网页会话令牌；模型回写不能经普通 Web API 提交。
      if (p.startsWith('/api/agent-bridge/')) {
        if (!agentToken || req.headers['x-auto-pick-agent-token'] !== agentToken) return reply(res, { ok: false, code: 'PERMISSION_DENIED', message: '宿主 AI 桥接校验失败', hint: '从 Skill 的 guide.mjs 领取任务' }, 403);
        if (req.method === 'POST' && p === '/api/agent-bridge/provider-research') {
          if (!['fastmoss', 'linkfox'].includes(body?.provider)) return reply(res, { ok: false, message: '国内数据请使用零售查询或表格导入接口' }, 400);
          return reply(res, await runtime.submit({ type: 'PROVIDER_RESEARCH_SAVE', report: providerReportInput(body) }));
        }
        if (req.method === 'POST' && p === '/api/agent-bridge/retail-search') return reply(res, await runtime.retailSearch(body));
        if (req.method === 'GET' && p === '/api/agent-bridge/next') return reply(res, await runtime.agentNext());
        if (req.method === 'GET' && p === '/api/agent-bridge/readiness') return reply(res, await runtime.assistantReadiness());
        if (agentSession && req.method === 'GET') {
          const id = decodeURIComponent(agentSession[1]);
          const guided = await runtime.guidedStatus(id);
          return reply(res, guided.ok ? guided : await runtime.agentResearch(id));
        }
        if (req.method === 'POST' && p === '/api/agent-bridge/sessions') return reply(res, await runtime.agentStart(body));
        if (agentSession && req.method === 'POST') {
          const sessionId = decodeURIComponent(agentSession[1]);
          if (body.action === 'preview') return reply(res, await runtime.submit({ sessionId, expectedVersion: body.expectedVersion, action: 'preview', type: 'GUIDED_PLAN_UPDATE' }));
          if (body.action === 'confirm-and-capture') {
            const expectedVersion = Number(body.expectedVersion);
            return reply(res, await runtime.submit({ sessionId, expectedVersion, type: 'ASSISTANT_CAPTURE' }));
          }
          if (body.action === 'answer') return reply(res, await runtime.agentAnswer({ ...body, sessionId }));
          if (body.action === 'guidance') {
            if (body.guidance?.type === 'guided_plan') {
              return reply(res, await runtime.submit({ ...body, sessionId, type: 'GUIDED_PLAN_STAGE' }));
            }
            return reply(res, await runtime.agentGuidance({ ...body, sessionId }));
          }
          if (body.action === 'confirm') return reply(res, await runtime.submit({ ...body, sessionId, type: 'PLAN_CONFIRM' }));
        }
        return reply(res, { ok: false, code: 'STORAGE_FAILED', message: '没有这个宿主 AI 接口', hint: '使用 guide.mjs 支持的命令' }, 404);
      }
      if (req.method === 'GET' && p === '/api/bootstrap') return reply(res, { ok: true, data: { token: sessionToken } });
      if (isWrite) {
        const origin = req.headers.origin;
        const host = req.headers.host;
        const sameOrigin = !origin || origin === `http://${host}`;
        if (!sessionToken || req.headers['x-auto-pick-token'] !== sessionToken || !sameOrigin) {
          return reply(res, { ok: false, code: 'PERMISSION_DENIED', message: '本机写请求未通过会话校验', hint: '从选品台页面重新打开后再试' }, 403);
        }
      }
      if (req.method === 'GET' && p === '/api/state') return reply(res, await runtime.state());
      if (req.method === 'GET' && p === '/api/assistant-host') return reply(res, await runtime.assistantHost());
      if (req.method === 'POST' && p === '/api/assistant-host') {
        return reply(res, await runtime.submit({ type: 'ASSISTANT_HOST_UPDATE', host: body.host }));
      }
      if (req.method === 'POST' && p === '/api/assistant-host/workbuddy-link') {
        return reply(res, await runtime.workBuddyHandoff(body.prompt));
      }
      if (req.method === 'GET' && p === '/api/provider-research') return reply(res, await runtime.providerReports(u.searchParams.get('provider')));
      if (req.method === 'GET' && p === '/api/retail/status') return reply(res, runtime.retailStatus());
      if (req.method === 'POST' && p === '/api/retail/import') return reply(res, await runtime.retailImport(body));
      if (req.method === 'POST' && p === '/api/retail/search') return reply(res, await runtime.retailSearch(body));
      if (guidedSession) {
        const sessionId = decodeURIComponent(guidedSession[1]);
        if (req.method === 'GET') return reply(res, await runtime.guidedStatus(sessionId));
        if (req.method === 'POST' && body.action === 'capture') {
          return reply(res, await runtime.submit({ sessionId, expectedVersion: Number(body.expectedVersion), guidedOnly: true, type: 'ASSISTANT_CAPTURE' }));
        }
        if (req.method === 'POST' && ['preview', 'edit', 'requirements'].includes(body.action)) {
          return reply(res, await runtime.submit({ sessionId, expectedVersion: body.expectedVersion,
            queries: body.queries, requirements: body.requirements, max_price: body.max_price,
            action: body.action, type: 'GUIDED_PLAN_UPDATE' }));
        }
      }
      if (req.method === 'GET' && p === '/api/sites') return reply(res, await runtime.sites());
      if (req.method === 'GET' && p === '/api/recoverables') return reply(res, await runtime.recoverables());
      if (req.method === 'GET' && p === '/api/runs') return reply(res, await runtime.runs());
      if (req.method === 'GET' && p === '/api/intent/guide') return reply(res, await runtime.guide(u.searchParams.get('siteId') || 'taobao'));
      if (req.method === 'GET' && p === '/api/facts') return reply(res, await runtime.analysisGet(`facts:${u.searchParams.get('batchId') || ''}`));
      if (req.method === 'GET' && p === '/api/intent') return reply(res, await runtime.analysisGet(`intent:${u.searchParams.get('batchId') || ''}`));
      if (req.method === 'GET' && p === '/api/plan') return reply(res, await runtime.analysisGet(`plan:${u.searchParams.get('batchId') || ''}`));
      if (req.method === 'GET' && p === '/api/research/latest') return reply(res, await runtime.activeResearch());
      if (req.method === 'GET' && p === '/api/professional-plan') return reply(res, await runtime.professionalPlan());
      if (req.method === 'GET' && p === '/api/effective-plan') return reply(res, await runtime.effectivePlan());
      if (req.method === 'GET' && researchMatch) return reply(res, await runtime.researchSession(decodeURIComponent(researchMatch[1])));
      if (req.method === 'GET' && p === '/api/capture/status') {
        return reply(res, (await runtime.repos.TaskRepository.get()));
      }
      if (req.method === 'GET' && p === '/api/results') {
        return reply(res, await runtime.results({
          onlyLead: u.searchParams.get('onlyLead') === '1',
          counterView: u.searchParams.get('counterView') === '1',
          search: u.searchParams.get('search') || '',
          batchId: u.searchParams.get('batchId') || 'latest',
          evidenceBatch: u.searchParams.get('evidenceBatch'),
          evidenceQuery: u.searchParams.get('evidenceQuery'),
          evidenceBudget: u.searchParams.get('evidenceBudget'),
        }));
      }
      if (req.method === 'GET' && authMatch) {
        return reply(res, { ok: true, data: await runtime.authStatus(decodeURIComponent(authMatch[1])) });
      }
      if (req.method === 'POST' && p === '/api/session/reset') return reply(res, await runtime.resetSession());

      if (req.method === 'POST' && p === '/api/settings') return reply(res, await runtime.submit({ ...body, type: 'SETTINGS_UPDATE' }));
      if (req.method === 'POST' && p === '/api/intent') return reply(res, await runtime.submit({ ...body, type: 'INTENT_SET' }));
      if (req.method === 'POST' && p === '/api/plan') return reply(res, await runtime.submit({ ...body, type: 'PLAN_COMPILE' }));
      if (req.method === 'POST' && p === '/api/agent/requests') return reply(res, await runtime.submit({ ...body, type: body.kind === 'observation' ? 'OBSERVATION_REQUEST' : 'GUIDE_REQUEST' }));
      if (req.method === 'POST' && p === '/api/research-sessions') return reply(res, await runtime.submit({ ...body, type: 'RESEARCH_SESSION_START' }));
      if (researchAnswer && req.method === 'POST') return reply(res, await runtime.submit({ ...body, sessionId: decodeURIComponent(researchAnswer[1]), type: 'GUIDANCE_ANSWER_SET' }));
      if (researchConfirm && req.method === 'POST') return reply(res, await runtime.submit({ ...body, sessionId: decodeURIComponent(researchConfirm[1]), type: 'PLAN_CONFIRM' }));
      if (researchCancel && req.method === 'POST') return reply(res, await runtime.submit({ ...body, sessionId: decodeURIComponent(researchCancel[1]), type: 'RESEARCH_SESSION_CANCEL' }));
      if (req.method === 'POST' && p === '/api/professional-plan/draft') return reply(res, await runtime.submit({ ...body, type: 'PRO_PLAN_DRAFT' }));
      if (req.method === 'POST' && p === '/api/professional-plan/confirm') return reply(res, await runtime.submit({ ...body, type: 'PRO_PLAN_CONFIRM' }));
      if (req.method === 'POST' && p === '/api/workbench-capture') return reply(res, await runtime.submit({ expectedPlanId: body.expectedPlanId, type: 'WORKBENCH_CAPTURE' }));
      if (req.method === 'POST' && p === '/api/capture/stop') return reply(res, runtime.stopCapture());

      if (req.method === 'POST' && p === '/api/command' && !['ASSISTANT_CAPTURE', 'GUIDED_PLAN_STAGE', 'PROVIDER_RESEARCH_SAVE'].includes(body.type)) return reply(res, await runtime.submit(body));
      if (req.method === 'POST' && p === '/api/sites') return reply(res, await runtime.submit({ ...body, type: 'SITE_ADD' }));
      if (siteMatch && req.method === 'PATCH') {
        return reply(res, await runtime.submit({ ...body, siteId: decodeURIComponent(siteMatch[1]), type: 'SITE_UPDATE' }));
      }
      if (siteMatch && req.method === 'DELETE') {
        return reply(res, await runtime.submit({ siteId: decodeURIComponent(siteMatch[1]), type: 'SITE_REMOVE' }));
      }
      if (authMatch && req.method === 'POST') {
        return reply(res, await runtime.submit({ ...body, siteId: decodeURIComponent(authMatch[1]), type: 'AUTH_BEGIN' }));
      }
      if (authFinish && req.method === 'POST') {
        return reply(res, await runtime.submit({ siteId: decodeURIComponent(authFinish[1]), type: 'AUTH_FINISH' }));
      }
      if (authCancel && req.method === 'POST') {
        return reply(res, await runtime.submit({ siteId: decodeURIComponent(authCancel[1]), type: 'AUTH_CANCEL' }));
      }

      const direct = {
        'POST /api/capture': 'CAPTURE_RUN',
        'POST /api/marker': 'MARKER_SET',
        'POST /api/decision': 'DECISION_STATE',
        'POST /api/restore': 'RESTORE',
        'POST /api/clear': 'CLEAR_ALL',
        'POST /api/undo': 'UNDO',
        'POST /api/temp-sort': 'TEMP_SORT_OFF',
      }[`${req.method} ${p}`];
      if (direct) return reply(res, await runtime.submit({ ...body, type: direct }));

      return reply(res, { ok: false, code: 'STORAGE_FAILED', message: '没有这个接口', hint: '刷新页面后再试' }, 404);
    } catch (e) {
      return reply(res, {
        ok: false, code: 'STORAGE_FAILED',
        message: `本机服务这一步没走通：${String(e && e.message ? e.message : e)}`,
        hint: '刷新结果区后再试；数据未丢失',
      }, 500);
    }
  };
}
