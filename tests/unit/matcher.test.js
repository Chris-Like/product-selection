import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, fingerprintIdFor, weakMatch } from '../../app/core/domain/fingerprint/matcher.js';

test('标题归一化：忽略空格、标点、全半角、大小写', () => {
  assert.equal(normalizeTitle(' ＡＢＣ　连衣裙 '), normalizeTitle('abc连衣裙'));
  assert.equal(normalizeTitle(null), '');
});

test('指纹 ID 确定性，不做图片相似度', () => {
  assert.equal(fingerprintIdFor({ itemId: '1', title: 'A B' }), fingerprintIdFor({ itemId: '1', title: 'ab' }));
  assert.notEqual(fingerprintIdFor({ itemId: '1', title: 'A' }), fingerprintIdFor({ itemId: '2', title: 'A' }));
});

test('弱匹配命中多条 → ambiguous，由本人确认，不自动合并 / 不自动挂标记', () => {
  const snapshots = [
    { snapshot_id: 's1', fingerprint_id: 'fp_a', item_id: '1', title: '连衣裙 A' },
    { snapshot_id: 's2', fingerprint_id: 'fp_b', item_id: '2', title: '连衣裙 A' },
  ];
  const m = weakMatch({ title: '连衣裙 A' }, snapshots);
  assert.equal(m.ambiguous, true);
  assert.equal(m.fingerprintIds.length, 2);
  const none = weakMatch({ item_id: '9', title: '不存在的品' }, snapshots);
  assert.equal(none.fingerprintIds.length, 0);
});
