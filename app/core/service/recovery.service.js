/** P4 撤销 / P7 清空可恢复 / 会话复位 / 一键停用。 */
import { ok } from '../shared/result.js';
import { newOpId, newEventId, newClearId } from '../shared/id.js';
import { makeEvent } from '../domain/decision/event.js';
import { RECORD_STATUS, CLEAR_CONFIRM_TOKEN } from '../shared/types.js';
import { failure } from '../shared/errors.js';

export function createRecoveryService({ snapshots, events, recoverable, settings, session, admin }) {
  const now = () => new Date().toISOString();

  async function undo(command) {
    let target = command.targetId;
    if (!target) {
      const all = (await snapshots.listAll()).data || [];
      const latest = all.filter((s) => s.record_status === RECORD_STATUS.STORED)
        .sort((a, b) => String(b.as_of).localeCompare(String(a.as_of)))[0];
      if (!latest) return failure('STORAGE_FAILED');
      target = latest.snapshot_id;
    }
    const op = {
      op_id: newOpId(),
      kind: 'undo',
      target_refs: [target],
      inverse_params: { prevStatus: RECORD_STATUS.STORED },
      created_at: now(),
      command_id: command.commandId,
    };
    await recoverable.put(op);
    const r = await snapshots.softDelete(target, op.op_id);
    return r.ok ? ok({ opId: op.op_id, target, undone: true }) : r;
  }

  /** 恢复 = 追加 restore 事件 + 重新投影；不复制实体、不覆盖原记录（P4 / H-10）。 */
  async function restore(command) {
    const list = (await recoverable.list()).data || [];
    const op = list.find((o) => o.op_id === command.opId) || list[list.length - 1];
    if (!op) return failure('STORAGE_FAILED');
    if (!op.restored_at) {
      for (const fpOrId of op.target_refs) {
        await events.append(makeEvent({
          eventId: newEventId(),
          fingerprintId: String(fpOrId),
          kind: 'restore',
          payload: { op_id: op.op_id },
          occurredAt: now(),
          commandId: command.commandId,
        }));
      }
      if (op.kind === 'undo') {
        for (const id of op.target_refs) await snapshots.markStatus(id, RECORD_STATUS.STORED);
      } else if (op.kind === 'clear') {
        await admin.restoreFromTrash(op.clear_id);
      }
      await recoverable.markRestored(op.op_id);
    }
    return ok({ opId: op.op_id, restored: true, kind: op.kind });
  }

  /** 唯一二次确认；作用域排除 recoverable / trash / cmd / settings / session。 */
  async function clearAll(command) {
    if (command.confirmToken !== CLEAR_CONFIRM_TOKEN) {
      return failure('STORAGE_FAILED', { field: '清空确认' });
    }
    const keys = (await admin.listBusinessKeys()).data || [];
    const clearId = newClearId();
    await admin.moveToTrash(clearId, keys);
    const op = {
      op_id: newOpId(),
      kind: 'clear',
      target_refs: [],
      clear_id: clearId,
      inverse_params: { keyCount: keys.length },
      created_at: now(),
      command_id: command.commandId,
    };
    await recoverable.put(op);
    return ok({ opId: op.op_id, clearId, movedKeys: keys.length, canRestore: true });
  }

  async function setSiteEnabled(command) {
    const cfg = (await settings.get()).data;
    const next = { ...(cfg.sites_enabled || {}), [command.site]: Boolean(command.enabled) };
    await settings.patch({ sites_enabled: next });
    return ok({ site: command.site, enabled: Boolean(command.enabled) });
  }

  async function setTempSortOff(command) {
    await session.setTempSortOff(Boolean(command.value));
    return ok({ tempSortOff: Boolean(command.value) });
  }

  async function resetTempSortOff() {
    // 新形态：无 service worker 回收问题，仅由页面 load 显式复位（目的不变，触发点改写）
    await session.setTempSortOff(false);
    return ok({ tempSortOff: false });
  }

  return Object.freeze({ undo, restore, clearAll, setSiteEnabled, setTempSortOff, resetTempSortOff });
}
