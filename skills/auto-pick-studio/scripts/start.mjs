/** 启动本机服务。用法：node skills/auto-pick-studio/scripts/start.mjs */
import { startServer } from '../../../app/server/index.js';

try {
  const { port } = await startServer();
  console.log(`选品台已启动：http://127.0.0.1:${port}/`);
  console.log('页面配置站点 → 重建登录态 → 点「采集」。按 Ctrl+C 停止。');
} catch (e) {
  const msg = String(e && e.message ? e.message : e);
  if (msg.includes('EADDRINUSE')) {
    console.error('端口被占用了。换一个端口再启动，例如 AUTO_PICK_PORT=17861 node skills/auto-pick-studio/scripts/start.mjs');
  } else {
    console.error(`启动失败：${msg}`);
  }
  process.exitCode = 1;
}
