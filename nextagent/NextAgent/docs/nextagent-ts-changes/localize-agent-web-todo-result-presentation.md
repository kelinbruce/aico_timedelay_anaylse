# localize-agent-web-todo-result-presentation

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P1

状态：ready
类型：implementation change
主要 owner：`frontend/agent-web` process presentation
认领人：未认领
依赖：`todo-write-tool`、现有 `todoList` safe result projection、现有 frontend i18n

当前状态：
- `frontend/agent-web/src/features/chat/process/processDetails.ts` 已接收既有 translation function，但 todo formatter 仍硬编码英文 summary、empty state 和 status label。

目标：
- 让 todoList 工具结果的系统生成摘要、状态标签和空态跟随当前界面语言，同时保留 Agent 生成的任务内容原文。

规格输入：
- `Todo list is clear`、`Todo list updated (N)`、`Pending`、`In progress`、`Completed` 等 presentation-owned 文案必须通过现有 i18n bundle 渲染。
- `todos[].content` 和 `todos[].activeForm` 是 Agent/能力产生的业务内容，不做客户端机器翻译或替换。
- locale 切换后，已渲染的 todoList presentation-owned 文案必须按现有 i18n lifecycle 更新。
- 非法或未知 status 继续由现有 `readSafeCapabilityResult` fail closed，使 todoList 专用 formatter 不运行并沿既有 generic safe-summary fallback 呈现；不得把原始任意字符串当作翻译 key，也不得为本地化扩大 parser/schema。

契约输入：
- 复用现有 `SafeCapabilityResult.kind = "todoList"` 和前端 locale context；不修改 safeResult schema、stream event 或 backend locale contract。

实现约束：
- formatter 必须接收现有 translation function，不直接 import 独立翻译实例或硬编码语言判断。
- zh-CN/en-US 使用同一组稳定 key 和参数结构；count 使用插值，不拼接语言相关语序。

非目标：
- 不翻译 Agent 生成的 todo 内容，不修改 todo-write 工具语义。
- 不重构通用 Tool Presentation Policy，不修改 ProcessPanel 折叠、动画或 history continuity。

验收要点：
- unit tests 覆盖 zh-CN/en-US 的空列表、计数摘要和三个合法 status。
- tests 覆盖 locale 切换、非法 status 仍走既有 generic fallback，并证明 todo content/activeForm 保持原文。
- frontend build 和相关 process presentation tests 通过。

并行边界：
- 只修改 todoList formatter、对应 i18n keys 和定向测试。
- 不修改 process state model、stream projection、runtime lifecycle 或其他 safeResult kind。
- 本 change 拥有新增 todo i18n keys；若与 session run-awareness 并行，双方须先约定共享 `en-US.ts`/`zh-CN.ts` 写入区。
