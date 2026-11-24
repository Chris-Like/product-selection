import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from '../../app/core/shared/result.js';
import { createCommandBus } from '../../app/core/service/command-bus.js';

function memoryCommands() {
  const done = new Map();
  const pending = new Map();
  return {
    pending: async (c) => { pending.set(c.commandId, c); return ok(); },
    done: async (id, r) => { done.set(id, r); return ok(); },
    findDone: async (id) => ok(done.get(id) || null),
    listPending: async () => ok([...pending.values()]),
    removePending: async (id) => { pending.delete(id); return ok(); },
    _done: done,
    _pending: pending,
  };
}

test('同一 commandId 重放不重复写（幂等）', async () => {
  const commands = memoryCommands();
  let calls = 0;
  const bus = createCommandBus({
    commands,
    handlers: { PING: async (c) => { calls += 1; return ok({ id: c.commandId, calls }); } },
  });
  const cmd = { type: 'PING', commandId: 'cmd_1' };
  const a = await bus.execute(cmd);
  const b = await bus.execute(cmd);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(commands._pending.size, 0);
});

test('未完成命令落盘，worker 重启可重放', async () => {
  const commands = memoryCommands();
  await commands.pending({ type: 'PING', commandId: 'cmd_2' });
  let calls = 0;
  const bus = createCommandBus({
    commands,
    handlers: { PING: async () => { calls += 1; return ok({ replayed: true }); } },
  });
  await bus.replay();
  assert.equal(calls, 1);
  assert.equal(commands._pending.size, 0);
  assert.equal(commands._done.has('cmd_2'), true);
});

test('未知命令与异常都转成行内 Result，不抛出、不弹窗', async () => {
  const commands = memoryCommands();
  const bus = createCommandBus({ commands, handlers: { BOOM: async () => { throw new Error('x'); } } });
  const r1 = await bus.execute({ type: 'BOOM', commandId: 'cmd_3' });
  const r2 = await bus.execute({ type: 'MISSING', commandId: 'cmd_4' });
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
  assert.ok(r1.hint && r2.hint);
});
