import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, isOk, isErr } from '../../app/core/shared/result.js';
import { describeError, ERROR_CODES } from '../../app/core/shared/errors.js';

test('ok / err 结构与判定', () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
  const e = err('URL_REJECTED', '链接不合法', '重新采集');
  assert.equal(isOk(e), false);
  assert.equal(isErr(e), true);
  assert.equal(isOk(ok(null)), true);
});

test('err 必须有可执行的下一步 hint（H-08）', () => {
  assert.throws(() => err('URL_REJECTED', '链接不合法', ''));
  assert.throws(() => err('', '文案', '下一步'));
});

test('每个内部错误码都有说人话的文案 + 下一步', () => {
  for (const code of ERROR_CODES) {
    const d = describeError(code, { site: '淘宝', field: '评价数' });
    assert.ok(d.message.length > 0, code);
    assert.ok(d.hint.length > 0, code);
    assert.ok(!/系统繁忙|未知错误|操作失败/.test(d.message), code);
    assert.ok(d.icon, code);
  }
});
