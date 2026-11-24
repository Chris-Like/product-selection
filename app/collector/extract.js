/**
 * 页面识别 + 字段抽取：URL 模式与语义锚点全部来自站点规则（配置化）。
 * 规则为空槽时一律返回 rulePending，不猜测、不填 0、不落库。
 */
import { selectorsFor, anchorsFor } from '../core/domain/rule/site-rule.js';

/** @returns {{pageKind: string, rulePending: boolean, reason?: string}} */
export function detectPageKind(url, rule) {
  const patterns = rule?.url_patterns || {};
  const entries = Object.entries(patterns);
  if (!entries.length) {
    return { pageKind: 'UNSUPPORTED', rulePending: true, reason: 'URL 识别模式尚未实测回填' };
  }
  for (const [kind, list] of entries) {
    for (const raw of list || []) {
      try {
        if (new RegExp(raw).test(String(url || ''))) return { pageKind: kind, rulePending: false };
      } catch { /* 单条模式不合法则跳过，不阻断其他模式 */ }
    }
  }
  return { pageKind: 'UNSUPPORTED', rulePending: false, reason: '当前 URL 不是已声明的可采页面' };
}

/**
 * 声明式派生（B0 实测补充）：搜索结果卡片里没有承载商品标识的元素，
 * 真实商品链接在卡片外层 A 上，且部分为广告位跳转链接。
 * 只从本次真实页面读到的 href 中取 id 参数（纯数字、6 位以上），
 * 产出商品标识或标准化商品原链；不解析任意表达式、不猜测域名。
 */
function deriveFromUrl(field, href) {
  if (!href) return null;
  let u;
  try { u = new URL(href, 'https://s.taobao.com'); } catch { return null; }
  const id = u.searchParams.get('id');
  if (!/^\d{6,}$/.test(id || '')) return null;
  if (field === 'item_id') return id;
  if (field === 'source_url') return 'https://item.taobao.com/item.htm?id=' + id;
  return null;
}

async function readOne(locator, field, rule) {
  const attr = rule?.field_attr_map?.[field] || null;
  try {
    if (attr === '$url:id' || attr === '$url:canonical') {
      return deriveFromUrl(field, await locator.getAttribute('href'));
    }
    if (attr) return (await locator.getAttribute(attr)) || null;
    return (await locator.textContent()) || null;
  } catch {
    return null;
  }
}

/** @returns {Promise<{items: Object[], fields: Object, rulePending: boolean}>} */
export async function extractFields(page, rule, pageKind) {
  const selectors = selectorsFor(rule, pageKind);
  const anchors = anchorsFor(rule, pageKind);
  if (!anchors.length) return { items: [], fields: {}, rulePending: true };

  let anchorOk = false;
  for (const a of anchors) {
    try { if ((await page.locator(a).count()) > 0) { anchorOk = true; break; } } catch { /* 跳过 */ }
  }
  if (!anchorOk) return { items: [], fields: {}, rulePending: true };

  const cards = pageKind === 'PG-2' && selectors.card
    ? await page.locator(selectors.card).all()
    : [];
  const scopes = cards.length ? cards : [page];
  const items = [];
  for (const scope of scopes) {
    const row = {};
    for (const [field, selector] of Object.entries(selectors)) {
      if (!selector || field === 'card') continue;
      row[field] = await readOne(scope.locator(selector).first(), field, rule);
    }
    items.push(row);
  }
  return { items, fields: items[0] || {}, rulePending: false };
}
