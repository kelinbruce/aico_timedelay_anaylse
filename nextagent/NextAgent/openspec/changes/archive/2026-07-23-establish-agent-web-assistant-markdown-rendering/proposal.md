## 背景与问题（Why）

`agent-web` 已经把状态为 `COMPLETED` 的普通 assistant `LLM_CONTENT_DELTA` 正文渲染为 Markdown，并支持 GFM 风格表格、行内代码和普通代码围栏。相关生产调用链和定向测试均已存在，但 Stable Specs 尚无 capability 拥有这些用户可观察行为，导致实现、测试和权威规格之间存在缺口。

本 change 只把当前代码已经实现、并由绿色测试证明的普通回答渲染行为建立为增量规格。Mermaid、安全过滤完整性、结构化消息和其他对话功能存在独立 owner 或已知冲突，不得借本 change 固化。

## 变更范围（What Changes）

- 为状态为 `COMPLETED` 的普通 assistant `LLM_CONTENT_DELTA` 正文定义 Markdown 语义渲染，包括标题、列表、引用、强调、行内代码和普通代码围栏。
- 为已完成普通 assistant 正文定义 GFM 风格 pipe table 的语义化表格渲染，以及当前测试覆盖的缺失边界 pipe、拆行、拼接和扁平化行修复。
- 明确表格单元格继续支持已测试的行内 Markdown、escaped pipe 和 inline-code pipe；普通代码围栏中的表格形状文本保持代码内容。
- 只补测试装配和表征测试，不改变生产渲染行为。
- 明确排除 Mermaid、structured `TOOL_STRUCTURED_DELTA`、Expand Panel、Capability result、ProcessPanel、answer actions、stream aggregation、精确 CSS/动画/缓存、全局 sanitization 和日志安全保证。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-assistant-markdown-rendering`: 定义已完成普通 assistant 正文的 Markdown、GFM 风格表格和普通代码语义渲染边界。

### 修改的 Capability

无。

## 影响范围（Impact）

- OpenSpec：新增一个独立 capability 的 delta spec，不修改任何 Stable Spec 或其他未归档 change。
- 前端代码：不修改生产代码；现有 owner 仍为 `TurnBlockComponent`、`MarkdownContent`、`MarkdownWithTables` 和相关 presentation helper。
- 测试：给现有 GFM 表格测试补齐真实 `AppProviders` 装配，并新增普通 assistant Markdown/代码语义表征测试。
- API、stream event、DTO、runtime lifecycle、persistence、依赖、配置和运维：无变化。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-assistant-markdown-rendering/spec.md`：新增本 change 验证通过的已完成普通 assistant Markdown、GFM 风格表格和普通代码渲染契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/<topic>.md`：无；本 change 不新增跨模块流程、接口或数据 owner。
- `openspec/designs/modules/agent-web.md`：归档前补充普通 assistant Markdown renderer 的职责、调用链、复用边界和 Mermaid 非职责。
- `openspec/designs/adr/<id>.md`：无；本 change 不引入新的长期技术取舍。
- `openspec/designs/spec-to-design-map.md`：归档前增加新 capability 到 `agent-web` module 设计和验证入口的导航。

验证入口：
- `frontend/agent-web/tests/assistant-markdown-rendering.test.tsx`
- `frontend/agent-web/tests/markdown-gfm-table.test.tsx`
