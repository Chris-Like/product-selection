import { pathToFileURL } from 'node:url';

/**
 * 新形态 M1 验收用例清单（TC-N01～N21）。
 * 这是可执行的检查表，不是自动化脚本：涉及真实页面 / 登录态的用例需 B0 实测后在页面里人工跑一遍。
 * 判定基准里的阈值全部是「示例值，待确认」，B0 实测后回填。
 */
export const CASES = [
  { id: 'TC-N01', name: '新增站点', precondition: '页面已打开', steps: '新增站点并保存', expected: '出现在列表且默认停用；不启用不进采集队列' },
  { id: 'TC-N02', name: '删除 + 恢复', precondition: '已有站点', steps: '删除 → 点恢复或 Ctrl/⌘+Z', expected: '站点回来，决策日志与当时预期不变' },
  { id: 'TC-N03', name: '清空', precondition: '已有可恢复项', steps: '行内二次确认清空 → 恢复', expected: '可恢复区未被清除，误删能救' },
  { id: 'TC-N04', name: '未装 Playwright', precondition: '未安装可选依赖', steps: '点采集', expected: '明确降级文案、不落库、页面其余功能可用' },
  { id: 'TC-N05', name: '规则未回填', precondition: 'site-rules 为空槽', steps: '点采集', expected: '行内「规则未回填」、不落库、不猜测不填 0' },
  { id: 'TC-N06', name: '登录态缺失/过期', precondition: '未建立或标记过期', steps: '点采集', expected: '标 auth_required / auth_expired；工作台常驻提示 + 一键回配置页；不自动重试、不代填密码' },
  { id: 'TC-N07', name: '遇验证码/滑块', precondition: '页面出现验证环节', steps: '点采集', expected: '暂停该站、标 captcha_blocked、不自动绕过' },
  { id: 'TC-N08', name: '单站超时/失败', precondition: '多站启用或模拟失败', steps: '点采集', expected: '标记该站、其他站不受影响、不轰炸重试' },
  { id: 'TC-N09', name: '三要素与字段态', precondition: '已有采集记录', steps: '看结果区', expected: '每条带 source/as_of/is_estimate；抓不到标「未获取」' },
  { id: 'TC-N10', name: '反锚定', precondition: '结果区有数据', steps: '临时关闭领先优先 / 反例视图 / 刷新', expected: '两个入口可达；刷新后恢复默认排序' },
  { id: 'TC-N11', name: '点回原页', precondition: '结果区有数据', steps: '点「打开原页」', expected: '新标签打开，URL 经白名单校验' },
  { id: 'TC-N12', name: '双触发一致', precondition: '服务已启动', steps: '页面点采集 + 脚本 capture.mjs', expected: '同一任务入口；不并发两轮、不重复写入' },
  { id: 'TC-N13', name: '服务重启重放', precondition: '存在未完成命令', steps: '停服务再启动', expected: '重放未完成命令，不重复写入' },
  { id: 'TC-N14', name: '页面识别', precondition: '规则已回填', steps: '打开 PG-1 / PG-2 / 不支持页', expected: '识别正确；不支持页不落库' },
  { id: 'TC-N15', name: '值异常样例', precondition: '值域已回填', steps: '构造抓错值样例', expected: '字段被标「值异常」，不自动修正' },
  { id: 'TC-N16', name: '两个 tab', precondition: '页面已打开', steps: '点 tab 或按 1 / 2 / 方向键切换', expected: '配置与工作台互斥显示；采集与结果同屏；表单内容不丢；状态条跨 tab 常驻' },
  { id: 'TC-N17', name: '每轮记录', precondition: '已点过采集（含降级）', steps: '展开采集记录，点任一轮', expected: '每轮一条、失败或未开始也留痕；点记录原地换结果、不跳页' },
  { id: 'TC-N18', name: '轮次切换与口径', precondition: '至少两轮记录', steps: '切本轮 / 全部累计 / 历史轮次', expected: '条数随视图变化；声明分别写「本轮」「累计」；结果行显示轮次编号' },
  { id: 'TC-N19', name: '不录密码', precondition: '页面已打开', steps: '看配置页 / 新增或编辑站点 / 查本机数据目录', expected: '无密码输入框；请求里夹带密码字段也被服务端丢弃；不生成密码密文或主密钥文件' },
  { id: 'TC-N20', name: '本人登录→自动记录 cookies', precondition: '已装 Playwright 且站点已启用', steps: '点「登录」→ 本人在有头浏览器登录或扫码 → 关窗（或点「确认已登录」）', expected: 'storageState 落到 playwright/.auth/ 且状态变 valid；点「取消登录」不覆盖既有登录态' },
  { id: 'TC-N21', name: '过期提醒回到基础页面', precondition: '登录态已过期', steps: '点采集后看工作台提示条 → 点「去配置页重新登录」', expected: '出现醒目提示；切到配置 tab 并高亮该站；零模态弹窗' },
];

export const GATE = Object.freeze({
  needsB0Probe: ['TC-N05', 'TC-N08', 'TC-N14', 'TC-N15'],
  needsRealLogin: ['TC-N06', 'TC-N07', 'TC-N20', 'TC-N21'],
  needsPlaywright: ['TC-N04', 'TC-N08', 'TC-N12', 'TC-N14'],
  note: 'B0 真实页面实测回填选择器与阈值后，才能完整跑完全部用例；在此之前降级态用例可先跑。',
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const c of CASES) console.log(`${c.id} · ${c.name} → ${c.expected}`);
  console.log(`\n共 ${CASES.length} 条。${GATE.note}`);
}
