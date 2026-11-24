/** 唯一安全渲染入口：动态文本一律 textContent，禁直接写入 HTML 字符串。 */

/** @param {string} tag @param {Object} props @param {Array<Node|string>} children */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** 单元格统一走这里；属性用 setAttribute，不拼 HTML。 */
export function renderCell(tag, text, attrs = {}) {
  return el(tag, { ...attrs, text: text == null || text === '' ? '未获取' : String(text) });
}

export function clearNode(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

/** 小字四要素：分母 / 时间范围 / 截止日 / 样本量 / 口径类型，重要信息不只放 tooltip。 */
export function footnote(parts = []) {
  return el('span', { class: 'footnote', text: parts.filter(Boolean).join(' · ') });
}
