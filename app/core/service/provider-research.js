import { randomUUID } from 'node:crypto';
import { ok, err } from '../shared/result.js';

const platforms = {
  fastmoss: ['tiktok_shop'],
  linkfox: ['amazon', 'tiktok_shop', 'shopee', 'lazada', 'temu', '1688', 'walmart'],
};
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function productUrl(value) {
  try {
    const url = new URL(clean(value, 1500));
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin + url.pathname : null;
  } catch { return null; }
}

export function providerReportInput(raw) {
  return {
    provider: clean(raw?.provider, 32), platform: clean(raw?.platform, 32),
    market: clean(raw?.market, 32), query: clean(raw?.query, 200),
    tool: clean(raw?.tool, 120), window: clean(raw?.window, 100),
    items: Array.isArray(raw?.items) && raw.items.length <= 50 ? raw.items.map((item) => ({
      id: clean(item?.id, 120), title: clean(item?.title, 250), url: productUrl(item?.url),
      price: number(item?.price), currency: typeof item?.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) ? item.currency : null,
      price_type: clean(item?.price_type, 48), units_sold: number(item?.units_sold),
    })) : null,
  };
}

export function createProviderResearch(analysis) {
  async function save(input = {}) {
    const { provider, platform } = input;
    const market = clean(input.market, 32);
    const query = clean(input.query, 200);
    const tool = clean(input.tool, 120);
    const window = clean(input.window, 100);
    if (!Object.hasOwn(platforms, provider) || !platforms[provider].includes(platform) || !market || !query || !tool || !window) {
      return err('STORAGE_FAILED', '外部数据缺少来源、市场、查询条件或统计时间窗', '按外部数据接入说明填写来源和口径');
    }
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) {
      return err('STORAGE_FAILED', '外部候选应为 1 至 50 条', '只提交工具实际返回的候选');
    }
    const items = [];
    for (const raw of input.items) {
      const id = clean(raw?.id, 120);
      const title = clean(raw?.title, 250);
      const url = productUrl(raw?.url);
      const price = number(raw?.price);
      const currency = /^[A-Z]{3}$/.test(raw?.currency || '') ? raw.currency : null;
      if (!title || !(id || url)) return err('STORAGE_FAILED', '候选缺少标题和可核对的标识', '保留商品 ID 或来源链接');
      items.push({ id: id || null, title, url, price: currency ? price : null, currency,
        price_type: clean(raw.price_type, 48) || null, units_sold: number(raw.units_sold) });
    }
    const report = { id: randomUUID(), provider, platform, market, query, tool, window,
      imported_at: new Date().toISOString(), origin: 'host_supplied', items };
    await analysis.set(`provider-research:${report.id}`, report);
    return ok(report);
  }

  async function list() {
    const records = await analysis.list('provider-research:');
    if (!records.ok) return records;
    return ok((records.data || []).map(({ value }) => value)
      .sort((a, b) => b.imported_at.localeCompare(a.imported_at)).slice(0, 30));
  }
  return { save, list };
}
