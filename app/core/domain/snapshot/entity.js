/** 快照实体：纯函数，不碰 DOM、不碰 storage。 */
import {
  SCHEMA_VERSION, RECORD_STATUS, M1_PRESET, ESTIMATE_FIELDS,
} from '../../shared/types.js';

/** 一行一商品一次快照；三要素全部由系统生成，用户零必填。 */
export function createSnapshot({
  raw = {},
  fieldStatus = {},
  snapshotId,
  batchId,
  queryId = null,
  fingerprintId = null,
  pageKind,
  asOf,
  sourceUrl,
  sampleKind = 'browsing',
}) {
  const hasEstimate = ESTIMATE_FIELDS.some((f) => raw[f] != null && raw[f] !== '');
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    snapshot_id: snapshotId,
    batch_id: batchId,
    query_id: queryId,
    fingerprint_id: fingerprintId,
    page_kind: pageKind,
    platform: M1_PRESET.platform,
    // M1 预留：只落库，不显示、不排序、不计算、不导出
    market: M1_PRESET.market,
    channel: M1_PRESET.channel,
    currency: M1_PRESET.currency,
    fx_rate: M1_PRESET.fx_rate,
    fx_as_of: asOf,
    item_id: raw.item_id ?? null,
    title: raw.title ?? null,
    category: raw.category ?? null,
    brand: raw.brand ?? null,
    spec: raw.spec ?? null,
    image_url: raw.image_url ?? null,
    source_url: sourceUrl,
    price: raw.price ?? null,
    price_type: raw.price_type ?? null,
    sales_display_band: raw.sales_display_band ?? null,
    review_count: raw.review_count ?? null,
    shop: raw.shop ?? null,
    listing_date: raw.listing_date ?? null,
    card_rank: raw.card_rank ?? null,
    result_count: raw.result_count ?? null,
    as_of: asOf,
    source: `taobao:${pageKind}`,
    is_estimate: hasEstimate,
    sample_kind: sampleKind,
    field_status: fieldStatus,
    record_status: RECORD_STATUS.STORED, // 成功 = 已落库，与字段是否齐全无关（P3=A）
  });
}
