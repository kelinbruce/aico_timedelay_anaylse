## 设计范围

| Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.16 识别和投射结构化工具增量` | Bash 流式 terminal 去重、非 Workflow 结构化增量 live/history identity、authorization-only 结构化内容放行 | `specs/tool-structured-delta/spec.md` | §1 |
| `FN-10.6 前端定制` | Runtime Capability 卡片内部 `SUB_TITLE` 的小圆圈图标和 subordinate 层级 | `specs/agent-web-process-panel/spec.md` | §2 |

本 change 不新增 Function、public API、DTO、Record、gateway contract 或配置项，也不修改持久化 schema。

## §1 `FN-5.16 识别和投射结构化工具增量`

### 目标与规范依据

本 Function 的黑盒目标是：Bash 流式执行已经向客户端投递 result delta 时，不再重复投递成功 terminal `CAPABILITY_RESULT_DELTA`；同一非 Workflow `TOOL_STRUCTURED_DELTA` 在实时与历史投影中可被浏览器识别为同一事实。

本 Function 的目标 Requirements：

- `MODIFIED TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA`
- `MODIFIED Streaming TOOL_STRUCTURED_DELTA Persistence`
- `MODIFIED Security Constraints`
- `MODIFIED Bash Streaming Structured Delta Emission`

### 当前实现

- `agent-core/src/tools/tool-loop.ts` 已维护 `structuredDeltaEmittedDuringExecution`，但只用于跳过完成后的 `TOOL_STRUCTURED_DELTA`；Bash 成功完成后仍无条件 emit terminal `CAPABILITY_RESULT_DELTA`。
- `agent-core/src/tools/structured-delta-safety.ts` 的敏感词 pattern 包含 `authorization`，会把仅包含授权字段名、链接名或业务术语的结构化内容整体降级。
- `agent-runtime/src/lifecycle/agent-run-state-port.ts` 拦截非 Workflow `TOOL_STRUCTURED_DELTA` 时，会分别调用两次 `liveOnlyEvent(...)`：一次给 live subscriber，一次给 accumulator / direct persistence。原始 event 未携带 `eventId` 时，两次调用生成不同 `eventId`。
- 浏览器 run event history 与 live stream 合并依赖 `eventId` 去重。live 与持久化 event identity 不一致时，Pending Input 超时后加载 process history 会把同一帧渲染两次。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Bash 流式 result delta 后不再重复 terminal `CAPABILITY_RESULT_DELTA` | 只有 ApiCall default-agent path 有 terminal suppression；Bash tool-loop 无条件 emit | 需要 Bash 专属执行期 result delta 标志和成功 terminal guard |
| live/history 同一事实可去重 | live 与持久化 event 分别生成 `eventId` | 需要为同一 runtime event 构造一次 `liveOnlyEvent` 并复用 |
| authorization-only 内容可结构化投影 | `authorization` 参与敏感词拒绝 | 需要从 credential indicator 集合移除该关键字，并保留其他 credential indicator |

### 修改方案

1. **Bash terminal result delta 去重**
   - 在 `agent-core/src/tools/tool-loop.ts` 的单次 prepared tool invocation 作用域新增局部 `bashResultDeltaEmittedDuringExecution` 标志。
   - 仅当 descriptor 的 `capabilityId === "Bash"` 且 `emitResultDelta` callback 被调用时置位。该标志表示执行期已投递任意 result delta，不区分结构化与非结构化，与 ApiCall suppression 语义一致。
   - Bash 成功完成路径在该标志为 true 时跳过 terminal `CAPABILITY_RESULT_DELTA`；失败、超时、取消、`CAPABILITY_COMPLETED`、`CAPABILITY_RESULT` Message 和非流式路径不变。

2. **live/history event identity**
   - 在 `agent-runtime/src/lifecycle/agent-run-state-port.ts` 拦截非 Workflow `TOOL_STRUCTURED_DELTA` 时先构造一次 `liveEvent`。
   - live subscriber、`accumulated=true` direct write、accumulator accept 与后续 flush 全部复用该对象及其 `eventId`。
   - 不改变持久化分类、聚合规则、flush 时序、容量上限或 Workflow product 路径。浏览器现有 `eventId` / `timelineEventRef` 合并逻辑无需新增平行去重键。

3. **authorization-only 结构化内容放行**
   - 将 `agent-core/src/tools/structured-delta-safety.ts` 的 credential indicator pattern 调整为 `api_key`、`credential`、`password`、`secret`、`token`。
   - 不改变 structured shape 识别、其他敏感词拒绝、普通 result delta fallback 或模型可见的 canonical result。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `Streaming TOOL_STRUCTURED_DELTA Persistence` | 同一 runtime event 复用一个 `eventId`，使 Pending Input 超时后的 history 合并可去重 | live subscriber event 与 persisted record 的 event identity 一致；历史加载不重复渲染 |
| 安全 | `Security Constraints` | 仅收窄 credential indicator 关键字集合，其他 credential indicator 继续阻止 structured delta emit | authorization-only 内容 emit；含 `token` 等其他 indicator 的内容不 emit |
| 可测试性 | 本 change 的功能性 Requirements | Bash suppression 与 live/history identity 均用 characterization 测试锁定 | normal、mixed、non-streaming、sensitive content 均有断言 |

## §2 `FN-10.6 前端定制`

### 目标与规范依据

本 Function 的黑盒目标是：上游返回大写 `SUB_TITLE` / `SUB_DETAIL` 并归并到 runtime Bash Capability 卡片时，用户能直观看到 `SUB_TITLE` 的小圆圈图标和 subordinate 层级，而不是普通平铺文本。

本 Function 的目标 Requirements：

- `ADDED Runtime Capability 内 SUB_TITLE 层级视觉呈现`

### 当前实现

- `frontend/agent-web/src/features/chat/process/processDetails.ts` 已把匹配 runtime Capability lifecycle 的 `SUB_TITLE` 归并为 `structuredSections`，并把 `SUB_DETAIL` / `SUB_CONCLUSION` 累积到该 section。
- `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx` 的 `StructuredProcessSections` 只渲染 section 标题和正文，未读取 `section.toolEventType`，因此内部 `SUB_TITLE` 没有小圆圈图标，也没有 subordinate 缩进。
- 独立 `SUB_TITLE` 顶层条目已经通过 `resolveProcessIconType(..., toolEventType)` 使用 circle icon。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Runtime Capability 内 `SUB_TITLE` 显示 circle icon | `StructuredProcessSections` 忽略 `toolEventType` | 需要在 section 渲染中识别 `SUB_TITLE` 并复用主题 circle asset |
| Runtime Capability 内 `SUB_TITLE` 显示层级 | section 平铺渲染 | 需要为 `SUB_TITLE` section 应用 subordinate 缩进 |
| 不创建第二个顶层条目 | `processDetails.ts` 已归并到原 Capability 卡片 | 无数据结构 GAP，需测试锁定 |

### 修改方案

- `StructuredProcessSections` 接收当前主题信息。
- 对 `section.toolEventType === "SUB_TITLE"` 的分段渲染当前主题 `circle-dark.svg` / `circle-light.svg` 小圆圈图标。
- `SUB_TITLE` section 的标题和内容使用 subordinate 缩进；`SUB_DETAIL` / `SUB_CONCLUSION` 继续由 `processDetails.ts` 累积到该 section 的 detail / structuredSegments。
- 不改变结构化事件归并、Capability lifecycle、披露状态、自动折叠和独立 `SUB_TITLE` 顶层条目行为。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | `Runtime Capability 内 SUB_TITLE 层级视觉呈现` | 复用既有 circle asset 与 `ProcessStructuredSection.toolEventType`，不建立平行事件解析 | 组件测试断言 circle icon、subordinate 层级和单顶层条目 |
| 可测试性 | `Runtime Capability 内 SUB_TITLE 层级视觉呈现` | 用 ProcessPanel characterization 测试覆盖 runtime Bash 卡片内部 section | 大写 `SUB_TITLE` / `SUB_DETAIL` 输入下行为稳定 |

## 跨 Function 协作与端到端流程

Bash streaming 先由 `FN-5.16` 产出 canonical `TOOL_STRUCTURED_DELTA` 并保证 live/history identity；`FN-10.6` 消费该 stream projection，在 runtime Capability 卡片内呈现 `SUB_TITLE` 层级。两个 Function 不改变彼此的 event contract 或 ownership。

## 验证策略

- **characterization / unit**：
  - Bash 流式结构化帧：逐帧 `TOOL_STRUCTURED_DELTA`、无 terminal `CAPABILITY_RESULT_DELTA`、保留 `CAPABILITY_COMPLETED`。
  - Bash 流式非结构化帧：保留 per-frame `CAPABILITY_RESULT_DELTA`，无额外 terminal `CAPABILITY_RESULT_DELTA`。
  - Bash 非流式 / 无 result delta callback：terminal `CAPABILITY_RESULT_DELTA` 保持。
  - live subscriber 与 persisted structured delta record 使用相同 `eventId`。
- **frontend projection / component**：
  - 相同 `eventId` 的 live/history structured presentation 只保留一份。
  - Runtime Bash 卡片内部 `SUB_TITLE` 显示当前主题 circle icon 和 subordinate 层级，`SUB_DETAIL` 位于其下，不产生第二个顶层条目。
- **negative case**：
  - 敏感内容不产生 `TOOL_STRUCTURED_DELTA`。
  - 不同 `toolCallId` 的 `SUB_TITLE` / `SUB_DETAIL` 不隐式合并。
- **OpenSpec**：`openspec validate --all --strict`。
- **安全 characterization**：authorization-only 结构化内容 emit `TOOL_STRUCTURED_DELTA`；仍包含其他 credential indicator 的内容不 emit。

## 长期基线刷新计划

- `openspec/specs/tool-structured-delta/spec.md`：归档时合并四个 MODIFIED Requirements。
- `openspec/specs/agent-web-process-panel/spec.md`：归档时合并新增的 `Runtime Capability 内 SUB_TITLE 层级视觉呈现` Requirement。
- `openspec/designs/functions/` 中 `FN-5.16`、`FN-10.6` 对应文档：分别更新流式 terminal / identity、authorization-only 结构化投影安全边界与过程面板视觉层级。
- `openspec/overview.md`：更新结构化增量当前基线描述。
- `openspec/designs/spec-to-design-map.md`：如 Function 文档路径或 Requirement 导航变化则同步。
- Feature、architecture、module、ADR：无。

## 风险与取舍

- Bash suppression 以“执行期已调用 result delta callback”为条件，而不是只看结构化帧，避免混合流中 per-frame 非结构化输出再被 terminal 聚合重复一次；失败路径不受影响。
- live/history identity 修复选择复用同一 runtime event，而不是在浏览器增加第二套语义去重键，避免掩盖后端事实身份错误。
- `SUB_TITLE` 视觉层级只作用于已归并到 runtime Capability 卡片的 structured section，不改变独立 structured workflow 条目的既有行为。

## 待确认问题

无。
