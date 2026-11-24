/**
 * 唯一写入口下游：串行 + commandId 幂等 + 未完成命令落盘重放。
 * MV3 worker 会被回收，纯内存队列必丢未完成复合操作，故 pending 状态落盘。
 */
import { failure } from '../shared/errors.js';

export function createCommandBus({ commands, handlers, onChanged }) {
  let tail = Promise.resolve();

  async function execute(command) {
    if (!command || !command.commandId || !command.type) {
      return failure('STORAGE_FAILED');
    }
    const cached = await commands.findDone(command.commandId);
    if (cached.data) return cached.data; // 幂等：重放不重复写
    await commands.pending(command);

    const run = tail.then(() => {
      const handler = handlers[command.type];
      return handler
        ? handler(command)
        : failure('STORAGE_FAILED', { field: `未知命令 ${command.type}` });
    });
    tail = run.catch(() => undefined);

    let result;
    try {
      result = await run;
    } catch (e) {
      // 异常只在 worker 边界转成行内文案，不吞、不弹窗
      result = failure('STORAGE_FAILED');
      result.debug = String(e && e.message ? e.message : e);
    }
    await commands.done(command.commandId, result);
    await commands.removePending(command.commandId);
    if (onChanged) onChanged({ type: 'STATE_CHANGED', result, commandType: command.type });
    return result;
  }

  /** worker 启动 / 重启时调用：扫描未完成命令并串行重放。 */
  async function replay() {
    const list = await commands.listPending();
    for (const command of list.data || []) await execute(command);
  }

  return Object.freeze({ execute, replay });
}
