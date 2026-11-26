# 外部选品调研工作流

## 选择来源

- 用户明确要求 FastMoss，或目标是 TikTok Shop 机会探索时，使用宿主里已授权的 FastMoss MCP。先明确站点、类目或关键词、统计时间窗。只调用商品搜索、榜单等只读工具。
- 用户明确要求 LinkFox，或目标是 Amazon 等跨境市场、1688 货源时，使用宿主中实际可用且已授权的 LinkFox 选品、商品、货源技能。WorkBuddy 也可以使用已授权、确实暴露相同查询能力的 LinkFox 连接器。
- 国内零售需求继续走原有流程。遇到市场不明、来源缺失或权限不足，说明缺口。切换来源前先征得用户同意。

## 调研前与结果处理

列出将查询的市场、词和时间窗，按用户确认的计划或明确的查询请求执行。向提供商传递查询所需的业务参数。数据源的 OAuth、API Key、店铺及广告授权在其宿主界面管理。

在对话先展示候选与依据。保留原币种、展示价或批发价等口径，销量使用来源口径。用户需要在工作台复核时，把实际返回的商品映射为下列 JSON，保存到项目的忽略目录 `data/`，通过本机桥接导入。报告只记录一组提供商、平台、市场与时间窗，最多 50 条。同一轮涉及不同来源或市场时分别保存。

```json
{
  "provider": "fastmoss",
  "platform": "tiktok_shop",
  "market": "US",
  "query": "查询词或榜单条件",
  "tool": "实际使用的工具名",
  "window": "实际统计日期或时间范围",
  "items": [{ "id": "来自工具的商品 ID", "title": "来自工具的商品标题", "price": null, "currency": null, "price_type": null, "units_sold": null }]
}
```

用 `node skills/auto-pick-studio/scripts/guide.mjs import-research data/provider-report.json` 导入，并把返回的 `workbench_url` 发给用户。缺失的指标使用 `null`，保留商品 ID 或来源链接。空结果用自然语言报告，无须导入。外部数据记录为宿主回传，来源指标未经本项目独立核验。

配置入口见 [双宿主接入说明](../../../hosts/provider-integrations.md)。
