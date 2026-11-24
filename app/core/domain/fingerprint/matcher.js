/** M1 弱匹配：item_id + 标题归一化。不承诺同款合并、不做图片相似度（P6=A）。 */

export function normalizeTitle(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[【】\[\]（）()·,，。.!！?？:：;；/\\|'"“”‘’\-—_+*#~]/g, '');
}

/** 确定性哈希，避免同一商品生成多个指纹 ID；不下载主图。 */
export function fingerprintIdFor({ itemId, title }) {
  const key = `${itemId || ''}|${normalizeTitle(title)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp_${h.toString(16).padStart(8, '0')}`;
}

/**
 * 导入清单逐行匹配：命中多条返回 ambiguous=true，由本人在行内确认；
 * 不自动合并、不自动挂领先标记。
 * @param {{item_id?: string, title?: string}} row
 * @param {Array<Object>} snapshots
 */
export function weakMatch(row, snapshots = []) {
  const key = normalizeTitle(row?.title);
  const matches = snapshots.filter((s) => {
    const byId = Boolean(row?.item_id && s.item_id && String(row.item_id) === String(s.item_id));
    const byTitle = Boolean(key && normalizeTitle(s.title) === key);
    return byId || byTitle;
  });
  const ids = [...new Set(matches.map((m) => m.fingerprint_id).filter(Boolean))];
  return { matches, ambiguous: ids.length > 1, fingerprintIds: ids };
}
