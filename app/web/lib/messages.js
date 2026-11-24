import { describeError } from '../shared/errors.js';
import { stateVisual } from './states.js';

/** 6 态可验收 + 断采仅占位；文案含站点 / 字段 / 下一步，无「系统繁忙」。 */
export const STATE_MESSAGES = Object.freeze({
  空: '还没采过数据。打开淘宝商品页，点插件的「采集本页」就会出现在这里',
  加载中: '正在读取淘宝页面字段…',
  成功: '已记录，其中部分为展示值；可撤销 / 重采',
  部分失败: '淘宝 · 有字段没取到，其余项正常；可重采 / 手工补一条',
  值异常: '淘宝 · 有字段值超出常见范围，建议核对页面；可手工改值 / 忽略',
  站点改版: '淘宝页面结构似乎变了，字段规则需更新；已采数据不受影响',
  断采: '该区间无采集记录，不连线、不出扩散结论（M2 启用，M1 仅占位）',
});

export const CLEAR_CONFIRM_TEXT = '将移走本机全部采集记录与标记，可从本机恢复；彻底清除在 M2 导出备份后提供';

/** Result → 行内反馈（图标 + 文字 + 下一步），永不弹窗。 */
export function messageFor(result) {
  if (!result) return { icon: '○', text: STATE_MESSAGES['空'], hint: '', tone: 'muted' };
  if (result.ok) {
    const v = stateVisual('成功');
    return { icon: v.icon, text: result.data?.message || STATE_MESSAGES['成功'], hint: result.data?.hint || '', tone: v.tone };
  }
  const d = describeError(result.code, result.ctx);
  return { icon: d.icon, text: result.message || d.message, hint: result.hint || d.hint, tone: 'warn' };
}

export function fieldBadge(status) {
  const labels = {
    正常: '',
    未获取: '未获取',
    值异常: '值异常',
    手工补录: '手工补录',
  };
  return labels[status] || '';
}
