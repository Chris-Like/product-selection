export function retailCsvItems(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 100_000) throw new Error('请选择 100 KB 以内的 UTF-8 CSV 文件');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const input = csv.replace(/^\uFEFF/, '');
  function endField() { row.push(field.trim()); field = ''; closed = false; }
  function endRow() {
    endField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 51) throw new Error('每次最多导入 50 个候选');
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('CSV 引号格式有误');
    else field += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  endRow();
  const header = rows.shift() || [];
  if (new Set(header).size !== header.length || !header.includes('title') || !header.some((x) => ['url', 'id'].includes(x))) {
    throw new Error('CSV 需要 title 列，以及 url 或 id 列');
  }
  if (!rows.length) throw new Error('CSV 没有商品记录');
  return rows.map((columns, index) => {
    if (columns.length !== header.length) throw new Error(`第 ${index + 2} 行列数不一致`);
    const item = Object.fromEntries(header.map((key, i) => [key, columns[i]]));
    if (item.price && !/^\d+(?:\.\d+)?$/.test(item.price)) throw new Error(`第 ${index + 2} 行价格无效，缺价请留空`);
    return { title: item.title, id: item.id, url: item.url, price: item.price ? Number(item.price) : null,
      currency: item.currency || 'CNY', price_type: item.price_type || '导入展示价', spec: item.spec };
  });
}
