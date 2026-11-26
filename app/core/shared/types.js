/**
 * 公共类型与常量（JSDoc typedef，运行时零依赖）。
 * 技术裁定：详细设计目录树写 .ts，但要求零构建依赖 + 可直接加载，
 * 故运行时用原生 ES Module + JSDoc 类型，不引入 tsc / npm 依赖。
 */

/** @typedef {'PG-1'|'PG-2'|'UNSUPPORTED'} PageKind */
/** @typedef {'draft'|'stored'|'ignored'|'undone'|'cleared'} RecordStatus */
/** @typedef {'正常'|'未获取'|'值异常'|'手工补录'} FieldStatus */
/** @typedef {'待定'|'已定'|'已放弃'} CandidateState */
/** @typedef {'browsing'|'list_import'|'api'} SampleKind */

/**
 * @typedef {Object} Result
 * @property {boolean} ok
 * @property {*} [data]
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [hint]
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} snapshot_id
 * @property {string} batch_id
 * @property {string|null} fingerprint_id
 * @property {RecordStatus} record_status
 * @property {Object<string, FieldStatus>} field_status
 */

export const SCHEMA_VERSION = 2;

export const RECORD_STATUS = Object.freeze({
  DRAFT: 'draft',
  STORED: 'stored',
  IGNORED: 'ignored',
  UNDONE: 'undone',
  CLEARED: 'cleared',
});

export const FIELD_STATUS = Object.freeze({
  NORMAL: '正常',
  MISSING: '未获取',
  ABNORMAL: '值异常',
  MANUAL: '手工补录',
});

export const CANDIDATE_STATES = Object.freeze(['待定', '已定', '已放弃']);
export const PAGE_KINDS = Object.freeze(['PG-1', 'PG-2', 'UNSUPPORTED']);
export const SAMPLE_KINDS = Object.freeze(['browsing', 'list_import', 'api', 'auto']);

/** M1 只落库、不显示不排序不计算不导出（开工包第 4 章） */
export const M1_PRESET = Object.freeze({
  market: 'domestic',
  channel: 'taobao',
  currency: 'CNY',
  fx_rate: 1.0,
  platform: 'taobao',
});

/** 展示值 / 估算值字段：一律 is_estimate=true，禁止当真实销量 */
export const ESTIMATE_FIELDS = Object.freeze([
  'sales_display_band',
  'review_count',
  'card_rank',
  'result_count',
]);

/** 记录成立前置条件所需字段（系统生成，不是用户必填清单） */
export const RECORD_GATE = Object.freeze(['source_url', 'item_id']);

export const DEFAULT_SETTINGS = Object.freeze({
  schema_version: SCHEMA_VERSION,
  default_site: 'taobao',
  sites_enabled: { taobao: true },
  default_sort: 'lead_first',
  // 对话助手是默认入口；纯本机模式留给专业工作台的明确配置。
  analysis_mode: 'agent_assisted',
  assistant_host: 'codex',
  runtime_limits: { max_queries: 3, max_pages: 1, max_units: 3, request_interval_ms: 1200 },
  columns: ['marker', 'title', 'platform', 'price', 'sales', 'review', 'as_of', 'source_url'],
});

export const CLEAR_CONFIRM_TOKEN = 'clear-all-inline-confirm';
