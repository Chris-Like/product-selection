import { err } from './result.js';

/** 内部 ErrorCode → 界面态；只用于 worker 边界把异常映射成行内文案。 */
export const ERROR_CODES = Object.freeze([
  'PAGE_UNSUPPORTED',
  'RULE_MISSING',
  'FIELD_OUT_OF_RANGE',
  'URL_REJECTED',
  'PERMISSION_DENIED',
  'SITE_DISABLED',
  'PAGE_CHANGED',
  'STORAGE_FAILED',
  'COMMAND_DUPLICATE',
  'PLAYWRIGHT_MISSING',
  'AUTH_REQUIRED',
  'AUTH_EXPIRED',
  'CAPTCHA_BLOCKED',
  'SITE_TIMEOUT',
  'NO_ENABLED_SITE',
  'CAPTURE_RUNNING',
]);

export const ERROR_TO_STATE = Object.freeze({
  PAGE_UNSUPPORTED: '降级态',
  RULE_MISSING: '站点改版',
  FIELD_OUT_OF_RANGE: '值异常',
  URL_REJECTED: '部分失败',
  PERMISSION_DENIED: '部分失败',
  SITE_DISABLED: '空',
  PAGE_CHANGED: '部分失败',
  STORAGE_FAILED: '值异常',
  COMMAND_DUPLICATE: '成功',
  PLAYWRIGHT_MISSING: '降级态',
  AUTH_REQUIRED: '降级态',
  AUTH_EXPIRED: '需重新授权',
  CAPTCHA_BLOCKED: '已停止',
  SITE_TIMEOUT: '部分失败',
  NO_ENABLED_SITE: '空',
  CAPTURE_RUNNING: '运行中',
});

/** 文字 + 图标双编码；每条文案含站点、字段（如适用）、下一步，禁「系统繁忙 / 未知错误」。 */
const TABLE = {
  PAGE_UNSUPPORTED: {
    icon: '⊘',
    message: (s) => `${s} · 这个页面暂不支持采集`,
    hint: () => '采集器自动识别可采页面；可停用该站，其他记录不受影响',
  },
  RULE_MISSING: {
    icon: '⚠',
    message: (s, f) => `${s} · ${f}规则还没回填`,
    hint: () => '规则由本机站点规则文件提供，B0 实测后回填；可停用该站，已采数据不受影响',
  },
  FIELD_OUT_OF_RANGE: {
    icon: '⚠',
    message: (s, f) => `${s} · ${f}的值超出常见范围`,
    hint: () => '核对页面后手工改值，或直接忽略；不自动修正',
  },
  URL_REJECTED: {
    icon: '⚠',
    message: (s) => `${s} · 这条的原链接不合法，未入库`,
    hint: () => '重新点一次「采集」；其他记录不受影响',
  },
  PERMISSION_DENIED: {
    icon: '⊘',
    message: (s) => `本机采集暂时读不到这个${s}页面`,
    hint: () => '重新点一次「采集」；不会反复索权',
  },
  SITE_DISABLED: {
    icon: '⏸',
    message: (s) => `已停用${s}采集`,
    hint: () => '在配置区启用该站即可恢复',
  },
  PAGE_CHANGED: {
    icon: '↻',
    message: (s) => `${s}页面地址与识别结果不一致，本次未入库`,
    hint: () => '重新点一次「采集」，本次不会入库',
  },
  STORAGE_FAILED: {
    icon: '⚠',
    message: () => '本机存储暂时写不进去，数据未丢失',
    hint: () => '重试一次；仍不行可先停用该站',
  },
  COMMAND_DUPLICATE: {
    icon: '✓',
    message: () => '这条已经记过了',
    hint: () => '无需操作，不会重复写入',
  },
  PLAYWRIGHT_MISSING: {
    icon: '⊘',
    message: (s) => `${s} · 自动采集组件还没装好`,
    hint: () => '在工程目录执行 npm install 安装 Playwright；配置与结果页照常可用',
  },
  AUTH_REQUIRED: {
    icon: '⚠',
    message: (s) => `${s} · 还没建立登录态`,
    hint: () => '到「配置」页点该站的「登录」，本人手动输入或扫码；工具不录密码、不代填',
  },
  AUTH_EXPIRED: {
    icon: '⚠',
    message: (s) => `${s} · 登录态已过期，本轮未采集该站`,
    hint: () => '到「配置」页点该站的「登录」重新授权，本人在打开的浏览器里登录一次；不自动代填密码',
  },
  CAPTCHA_BLOCKED: {
    icon: '⏸',
    message: (s) => `${s} · 遇到验证码或二次验证，已暂停该站`,
    hint: () => '本人在浏览器里处理一次，再回「配置」页点「登录」重建登录态；工具不会自动绕过',
  },
  SITE_TIMEOUT: {
    icon: '⚠',
    message: (s) => `${s} · 本轮超过时间上限，已标记该站`,
    hint: () => '稍后再采一次或停用该站；不会自动反复重试',
  },
  NO_ENABLED_SITE: {
    icon: '⏸',
    message: () => '还没有启用任何站点',
    hint: () => '在配置区新增站点、核验条款后手动启用，再点采集',
  },
  CAPTURE_RUNNING: {
    icon: '↻',
    message: () => '已有一轮采集正在运行',
    hint: () => '等这一轮结束或点「停止」后再开始；不会并发跑两轮',
  },
};

/**
 * @param {string} code
 * @param {{site?: string, field?: string}} [ctx]
 */
export function describeError(code, ctx = {}) {
  const site = ctx.site || '淘宝';
  const field = ctx.field || '某个字段';
  const entry = TABLE[code] || TABLE.STORAGE_FAILED;
  return {
    state: ERROR_TO_STATE[code] || '值异常',
    icon: entry.icon,
    message: entry.message(site, field),
    hint: entry.hint(),
  };
}

/** @param {string} code @param {{site?: string, field?: string}} [ctx] */
export function failure(code, ctx) {
  const d = describeError(code, ctx);
  return err(code, d.message, d.hint);
}
