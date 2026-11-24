/** 状态 → 文字 + 图标双编码；颜色只作辅助，不依赖颜色区分。 */
export const STATE_VISUALS = Object.freeze({
  空: { icon: '○', label: '空', tone: 'muted' },
  加载中: { icon: '◌', label: '加载中', tone: 'muted' },
  成功: { icon: '✓', label: '成功', tone: 'ok' },
  部分失败: { icon: '⚠', label: '部分失败', tone: 'warn' },
  值异常: { icon: '⚠', label: '值异常', tone: 'warn' },
  站点改版: { icon: '⚠', label: '站点改版', tone: 'warn' },
  断采: { icon: '⋯', label: '断采（M2 启用）', tone: 'muted' },
  降级态: { icon: '⊘', label: '暂不支持', tone: 'muted' },
});

export function stateVisual(name) {
  return STATE_VISUALS[name] || STATE_VISUALS['值异常'];
}

export const FIELD_VISUALS = Object.freeze({
  正常: { icon: '·', label: '正常' },
  未获取: { icon: '○', label: '未获取' },
  值异常: { icon: '⚠', label: '值异常' },
  手工补录: { icon: '✎', label: '手工补录' },
});
