## 背景与问题（Why）

workflow 执行（尤其 LLM、DISPLAY 节点）在电信网络诊断场景中产出的可见内容经常超过 16384 字符。该内容经 `WorkflowRuntimeEventProjector` 投影为 `LLM_CONTENT_DELTA` 后，在两个位置遭遇 16384 瓶颈：

1. **契约层**：`WorkflowVisibleDeltaSchema.content.maxLength` 固化为 16384。远程执行模式下 `adaptFetchWorkflowRemoteGateway` 对收到的 SSE event 执行 `Value.Check(WorkflowExecutionEventSchema, item.event)`，content 超限即判定为 `WORKFLOW_REMOTE_INVALID_RESPONSE` 并整条丢弃，导致后台数据无法继续推送。
2. **运行时层**：`maxTerminalMessageChars` 固化为 16384。`RuntimeOwnedAgentRunStatePort.emitEvent()` 对 `LLM_CONTENT_DELTA` 的 `content` 检查长度，超限即设置 `output.exceeded = true`、发出一条 `DEGRADATION_NOTICE`，此后静默丢弃所有后续事件并强制 terminal status 为 `FAILED`。`commitTerminalOutcome()` 在 terminal commit 阶段对 `COMPLETED` 状态做同样检查。

两个瓶颈位于同一数据通路，必须同步提升，否则只修一处仍会被另一处截断。

## 变更范围（What Changes）

- **修改** `agent-contracts/core` 中 `WorkflowVisibleDeltaSchema.content` 的 `maxLength`：从 `16_384` 提升到 `150_000`。
- **修改** `agent-runtime` 中 `maxTerminalMessageChars` 常量：从 `16_384` 提升到 `150_000`。

## 不在范围内（Explicit Non-Goals）

- 不修改 `maxModelVisibleChars`（16384），该常量仅约束 direct LLM streaming 路径，不影响 workflow delta 投影路径。
- 不修改 large-content 阈值体系（`inline-max-bytes` / `aggregate-max-chars`），那是 context assembly 层的独立机制。
- 不改变 `visibleDelta` 的安全语义（依然是安全文本增量，禁止 prompt / raw model output / secret）。
- 不引入分片机制或配置项；workflow delta 本身是增量语义，单次 delta 代表一个节点的完整可见输出。

## Capability 影响（Capabilities）

### 修改的 Capability

- `workflow-contracts`：`WorkflowVisibleDeltaSchema.content.maxLength` 由 16384 提升到 150000。
- `agent-runtime`：`maxTerminalMessageChars` 由 16384 提升到 150000，影响 `emitEvent()` 和 `commitTerminalOutcome()` 的终端内容守卫。

## 影响范围（Impact）

- `agent-contracts/core`：schema 常量修改。
- `agent-runtime`：`failure-normalizer.ts` 常量修改；`agent-run-state-port.ts` 和 `terminal-commit.ts` 行为自动放宽（引用同一常量）。
- `agent-workflow`：远程 bridge 的 `Value.Check` 行为自动放宽（schema 引用未变）。
- 安全：`visibleDelta` 的安全约束（无 prompt / raw output / secret）不变，仅提升容量上限。150000 字符 ≈ 150KB，仍在单次 SSE frame 合理范围内。
- 测试：`output-guard.test.ts` 中 3 个测试用例的 oversized 内容需同步调大以超过 150000。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-contracts/spec.md`：`Safe Visible Delta` requirement 增加 content maxLength 量化约束。

设计视图：
- 无需更新，不涉及架构或模块边界变化。

验证入口：
- contract test：schema maxLength 断言。
- characterization test：远程 bridge 接受 150000 字符 content 事件并拒绝 150001 字符事件。
- characterization test：runtime `emitEvent()` 接受 150000 字符 content、150001 字符触发 `TERMINAL_MESSAGE_LIMIT_EXCEEDED`。