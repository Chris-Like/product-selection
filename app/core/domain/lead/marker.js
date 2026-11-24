/** 打标三要素：全部选填；写入不可改由 append-only 事件结构性保证（H-10）。 */
import { makeEvent } from '../decision/event.js';

export const MARKER_INPUT_FIELDS = Object.freeze([
  'falsifiable_expectation',
  'confidence',
  'counter_reason',
  'marker_observed_at',
  'marker_note',
]);

export function markerEvent({ eventId, fingerprintId, payload = {}, occurredAt, commandId, unset = false }) {
  const safe = {};
  for (const key of MARKER_INPUT_FIELDS) {
    if (payload[key] !== undefined && payload[key] !== '') safe[key] = payload[key];
  }
  return makeEvent({
    eventId,
    fingerprintId,
    kind: unset ? 'marker_unset' : 'marker_set',
    payload: unset ? {} : Object.freeze(safe),
    occurredAt,
    commandId,
  });
}
