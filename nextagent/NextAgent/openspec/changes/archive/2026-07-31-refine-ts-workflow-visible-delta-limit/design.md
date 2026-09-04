## 问题

workflow 可见内容推送路径存在两个 16384 字符瓶颈：

1. **契约层** `WorkflowVisibleDeltaSchema.content.maxLength = 16_384`：远程执行模式下 `adaptFetchWorkflowRemoteGateway` 对每个 SSE event 执行 `Value.Check(WorkflowExecutionEventSchema, item.event)`，content 超限即返回 `WORKFLOW_REMOTE_INVALID_RESPONSE` 并终止流。
2. **运行时层** `maxTerminalMessageChars = 16_384`：`RuntimeOwnedAgentRunStatePort.emitEvent()` 对 `LLM_CONTENT_DELTA` 的 `content` 检查长度，超限即设置 `output.exceeded = true`、发出一条 `DEGRADATION_NOTICE`（code: `TERMINAL_MESSAGE_LIMIT_EXCEEDED`），此后静默丢弃所有后续事件并强制 terminal status 为 `FAILED`。`commitTerminalOutcome()` 在 terminal commit 阶段对 `COMPLETED` 状态做同样检查。

数据通路：workflow 节点 → `emitOutputDelta` → `WorkflowRuntimeEventProjector.projectLlmNodeEvent()` → `LLM_CONTENT_DELTA`（携带累积内容）→ `runState.emitEvent()` → `maxTerminalMessageChars` 检查 → live event 推送（`onLiveTimelineEvent`）→ SSE/WebSocket。

两个瓶颈位于同一数据通路。只修契约层而运行时层仍为 16384 时，通过远程 bridge 校验的内容仍会在 `emitEvent()` 被丢弃。反之亦然。必须同步提升。

## 方案

唯一方案：将两个常量同时从 `16_384` 提升到 `150_000`。

### 同形同策分析

两个常量服务同一目的（限制单次可见内容大小）、位于同一数据通路、具有相同安全不变量（禁止 prompt / raw output / secret）。按同形同策原则，必须使用同一数值。若数值不一致，会导致一个检查通过、另一个检查失败的矛盾行为。

### 为什么 150000

- 150000 字符（约 150KB UTF-8）覆盖电信网络诊断报告的典型体量（告警分析、配置核查结果、网管对接数据等可达数万字符）。
- 仍在单次 SSE frame 的合理传输范围内。HTTP/1.1 chunked transfer 下 150KB 可正常传输。
- TypeBox `Value.Check` 对 150000 字符的 maxLength 校验为 O(1) 比较，无性能问题。

### 为什么不引入分片或配置项

- workflow delta 本身是增量语义，单次 delta 代表一个节点的完整可见输出。分片会引入跨 delta 状态管理复杂度，当前场景不需要。
- 该限制是 schema 层硬约束，不是运行时可调参数。引入配置会增加不可信边界的攻击面。

## 安全

`visibleDelta` 的安全语义不变：仍然禁止 prompt、raw model output、raw capability result、secret、path。安全过滤发生在节点执行层（如 `assertSafeDisplayContentForType`），而非 schema 层。提升容量上限不会增加信息泄露风险。

`maxTerminalMessageChars` 的安全语义不变：超限时仍然以安全消息替换原始内容（`"Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED"`），不泄露原始内容。提升上限仅意味着更大但仍在安全范围内的内容可以通过。

## 性能/容量

单次 SSE frame 150KB 在 HTTP/1.1 chunked transfer 下可正常传输。TypeBox `Value.Check` 对 maxLength 校验为 O(1) 比较。`emitEvent()` 中的 `content.length` 检查同样是 O(1)。无性能问题。

## 可靠性/恢复

不涉及。两个常量的修改不影响 workflow 执行的容错或恢复机制。`emitEvent()` 的超限降级行为（发出 `DEGRADATION_NOTICE` + 安全消息替换 + 强制 `FAILED`）保持不变，只是阈值从 16384 提升到 150000。

## 可测试性

- contract test：验证 `WorkflowVisibleDeltaSchema` 接受 150000 字符 content、拒绝 150001 字符 content。
- characterization test：验证远程 bridge 接受 150000 字符 content 事件并正常回放、拒绝 150001 字符事件并返回 `WORKFLOW_REMOTE_INVALID_RESPONSE`。
- characterization test：验证 runtime `emitEvent()` 接受 ≤150000 字符 content 正常推送、>150000 字符触发 `TERMINAL_MESSAGE_LIMIT_EXCEEDED` 降级。已有 `output-guard.test.ts` 覆盖此路径，需同步调大测试数据。

## 质量属性审视

| 属性 | 结论 |
|------|------|
| 安全 | 安全语义不变，仅提升容量上限 |
| 性能/容量 | O(1) 校验，150KB SSE frame 可正常传输 |
| 可靠性/恢复 | 不涉及，降级行为保持不变 |
| 可维护性 | 两常量同步修改，同形同策，无额外维护负担 |
| 可测试性 | contract + characterization test 覆盖 |
| 审计/可追溯 | 超限时仍发出 `DEGRADATION_NOTICE`，审计行为不变 |

## 不适用理由

- 不引入配置项或扩展点（KISS）。
- 不修改 `maxModelVisibleChars`（16384），它服务 direct LLM streaming 路径，与 workflow delta 路径无关。
- 不修改 large-content 阈值体系，那是 context assembly 层的独立机制。
- 不改变 `visibleDelta` 的 channel 类型或安全过滤逻辑。

## 归档前要更新到的长期设计文档

- 无需更新。不涉及架构或模块边界变化，仅为常量数值调整。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-contracts/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
