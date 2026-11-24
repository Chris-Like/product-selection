/** 领先标的：打标（零必填）、清单导入（弱匹配、不自动合并 / 不自动挂标记）。 */
import { ok } from '../shared/result.js';
import { newEventId } from '../shared/id.js';
import { markerEvent } from '../domain/lead/marker.js';
import { weakMatch } from '../domain/fingerprint/matcher.js';

export function createMarkerService({ snapshots, events }) {
  async function setMarker(command) {
    const e = markerEvent({
      eventId: newEventId(),
      fingerprintId: command.fingerprintId,
      payload: command.payload || {},
      occurredAt: new Date().toISOString(),
      commandId: command.commandId,
      unset: Boolean(command.unset),
    });
    const r = await events.append(e);
    return r.ok ? ok({ eventId: e.event_id, isLeadMarker: !command.unset }) : r;
  }

  /** 逐行弱匹配；多候选用 ambiguous 交给行内确认，不落库、不挂标记。 */
  async function importList(command) {
    const all = (await snapshots.listAll()).data || [];
    const rows = Array.isArray(command.rows) ? command.rows : [];
    const results = rows.slice(0, 500).map((row) => {
      const m = weakMatch(row, all);
      return {
        row,
        status: m.fingerprintIds.length === 0
          ? '未匹配'
          : m.ambiguous ? '需本人确认' : '已关联',
        candidates: m.matches.map((s) => ({
          snapshot_id: s.snapshot_id,
          fingerprint_id: s.fingerprint_id,
          title: s.title,
        })),
        ambiguous: m.ambiguous,
      };
    });
    return ok({ results, count: rows.length });
  }

  /** 行内确认只回传关联结果；M1 不合并，故不写库、不自动挂领先标记（P6 校验点）。 */
  async function confirmWeakMatch(command) {
    return ok({ linked: true, fingerprintId: command.fingerprintId, rowId: command.rowId });
  }

  return Object.freeze({ setMarker, importList, confirmWeakMatch });
}
