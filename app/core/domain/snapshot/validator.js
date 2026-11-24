/** 字段级校验：记录态与字段态正交（P3=A）。 */
import { validateField, isAllowedUrl } from '../../shared/guard.js';
import { FIELD_STATUS, PAGE_KINDS, RECORD_GATE } from '../../shared/types.js';

export const FIELD_LIST = Object.freeze({
  'PG-1': ['item_id', 'title', 'source_url', 'image_url', 'shop', 'category', 'price', 'price_type', 'sales_display_band', 'review_count', 'listing_date'],
  'PG-2': ['item_id', 'title', 'source_url', 'image_url', 'shop', 'price', 'price_type', 'sales_display_band', 'card_rank', 'result_count'],
});

/**
 * 规则未回填的字段保持「未获取」，不猜测、不填 0、不阻断整体。
 * @param {Object} raw
 * @param {Object} rule
 * @param {string} pageKind
 */
export function validateRawFields(raw, rule, pageKind) {
  const fields = {};
  const fieldStatus = {};
  const issues = [];
  const selectors = rule?.field_selector_map?.[pageKind] || {};
  const ranges = rule?.value_ranges || {};
  let rangePending = false;
  let rulePending = false;

  for (const field of FIELD_LIST[pageKind] || []) {
    const selector = selectors[field];
    const provided = raw?.[field];
    if (!selector) {
      rulePending = true;
      fields[field] = null;
      fieldStatus[field] = FIELD_STATUS.MISSING;
      continue;
    }
    if (provided == null || provided === '') {
      fields[field] = null;
      fieldStatus[field] = FIELD_STATUS.MISSING;
      continue;
    }
    const r = validateField(field, provided, ranges);
    fieldStatus[field] = r.status;
    if (r.status === FIELD_STATUS.ABNORMAL) issues.push({ field, reason: r.reason });
    if (r.rangePending) rangePending = true;
    fields[field] = r.value ?? (r.status === FIELD_STATUS.NORMAL ? provided : null);
  }
  return { fields, fieldStatus, issues, rangePending, rulePending };
}

/** 记录成立前置条件（不是必采清单，全部由系统生成）。 */
export function satisfiesRecordGate({ pageKind, url, fields }) {
  if (!PAGE_KINDS.includes(pageKind) || pageKind === 'UNSUPPORTED') {
    return { ok: false, code: 'PAGE_UNSUPPORTED' };
  }
  if (!isAllowedUrl(url)) return { ok: false, code: 'URL_REJECTED' };
  if (!isAllowedUrl(fields?.source_url || url)) return { ok: false, code: 'URL_REJECTED' };
  if (!fields?.item_id) return { ok: false, code: 'RULE_MISSING', ctx: { field: '商品标识' } };
  return { ok: true };
}

export { RECORD_GATE };
