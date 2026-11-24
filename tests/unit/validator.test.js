import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRawFields, satisfiesRecordGate } from '../../app/core/domain/snapshot/validator.js';
import { emptyRule, isRuleReady } from '../../app/core/domain/rule/site-rule.js';
import { FIELD_STATUS } from '../../app/core/shared/types.js';

test('规则未回填：全部字段「未获取」，不猜测不填 0 不阻断', () => {
  const r = validateRawFields({ title: '肉眼看到的标题', price: '99' }, emptyRule(), 'PG-1');
  assert.equal(r.rulePending, true);
  assert.equal(r.fields.title, null);
  assert.equal(r.fieldStatus.price, FIELD_STATUS.MISSING);
  assert.equal(isRuleReady(emptyRule()).ok, false);
});

test('记录成立前置条件（系统生成，非用户必填）', () => {
  const base = { pageKind: 'PG-1', url: 'https://item.taobao.com/item.htm?id=1' };
  assert.equal(satisfiesRecordGate({ ...base, fields: { source_url: base.url, item_id: '1' } }).ok, true);
  assert.equal(satisfiesRecordGate({ ...base, pageKind: 'UNSUPPORTED', fields: { source_url: base.url, item_id: '1' } }).ok, false);
  assert.equal(satisfiesRecordGate({ ...base, fields: { source_url: 'javascript:x', item_id: '1' } }).ok, false);
});

test('字段态与记录态正交：值异常不改变「已落库即成功」', () => {
  const rule = {
    status: 'ready',
    field_selector_map: { 'PG-1': { item_id: '#id', title: '#t', source_url: '#u', price: '#p', review_count: '#r' } },
    anchor_selectors: { 'PG-1': ['#t'], 'PG-2': ['#t'] },
    value_ranges: { review_count_max: 100 },
    price_type_enum: ['标价'],
  };
  const r = validateRawFields({ item_id: '1', title: 'A', source_url: 'https://item.taobao.com/i', price: '99', review_count: '99999' }, rule, 'PG-1');
  assert.equal(r.fieldStatus.review_count, FIELD_STATUS.ABNORMAL);
  assert.ok(r.issues.some((i) => i.field === 'review_count'));
  assert.equal(satisfiesRecordGate({ pageKind: 'PG-1', url: 'https://item.taobao.com/i', fields: r.fields }).ok, true);
});
