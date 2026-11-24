import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRepositories } from '../store/index.js';
import { PATHS, DEFAULT_PORT } from '../store/paths.js';
import { createTaskRuntime } from './task.js';
import { createRouter } from './router.js';

/** 仅绑定 127.0.0.1；端口为示例值，待确认，可用 AUTO_PICK_PORT 覆盖。 */
export async function startServer({ port = Number(process.env.AUTO_PICK_PORT || DEFAULT_PORT), paths = PATHS } = {}) {
  const repos = await createRepositories(paths);
  const runtime = await createTaskRuntime({ repos, paths });
  const agentToken = randomUUID();
  // 仅供同机 Skill 读取；令牌不经网页 API 返回，因此普通页面无法伪造模型回写。
  await fs.writeFile(paths.agentBridgeFile, JSON.stringify({ port, token: agentToken }), { encoding: 'utf8', mode: 0o600 });
  const router = createRouter({ runtime, paths, sessionToken: randomUUID(), agentToken });
  const server = http.createServer((req, res) => {
    Promise.resolve(router(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'STORAGE_FAILED', message: '本机服务这一步没走通', hint: '刷新页面后再试' }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.once('close', async () => {
    try {
      const current = JSON.parse(await fs.readFile(paths.agentBridgeFile, 'utf8'));
      if (current.token === agentToken) await fs.unlink(paths.agentBridgeFile);
    } catch { /* 服务已结束或临时文件已清理 */ }
  });
  return { server, port, runtime, repos };
}
