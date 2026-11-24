import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../../app/core/domain/decision/event.js';
import { project } from '../../app/core/domain/decision/projection.js';
import { markerEvent } from '../../app/core/domain/lead/marker.js';
import { correctionEvent, canEdit, IMMUTABLE_FIELDS } from '../../app/core/domain/lead/expectation.js';
import { stateEvent, canTransition } from '../../app/core/domain/decision/state.js';

const ev = (kind, payload, at) => makeEvent({
  eventId: `evt_${kind}_${at}`, fingerprintId: 'fp_1', kind,
  payload, occurredAt: `2026-11-18T0${at}:00:00.000Z`, commandId: `cmd_${at}`,
});

test('当前态由 append-only 事件流投影，可重建', () => {
  const events = [
    ev('marker_set', { falsifiable_expectation: '两周内同类上新变多' }, 1),
    ev('state_set', { state: '已定' }, 2),
    ev('correction', { text: '补充反面证据', at: '2026-11-18T03:00:00.000Z' }, 3),
  ];
  const p = project(events);
  assert.equal(p.is_lead_marker, true);
  assert.equal(p.candidate_state, '已定');
  assert.equal(p.corrections.length, 1);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(canEdit('falsifiable_expectation'), false);
  assert.ok(IMMUTABLE_FIELDS.includes('falsifiable_expectation'));
});

test('标记有回边、三态可来回切换', () => {
  const p = project([ev('marker_set', {}, 1), ev('marker_unset', {}, 2)]);
  assert.equal(p.is_lead_marker, false);
  assert.equal(canTransition('已放弃', '待定'), true);
  assert.equal(canTransition(null, '不存在'), false);
  assert.doesNotThrow(() => stateEvent({
    eventId: 'evt_s', fingerprintId: 'fp_1', state: '已放弃',
    occurredAt: new Date().toISOString(), commandId: 'cmd_s',
  }));
});

test('恢复只追加 restore 事件，不覆盖原记录与当时预期', () => {
  const events = [
    markerEvent({ eventId: 'evt_m', fingerprintId: 'fp_1', payload: { falsifiable_expectation: '原始预期' }, occurredAt: '2026-11-18T01:00:00.000Z', commandId: 'cmd_m' }),
    correctionEvent({ eventId: 'evt_c', fingerprintId: 'fp_1', text: '更正', occurredAt: '2026-11-18T02:00:00.000Z', commandId: 'cmd_c' }),
    ev('restore', { op_id: 'op_1' }, 4),
  ];
  const p = project(events);
  assert.equal(p.marker.falsifiable_expectation, '原始预期');
  assert.equal(p.corrections.length, 1);
  assert.equal(p.log.length, 3);
});
