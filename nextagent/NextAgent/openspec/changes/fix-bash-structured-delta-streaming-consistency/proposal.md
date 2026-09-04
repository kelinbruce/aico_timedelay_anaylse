## Why

Agent 开发者通过 Bash 调用 SSE/NDJSON 流式接口时，已经收到逐帧 `TOOL_STRUCTURED_DELTA`，但 Bash 执行完成后仍会收到同一结果的 terminal `CAPABILITY_RESULT_DELTA`。这与流式 ApiCall 的既有去重语义不一致，前端容易把同一输出呈现两次。

浏览器在 Pending Input 超时、取消或运行进入可恢复历史状态时会加载 run event history。当前同一条结构化增量的 live 投影和持久化投影可能使用不同 `eventId`，前端无法把它们识别为同一事实，导致历史加载后同一 `TOOL_STRUCTURED_DELTA` 帧重复渲染。

上游已经返回大写 `SUB_TITLE` / `SUB_DETAIL` 时，过程数据会被归并到 runtime Bash Capability 卡片的内部结构化分段；但浏览器当前把这些分段渲染为普通标题和正文，没有呈现 `SUB_TITLE` 的小圆圈图标，也没有 subordinate 层级效果。

上游返回包含 `authorization` 字段名或链接名的结构化内容时，该词本身并不代表 credential 值；当前敏感词过滤会把这类合法过程或答案内容整体降级为普通结果增量，浏览器无法收到结构化投影。

## 目标与非目标

**目标：**

- Bash 流式执行期间已经产生任何 result delta 时，成功完成后不再重复 emit terminal `CAPABILITY_RESULT_DELTA`。
- Bash 仍保留 `CAPABILITY_RESULT` Message、`CAPABILITY_COMPLETED`、执行状态、stdout/stderr/exitCode 语义和非流式回退行为。
- 同一条非 Workflow `TOOL_STRUCTURED_DELTA` 的 live 投影和持久化投影使用稳定相同的 event identity，Pending Input 超时后的历史加载不得重复渲染。
- 仅包含 `authorization` 关键字的结构化内容不再被整体拒绝；其他 credential indicator 仍触发既有敏感内容保护。
- Runtime Capability 卡片内部的 `SUB_TITLE` 分段呈现当前主题的小圆圈图标，并以 subordinate 层级显示；`SUB_DETAIL` 继续累积到匹配的 `SUB_TITLE` 下。
- `SUB_TITLE` / `SUB_DETAIL` 在同一 `toolCallId` 或稳定关联身份下继续按既有过程面板规则关联。

**非目标：**

- 不改变 `CAPABILITY_RESULT` Message 的模型上下文和 terminal 语义。
- 不改变 ApiCall 的流式终态抑制规则。
- 不改变 `eventType` / `messageType` 的大小写敏感契约。
- 不让 `SUB_TITLE` / `SUB_DETAIL` 进入答案正文；它们仍归过程面板。
- 不为不同 `toolCallId` 的结构化帧引入跨 Tool 调用的新关联语义。
- 除将 `authorization` 从结构化增量 credential indicator 关键字集中移除外，不放宽其他敏感内容检查、payload 容量上限或持久化截断规则。

## What Changes

- 修改 Bash 流式结构化增量结果契约：Bash 执行期间只要已经 emit 过 result delta，成功完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`；`CAPABILITY_COMPLETED` 和 `CAPABILITY_RESULT` Message MUST 保持。
- 新增非 Workflow `TOOL_STRUCTURED_DELTA` 的 live/history identity 契约：同一事实的实时投影和持久化投影 MUST 使用相同 `eventId` / `timelineEventRef`，供浏览器去重。
- 修改结构化增量敏感内容契约：`authorization` 不再单独作为 credential indicator 触发拒绝，`api_key`、`credential`、`password`、`secret` 和 `token` 保持拒绝。
- 新增 runtime Capability 卡片内部 `SUB_TITLE` 的视觉层级契约：`SUB_TITLE` MUST 使用当前主题的 circle icon，并以 subordinate 层级呈现其标题和后续 detail。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.16 识别和投射结构化工具增量` → `specs/tool-structured-delta/spec.md`
  - 功能边界：Bash 流式 terminal 投影去重、非 Workflow 结构化增量 live/history identity、authorization 关键字的结构化投影例外。
  - 系统质量属性：可靠性/恢复、安全、可维护性、可测试性。
  - 映射说明：canonical spec。

- `FN-10.6 前端定制` → `specs/agent-web-process-panel/spec.md`
  - 功能边界：runtime Capability 卡片内部 `SUB_TITLE` 分段的小圆圈图标和 subordinate 层级呈现。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec。

## 影响范围

- Agent 开发者通过 Bash 消费 SSE/NDJSON 结构化流时，前端收到的事件序列更接近 ApiCall 流式行为，减少重复输出。
- 浏览器用户在 Pending Input 超时、取消或历史恢复后不会看到同一结构化帧重复渲染。
- 浏览器用户在 runtime Bash Capability 卡片中能看到 `SUB_TITLE` 的小圆圈图标和 subordinate 层级。
- 受影响实现集中在 `agent-core`、`agent-runtime`、`frontend/agent-web` 和相关 characterization 测试；无配置、部署或持久化 schema 迁移。
- 仅包含 `authorization` 字段名、链接名或业务术语的结构化内容可继续作为 structured presentation 投影；携带 `token` 等其他 credential indicator 的内容仍走普通结果增量保护路径。
