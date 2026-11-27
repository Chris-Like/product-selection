import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const chartBundle = fileURLToPath(new URL('../../node_modules/echarts/dist/echarts.min.js', import.meta.url));

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

/** 只服务 app/web 和固定的图表依赖。 */
export async function serveStatic(webDir, pathname, res) {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = path.resolve(webDir);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }
  try {
    const buf = await fs.readFile(pathname === '/vendor/echarts.min.js' ? chartBundle : target);
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}
