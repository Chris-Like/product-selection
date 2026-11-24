import { FIELD_STATUS } from './types.js';

/** URL 白名单：仅 https + 已声明站点域。
 * 新形态改写：站点由页面维护，白名单随启用站点的 host 动态配置；未配置时仍只放行默认站。
 */
const DEFAULT_HOSTS = Object.freeze(['taobao.com', 'tmall.com']);
let allowedHosts = new Set(DEFAULT_HOSTS);

/** @param {string[]} hosts */
export function configureAllowedHosts(hosts = []) {
  const next = new Set(DEFAULT_HOSTS);
  for (const h of hosts) {
    if (typeof h === 'string' && h.trim()) next.add(h.trim().toLowerCase().replace(/^\./, ''));
  }
  allowedHosts = next;
  return [...allowedHosts];
}

export function allowedHostsSnapshot() {
  return [...allowedHosts];
}

/** @param {string} raw */
export function isAllowedUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return [...allowedHosts].some((host) => h === host || h.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** 文本截断并标注，不抛异常、不弹窗。 */
export function sanitizeText(value, maxLen = null) {
  const s = value == null ? '' : String(value).trim();
  if (maxLen && Number.isFinite(maxLen) && maxLen > 0 && s.length > maxLen) {
    return { text: s.slice(0, maxLen), truncated: true };
  }
  return { text: s, truncated: false };
}

function numericField(field, text, ranges) {
  const n = Number(String(text).replace(/[¥,\s]/g, ''));
  if (!Number.isFinite(n)) return { status: FIELD_STATUS.ABNORMAL, reason: '不是数值' };
  const key = `${field}_max`;
  const limit = ranges ? ranges[key] : null;
  if (limit == null) {
    // 值域未回填：只做类型校验，不冒充「值合理」，也不判异常
    return { value: n, status: FIELD_STATUS.NORMAL, rangePending: true };
  }
  if (field === 'price' && n < 0) return { status: FIELD_STATUS.ABNORMAL, reason: '价格为负' };
  if (field === 'review_count' && (!Number.isInteger(n) || n < 0)) {
    return { status: FIELD_STATUS.ABNORMAL, reason: '评价数须为非负整数' };
  }
  if (n > limit) return { status: FIELD_STATUS.ABNORMAL, reason: '超出实测值域上限' };
  return { value: n, status: FIELD_STATUS.NORMAL, rangePending: false };
}

/**
 * 单字段校验：类型 + 值域 + 白名单。抓错值（如评价数指向粉丝数）在值域回填后可被标出。
 * @param {string} field
 * @param {*} raw
 * @param {Object<string, number|null>} [ranges]
 */
export function validateField(field, raw, ranges = {}) {
  const { text, truncated } = sanitizeText(raw, ranges.title_max ?? null);
  if (field === 'source_url' || field === 'image_url') {
    if (!text) return { status: FIELD_STATUS.MISSING, reason: '未取到' };
    if (!isAllowedUrl(text)) return { status: FIELD_STATUS.ABNORMAL, reason: '链接不在允许范围' };
    return { value: text, status: FIELD_STATUS.NORMAL, truncated };
  }
  if (!text) return { status: FIELD_STATUS.MISSING, reason: '未取到' };
  if (field === 'price' || field === 'review_count' || field === 'card_rank' || field === 'result_count') {
    const r = numericField(field, text, ranges);
    return { ...r, truncated };
  }
  return { value: text, status: FIELD_STATUS.NORMAL, truncated, rangePending: false };
}

/** 站点规则只许选择器字符串与常量；禁止任何形式的代码求值面。 */
export function assertRuleShape(rule) {
  if (!rule || typeof rule !== 'object') return { ok: false, reason: '规则不是对象' };
  // 用正则字面量表达禁用模式，避免源码自身被「禁代码求值」自检误判
  const forbidden = [/eval/, /new\s+Function/, /javascript:/, /<script/, /\$\{/, /=>/];
  const collect = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(collect) : v && typeof v === 'object' ? Object.values(v).flatMap(collect) : []);
  const strings = collect(rule);
  for (const s of strings) {
    if (typeof s === 'string' && forbidden.some((re) => re.test(s))) {
      return { ok: false, reason: '规则中含有不允许的表达式' };
    }
  }
  const map = rule.field_selector_map;
  if (!map || typeof map !== 'object') return { ok: false, reason: '缺少 field_selector_map' };
  for (const group of Object.values(map)) {
    for (const [field, selector] of Object.entries(group || {})) {
      if (typeof selector !== 'string') return { ok: false, reason: `${field} 的选择器必须是字符串` };
    }
  }
  return { ok: true };
}
