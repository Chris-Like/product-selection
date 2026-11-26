import { createHmac } from 'node:crypto';

const METHOD = 'taobao.tbk.sc.material.optional.upgrade';
const endpoint = 'https://eco.taobao.com/router/rest';
const responseKey = 'tbk_sc_material_optional_upgrade_response';

export function createTaobaoAlliance(env = process.env, fetcher = fetch) {
  const { AUTO_PICK_TBK_APP_KEY: appKey, AUTO_PICK_TBK_APP_SECRET: secret,
    AUTO_PICK_TBK_SESSION: session, AUTO_PICK_TBK_ADZONE_ID: adzone } = env;
  const configured = Boolean(appKey && secret && session && /^\d+$/.test(adzone || ''));
  async function search(query, budget) {
    if (!configured) throw new Error('淘宝联盟接口尚未配置，可以先导入候选表格');
    const timestamp = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    const fields = { app_key: appKey, session, adzone_id: adzone, method: METHOD, timestamp, format: 'json',
      v: '2.0', sign_method: 'hmac', q: query, page_no: '1', page_size: '15' };
    if (budget != null) fields.end_price = String(Math.ceil(budget));
    const canonical = Object.keys(fields).sort().map((key) => key + fields[key]).join('');
    fields.sign = createHmac('md5', secret).update(canonical).digest('hex').toUpperCase();
    const response = await fetcher(endpoint, { method: 'POST', body: new URLSearchParams(fields), redirect: 'error',
      signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('淘宝联盟查询未完成，请检查网络或授权');
    const payload = await response.json();
    const result = payload?.[responseKey];
    if (!result || payload.error_response) throw new Error('淘宝联盟接口拒绝了查询，请核对应用权限和推广位');
    const rows = result.result_list?.map_data;
    if (rows != null && !Array.isArray(rows)) throw new Error('淘宝联盟返回结构与预期不符');
    return (rows || []).map((row) => {
      const info = row.item_basic_info || {};
      const raw = row.price_promotion_info?.final_promotion_price;
      const price = /^\d+(?:\.\d+)?$/.test(String(raw ?? '')) ? Number(raw) : null;
      const id = String(row.item_id ?? '');
      const click = row.publish_info?.click_url;
      let url = /^\d+$/.test(id) ? `https://item.taobao.com/item.htm?id=${id}` : null;
      try {
        const direct = new URL(click?.startsWith('//') ? `https:${click}` : click);
        if (['item.taobao.com', 'detail.tmall.com'].includes(direct.hostname) && /^\d+$/.test(direct.searchParams.get('id') || '')) {
          url = `https://${direct.hostname}/item.htm?id=${direct.searchParams.get('id')}`;
        }
      } catch { /* 只有明确的商品页才作为原页链接 */ }
      return { id, title: info.title, price, currency: 'CNY', price_type: '联盟预估到手价', url };
    }).filter((row) => row.title && (row.id || row.url));
  }
  return { configured, search };
}
