/** 全局唯一 ID；不含 PII、不含页面文本。 */

function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 无 crypto 时的降级（仅测试环境可能触发）：时间戳 + 随机串
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const newCommandId = () => `cmd_${uuid()}`;
export const newSnapshotId = () => `snap_${uuid()}`;
export const newEventId = () => `evt_${uuid()}`;
export const newOpId = () => `op_${uuid()}`;
export const newBatchId = () => `batch_${uuid()}`;
export const newFingerprintId = () => `fp_${uuid()}`;
export const newClearId = () => `clear_${uuid()}`;
