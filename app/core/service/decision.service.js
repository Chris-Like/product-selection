/** 三态 / 更正 / 手工补值 / 忽略异常：一律追加不可变事件，当前态由投影派生。 */
import { ok } from '../shared/result.js';
import { newEventId } from '../shared/id.js';
import { FIELD_STATUS } from '../shared/types.js';
import { stateEvent } from '../domain/decision/state.js';
import { makeEvent } from '../domain/decision/event.js';
import { correctionEvent } from '../domain/lead/expectation.js';

export function createDecisionService({ snapshots, events }) {
  const now = () => new Date().toISOString();

  async function setState(command) {
    const e = stateEvent({
      eventId: newEventId(),
      fingerprintId: command.fingerprintId,
      state: command.state,
      note: command.note,
      reviewDate: command.reviewDate,
      premortem: command.premortem,
      occurredAt: now(),
      commandId: command.commandId,
    });
    const r = await events.append(e);
    return r.ok ? ok({ eventId: e.event_id, state: command.state }) : r;
  }

  async function appendCorrection(command) {
    const e = correctionEvent({
      eventId: newEventId(),
      fingerprintId: command.fingerprintId || command.targetId,
      text: command.text,
      occurredAt: now(),
      commandId: command.commandId,
    });
    const r = await events.append(e);
    return r.ok ? ok({ eventId: e.event_id, correctedAt: e.occurred_at }) : r;
  }

  async function manualFieldValue(command) {
    const r = await snapshots.updateField(
      command.snapshotId, command.field, command.value, FIELD_STATUS.MANUAL,
    );
    if (!r.ok) return r;
    const e = makeEvent({
      eventId: newEventId(),
      fingerprintId: command.fingerprintId || 'unknown',
      kind: 'manual_value',
      payload: { snapshot_id: command.snapshotId, field: command.field, note: command.note || null },
      occurredAt: now(),
      commandId: command.commandId,
    });
    await events.append(e);
    return ok({ snapshotId: command.snapshotId, field: command.field });
  }

  async function ignoreAnomaly(command) {
    const e = makeEvent({
      eventId: newEventId(),
      fingerprintId: command.fingerprintId || 'unknown',
      kind: 'ignore',
      payload: { snapshot_id: command.snapshotId, field: command.field },
      occurredAt: now(),
      commandId: command.commandId,
    });
    const r = await events.append(e);
    return r.ok ? ok({ ignored: true }) : r;
  }

  return Object.freeze({ setState, appendCorrection, manualFieldValue, ignoreAnomaly });
}
