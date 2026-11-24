/** 内部模块边界返回体；不对外暴露，不恢复 Y-08 的对外接口契约与统一错误码体系。 */

/** @param {*} data */
export function ok(data) {
  return { ok: true, data };
}

/**
 * @param {string} code
 * @param {string} message 含站点 / 字段的文案
 * @param {string} hint 必须是可执行的下一步，不得为空
 */
export function err(code, message, hint) {
  if (!code || !message || !hint) {
    throw new Error('err() 需要 code / message / hint 三者齐全（H-08：说人话且给下一步）');
  }
  return { ok: false, code, message, hint };
}

/** @param {*} r */
export function isOk(r) {
  return Boolean(r && r.ok === true);
}

/** @param {*} r */
export function isErr(r) {
  return Boolean(r && r.ok === false);
}
