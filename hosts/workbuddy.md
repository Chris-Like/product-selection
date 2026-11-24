# WorkBuddy 侧安装说明

1. 把 `skills/auto-pick-studio/` 整个目录复制到用户级 skills 目录：

   ```text
   C:\Users\<你的用户名>\.workbuddy\skills\auto-pick-studio\
   ```

2. `SKILL.md` 是 WorkBuddy 的对话行为协议。用户说「帮我找选品机会」「验证一个方向」「跟踪候选」时，插件必须在当前 WorkBuddy 对话中按一次一问的工作流执行，不把问答转移到本机网页。
3. 脚本里的相对路径按**工程根目录**解析，所以 Skill 触发时需要把工作目录设为 `auto-pick-studio/`；或在宿主配置里显式指定 `cwds`。
4. 服务只绑 `127.0.0.1`，端口为示例值，待确认，可用 `AUTO_PICK_PORT` 覆盖。
5. WorkBuddy 与 Codex 共用 `app/` 下同一份业务逻辑和 `scripts/guide.mjs` 桥接协议，不要复制 `app/` 到 skills 目录里另起一份。

> 本文件只写安装与触发约定；口径以《自动选品插件_SkillPlugin形态_定稿_V1.0.md》为准。宿主实际安装规范以 WorkBuddy 官方文档为准，必要时核验。
