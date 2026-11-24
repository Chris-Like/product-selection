/** append-only 决策事件：单一事实源。当前态一律由 projection 派生，不独立落库。 */

export const EVENT_KINDS = Object.freeze([
  'marker_set',
  'marker_unset',
  'state_set',
  'correction',
  'manual_value',
  'ignore',
  'restore',
]);

export function makeEvent({ eventId, fingerprintId, kind, payload = {}, occurredAt, commandId }) {
  if (!EVENT_KINDS.includes(kind)) throw new Error(`未知事件类型: ${kind}`);
  if (!eventId || !fingerprintId || !occurredAt || !commandId) {
    throw new Error('事件必须带 eventId / fingerprintId / occurredAt / commandId');
  }
  return Object.freeze({
    event_id: eventId,
    fingerprint_id: fingerprintId,
    kind,
    payload: Object.freeze({ ...payload }),
    occurred_at: occurredAt,
    command_id: commandId,
    immutable: true,
  });
}
