import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUrl, validateField, assertRuleShape } from '../../app/core/shared/guard.js';
import { FIELD_STATUS } from '../../app/core/shared/types.js';

test('URL 白名单：仅 https + 淘宝域', () => {
  assert.equal(isAllowedUrl('https://item.taobao.com/item.htm?id=1'), true);
  assert.equal(isAllowedUrl('https://detail.tmall.com/item.htm?id=2'), true);
  assert.equal(isAllowedUrl('http://item.taobao.com/item.htm'), false);
  assert.equal(isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedUrl('https://taobao.com.evil.example/page'), false);
  assert.equal(isAllowedUrl('https://example.com/'), false);
  assert.equal(isAllowedUrl(''), false);
});

test('值域校验能抓「有值但值错」（TC-06 / DE-01）', () => {
  const withRange = validateField('review_count', '12345', { review_count_max: 100 });
  assert.equal(withRange.status, FIELD_STATUS.ABNORMAL);
  const normal = validateField('review_count', '42', { review_count_max: 100 });
  assert.equal(normal.status, FIELD_STATUS.NORMAL);
  const noRange = validateField('price', '99', {});
  assert.equal(noRange.rangePending, true, '值域未回填时不得冒充「值合理」');
});

test('缺失留空不填 0、非法 URL 拒绝', () => {
  assert.equal(validateField('price', '').status, FIELD_STATUS.MISSING);
  assert.equal(validateField('source_url', 'javascript:alert(1)').status, FIELD_STATUS.ABNORMAL);
});

test('规则只许选择器字符串，禁止代码求值面', () => {
  const good = { field_selector_map: { 'PG-1': { title: '.title' } }, price_type_enum: [], value_ranges: {} };
  assert.equal(assertRuleShape(good).ok, true);
  const bad = { field_selector_map: { 'PG-1': { title: '${eval("x")}' } } };
  assert.equal(assertRuleShape(bad).ok, false);
});
