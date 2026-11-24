/**
 * Repository 接口先行：M1 定义，M2 只换 Impl（storage-local → indexeddb），上层零改动。
 * 这里用「契约方法名清单」做可执行的自检；实现见 storage-local/index.js。
 * 标注 (M1 扩展) 的方法为实现层必要补充，不改变评审定义的接口语义。
 */
export const REPOSITORY_CONTRACT = Object.freeze({
  SnapshotRepository: ['append', 'findByBatch', 'findByFingerprint', 'markStatus', 'softDelete', 'listAll', 'updateField'],
  EventRepository: ['append', 'listByFingerprint'],
  RuleRepository: ['get', 'put'],
  SettingsRepository: ['get', 'patch'],
  SessionRepository: ['getTempSortOff', 'setTempSortOff'],
  RecoverableRepository: ['put', 'list', 'latest', 'markRestored'],
  CommandLogRepository: ['pending', 'done', 'findDone', 'listPending', 'removePending'],
  AdminRepository: ['ensureBatch', 'listBatches', 'listBusinessKeys', 'moveToTrash', 'restoreFromTrash', 'getPageState', 'setPageState'],
  AnalysisRepository: ['get', 'set', 'list'],
});

/** 自检用：确认实现对象满足契约。 */
export function assertContract(repos) {
  const missing = [];
  for (const [name, methods] of Object.entries(REPOSITORY_CONTRACT)) {
    if (!repos[name]) {
      missing.push(`缺少 ${name}`);
      continue;
    }
    for (const m of methods) {
      if (typeof repos[name][m] !== 'function') missing.push(`${name}.${m}`);
    }
  }
  return { ok: missing.length === 0, missing };
}
