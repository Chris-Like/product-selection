/** 站点规则只解析 CSS 选择器字符串与常量；禁任何代码求值。 */
import { assertRuleShape } from '../../shared/guard.js';

export function emptyRule(site = 'taobao') {
  return {
    site,
    version: 'v1',
    status: 'pending_b0_probe',
    field_selector_map: { 'PG-1': {}, 'PG-2': {} },
    anchor_selectors: { 'PG-1': [], 'PG-2': [] },
    price_type_enum: [],
    value_ranges: {},
    updated_at: null,
  };
}

/**
 * 规则就绪 = 形状合法 + 目标页面的关键选择器与语义锚点均已回填（B0″ 后为真）。
 * 可传 pageKind 指定本轮实际采集入口的页面类型，只校验该类型；不传时保持原语义
 * （两类页面都须就绪），既有单测与调用方不受影响。
 * B0 实测修正：M1 淘宝入口是 PG-2 搜索结果页；PG-1 详情页字段实测不稳定。
 * 若强求两类都齐，会诱发为凑齐而编造未核对的选择器，违反「不虚构」红线。
 */
export function isRuleReady(rule, pageKind = null) {
  const shape = assertRuleShape(rule);
  if (!shape.ok) return { ok: false, reason: shape.reason };
  if (!rule || rule.status === 'pending_b0_probe') {
    return { ok: false, reason: 'B0″ 字段字典尚未实测回填' };
  }
  const required = ['title', 'source_url', 'price', 'item_id'];
  for (const kind of (pageKind ? [pageKind] : ['PG-1', 'PG-2'])) {
    const map = rule.field_selector_map?.[kind] || {};
    const missing = required.filter((f) => !map[f]);
    if (missing.length) return { ok: false, reason: `${kind} 缺 ${missing.join(' / ')} 的定位表达式` };
    const anchors = rule.anchor_selectors?.[kind] || [];
    if (!anchors.length) return { ok: false, reason: `${kind} 缺语义锚点` };
  }
  return { ok: true };
}

export function selectorsFor(rule, pageKind) {
  return rule?.field_selector_map?.[pageKind] || {};
}

export function anchorsFor(rule, pageKind) {
  return rule?.anchor_selectors?.[pageKind] || [];
}

export function priceTypes(rule) {
  return rule?.price_type_enum || [];
}
