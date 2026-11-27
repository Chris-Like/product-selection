# 外部选品数据接入

## 国内零售

专业工作台的「国内零售」可查询淘宝联盟、导入 UTF-8 CSV，并打开结果中的商品原页核验。CSV 表头示例为 `title,price,currency,price_type,spec,url,id`。至少填写标题及商品标识或链接，币种留空按人民币处理。导入时同时记录数据提供者、站点和观察日期。需要预算筛选时，系统使用人民币展示价或估价。

申请接口权限后，在本机服务进程的环境中设置 `AUTO_PICK_TBK_APP_KEY`、`AUTO_PICK_TBK_APP_SECRET`、`AUTO_PICK_TBK_SESSION`、`AUTO_PICK_TBK_ADZONE_ID` 并重启。查询使用淘宝联盟的推广商品池，价格字段是联盟估价。没有权限时可以用授权导出的 CSV。 [淘宝开放平台接口文档](https://developer.alibaba.com/docs/api.htm?apiId=64758)

## 选品助手使用的 AI

从「基础配置 → 选品分析方式」选择 Codex 或 WorkBuddy。在智能选品助手网页点击「下一步」生成建议时，选择 Codex 并确保本机 Codex CLI 已登录。WorkBuddy 可以从其宿主对话发起选品。

- **Codex** 使用桌面端深链接打开本项目工作区的新对话，并预填需求。需要已安装桌面应用及本项目 Skill，核对后在 Codex 发送。 [桌面端命令文档](https://learn.chatgpt.com/docs/app/commands#deep-links)
- **WorkBuddy** 使用第三方应用开放平台登记的应用身份生成一次性预填链接。启动本机服务前，在服务进程的环境中提供 `AUTO_PICK_WORKBUDDY_APP_ID`、`AUTO_PICK_WORKBUDDY_KEY_ID`、`AUTO_PICK_WORKBUDDY_KEY_FILE`。最后一项是 RSA-2048 PEM 私钥的绝对路径，放在仓库外。用户在 WorkBuddy 官方中间页确认打开后，可在对话核对并发送。未配置时可复制需求。 [WorkBuddy 第三方应用指南](https://open.workbuddy.cn/docs/third-party-app)

FastMoss 与 LinkFox 的数据授权仍在各宿主中完成。

## FastMoss

- **Codex 桌面端**：在插件中添加自定义 MCP 服务，URL 为 `https://mcp.fastmoss.com/mcp`，选择 OAuth 并在 FastMoss 登录页授权。按需在对话中选中 FastMoss。CLI 可参考同目录的 `fastmoss.codex.toml.example` 添加配置，运行 `codex mcp login fastmoss`，再检查工具是否可见。 [FastMoss 配置](https://developers.fastmoss.com/zh/docs/mcp/setup.html) · [Codex MCP 文档](https://developers.openai.com/codex/mcp)
- **WorkBuddy**：在「专家·技能·连接器」的「连接器」页搜索 FastMoss，添加并完成 FastMoss 账户授权，然后在任务内启用连接器。 [FastMoss 各宿主配置](https://developer.fastmoss.com/docs/mcp/setup)

验证请求可用「使用 FastMoss 查询 TikTok Shop 美国站最近 7 天的文具商品。列出 3 件候选，说明查询日期、币种和数据来源，并保存到选品工作台」。先确认宿主确实返回工具结果，再查看工作台的「FastMoss 趋势」。

## LinkFox

- **Codex**：按官方指南安装 LinkFox Skills，重新加载后检查是否有你需要的选品或货源技能。官方手动方式使用 `linkfoxskill init --agents codex` 和 `linkfoxskill install-all --agents codex`。先按官方指南安装 CLI，有需要时再按技能说明配置权限。 [LinkFox Codex 指南](https://wiki.linkfox.com/integrations/codex)
- **WorkBuddy**：按官方指南安装 LinkFox Skills，或从「连接器」添加 LinkFox 并授权自己的团队。如果连接器未暴露所需商品查询能力，选择对应的官方技能。 [LinkFox WorkBuddy 指南](https://wiki.linkfox.com/partners/workbuddy)

验证请求可用「使用可用的 LinkFox 1688 选品能力查询文具收纳类候选，保留批发价、币种、商品 ID 与时间窗，并保存到选品工作台」。选品或货源工具是否可用以当前账号和宿主实际返回为准。

## 本机回传

先启动选品台，再按 [外部数据工作流](../skills/auto-pick-studio/references/provider-research.md) 运行 `guide.mjs import-research`。项目检入的是连接示例、宿主调用流程与结果回传代码。各账户的安装、OAuth 和 API Key 在宿主中完成。报告与淘宝采集批次分别展示。
