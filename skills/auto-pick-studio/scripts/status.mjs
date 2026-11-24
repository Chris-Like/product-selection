/** 查看任务态与逐站状态。需先运行 start.mjs。 */
const port = Number(process.env.AUTO_PICK_PORT || 17860); // 示例值，待确认
const base = `http://127.0.0.1:${port}`;

try {
  const [stateR, taskR, sitesR] = await Promise.all([
    fetch(`${base}/api/state`),
    fetch(`${base}/api/capture/status`),
    fetch(`${base}/api/sites`),
  ]);
  const state = await stateR.json();
  const task = await taskR.json();
  const sites = await sitesR.json();
  console.log(`服务：已连接 · schema ${state.data?.schemaVersion ?? '未知'} · 运行中 ${state.data?.running ? '是' : '否'}`);
  console.log(`任务：${task.data?.state || '未知'} ${task.data?.message || ''}`);
  for (const s of task.data?.sites || []) {
    console.log(`  ${s.name || s.site_id}: ${s.status}${s.reason ? ` — ${s.reason}` : ''}`);
  }
  console.log(`站点：${(sites.data || []).map((s) => `${s.site_id}(${s.enabled ? '启用' : '停用'}/${s.auth_status})`).join('、') || '无'}`);
} catch {
  console.error('连不上本机服务。先运行：node skills/auto-pick-studio/scripts/start.mjs');
  process.exitCode = 1;
}
