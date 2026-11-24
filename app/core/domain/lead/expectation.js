import { makeEvent } from '../decision/event.js';

/** 当时判断写入后不可改，只能追加更正并带时间戳。 */
export const IMMUTABLE_FIELDS = Object.freeze([
  'falsifiable_expectation',
  'confidence',
  'counter_reason',
  'marked_at',
  'marker_source',
]);

export function canEdit(field) {
  return !IMMUTABLE_FIELDS.includes(field);
}

export function correctionEvent({ eventId, fingerprintId, text, occurredAt, commandId }) {
  return makeEvent({
    eventId,
    fingerprintId,
    kind: 'correction',
    payload: Object.freeze({ text: String(text || '').trim(), at: occurredAt }),
    occurredAt,
    commandId,
  });
}
