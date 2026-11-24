/** 候选三态：补齐回边，待定 ↔ 已定 ↔ 已放弃；每次切换追加事件，不覆盖。 */
import { CANDIDATE_STATES } from '../../shared/types.js';
import { makeEvent } from './event.js';

export function canTransition(from, to) {
  if (!CANDIDATE_STATES.includes(to)) return false;
  return from == null || CANDIDATE_STATES.includes(from);
}

export function stateEvent({ eventId, fingerprintId, state, note, reviewDate, premortem, occurredAt, commandId }) {
  if (!canTransition(null, state)) throw new Error(`非法三态: ${state}`);
  return makeEvent({
    eventId,
    fingerprintId,
    kind: 'state_set',
    payload: {
      state,
      context_note: note || null,
      review_date: reviewDate || null,
      premortem: premortem || null,
    },
    occurredAt,
    commandId,
  });
}
