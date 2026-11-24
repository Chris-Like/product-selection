/** 触发一轮采集（与页面「采集」按钮共用同一入口）。需先运行 start.mjs。 */
const port = Number(process.env.AUTO_PICK_PORT || 17860); // 示例值，待确认
const base = `http://127.0.0.1:${port}`;

try {
  const boot = await fetch(`${base}/api/bootstrap`);
  const token = (await boot.json()).data?.token;
  const r = await fetch(`${base}/api/capture`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-auto-pick-token': token }, body: '{}',
  });
  const out = await r.json();
  if (!out.ok) {
    console.error(`${out.message || '采集没跑起来'} · ${out.hint || ''}`);
    process.exitCode = 1;
  } else {
    console.log(`本轮状态：${out.data.state}`);
    for (const s of out.data.results || []) {
      console.log(`  ${s.name || s.site_id}: ${s.status}${s.reason ? ` — ${s.reason}` : ''}`);
    }
  }
} catch {
  console.error('连不上本机服务。先运行：node skills/auto-pick-studio/scripts/start.mjs');
  process.exitCode = 1;
}
