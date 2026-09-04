## 背景与问题（Why）

Human Pending Input 能力组已经在 roadmap 中标记为 ready，但当前冻结契约只保留了最小 pending input skeleton。它还缺少实现六个后续 change 时必须共享的窄契约：

- `PendingInputQuestion` 需要表达选项题是否允许多选，以及是否允许自定义文本；这些约束只能来自可信 upstream intent，客户端 answer 不能自报 schema。
- `PendingInputStoreGateway` 需要提供 active-pending 和 due-timeout 两类 fact query，让 runtime 能在同一 session 新 submit、重启后 timeout 扫描和恢复路径中基于 durable facts 做决策。
- `PendingInputStoreGateway.resolvePendingInput` 需要为 answer command 提供 gateway-owned idempotency anchor，让同一 answer command 的网络重试能返回等价结果，并让同 key 不同语义返回 safe conflict；该 key 不能进入 `PendingInputAnswer` 客户端 payload，也不能作为 `PendingInput` / `PendingInputRecord` 业务字段暴露。
- `Agent.execute(...)` 需要显式表达“已创建 pending input、当前 run 暂停但未 terminal”的 control outcome；Capability invocation producer 需要一个 runtime-owned internal handoff 提交 validated `PendingInputIntent`，否则 implementation change 会各自发明暂停信号或私有等待状态。

如果这些字段、query、resolve 幂等锚点和 core-to-runtime 暂停出口分散写进后续业务 change，会导致多个 change 同时修改 `agent-contracts/runtime`、`agent-contracts/gateway`、Agent execution port 和 gateway adapter surface，破坏核心契约边界。

## 变更范围（What Changes）

- 在 `agent-contracts/runtime` 的 `PendingInputQuestion` / `PendingInputIntent` / `PendingInputRequest` 相关问题对象中增加 `multiple?: boolean` 和 `custom?: boolean`。
- 在 `agent-contracts/gateway` 的 `PendingInputQuestionRecord` / `PendingInputRequestRecord` 中同步保存 `multiple?: boolean` 和 `custom?: boolean`，缺省都等价 `false`。
- 明确 `PendingInputAnswer.answers` 继续使用 `string[][]`：文本题只能提交一个非空字符串；单选题只能提交一个总值；多选题可以提交多个唯一值；`custom=true` 时允许至多一个非 option 自定义文本。
- 在 `PendingInputStoreGateway` 增加 `loadActivePendingInput`，按 `tenantId + subjectId + agentId + sessionId` 返回当前 active `PENDING` fact。
- 在 `PendingInputStoreGateway` 增加 `listDuePendingInputs`，按 `now + limit` 返回已到期且仍为 `PENDING` 的 durable facts，供 runtime timeout/recovery 内部消费；返回顺序必须稳定。
- 在 `agent-contracts/gateway` 的 `PendingInputRecord` durable fact 中增加 runtime-owned minimal `producerRef` resume coordinate；它只能是 `{ kind: "LIFECYCLE_HOOK" }` 或 `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`，只用于 answer resume 分支和原 tool call materialization。
- 将 `resolvePendingInput` 收紧为带 idempotency write option / semantic 的 pending resolve 操作：相同 scoped key + semantic 重放返回等价 resolved record，不同 semantic 重用 key 返回 idempotency conflict。
- 在 `agent-contracts/runtime` 增加 `AgentExecutionOutcome`，并将 `Agent.execute(...)` 返回值收敛为显式 outcome：`COMPLETED` 表示可走既有 terminal commit，`PENDING_INPUT` 表示 runtime-owned pending 已创建且当前 run 必须暂停。
- 在既有 `AgentRunStatePort` 增加 `requestPendingInput(run, context, intent): Promise<PendingInputRequest>`，作为 Capability invocation producer 提交 validated `PendingInputIntent` 的唯一 runtime-owned internal handoff；该入口只创建 pending fact 和返回 safe pending request，不等待用户 answer；成功返回后 Agent/core 必须立即返回 `AgentExecutionOutcome.PENDING_INPUT`。
- 明确 `requestPendingInput(...)` 是 success-only handoff：只有 acceptance 成功才返回 `PendingInputRequest`；handoff 失败沿用既有 runtime/capability safe failure path，由调用方 producer 归类，不新增第三种 `AgentExecutionOutcome`，也不改变 ordinary `CapabilityInvocationPort.invoke(...)` 的工具失败语义。
- 明确本 change 只冻结 shared contract surface；checkpoint-before-visible、`USER_INPUT_REQUIRED` 投影、same-session lane block、answer resume、cancel resolution、timeout resolution 和 type-specific validation 由后续 pending lifecycle / type-specific changes 实现。实现不得创建缺少这些生命周期保证的 visible/durable partial pending input。
- 明确不新增 `RunStatus`，不新增 pending-input 专属 `agent-contracts` subpath，不新增 answer schema 字段、timeout behavior 字段、origin 字段或 model-formatted answer 字段。

## 架构约束下的修改说明

- 需要修改：只修改共享契约面和对应 gateway adapter surface，包括 `agent-contracts/runtime` question shape、Agent execution outcome、`AgentRunStatePort` internal handoff、`agent-contracts/gateway` pending fact query/resolve contract、本地/远端 gateway adapter 和 contract/architecture tests。
- 修改后的变化：后续 pending input core、question、confirmation、authorization、handoff 和 AskUserQuestion producer 都复用同一 `PendingInputQuestion`、同一 `PendingInputAnswer.answers`、同一 pending resolve 幂等锚点和同一 core-to-runtime 暂停出口，不再各自扩展平行 DTO、Record、status 或 control signal。
- 影响：这是后续 pending input core、type-specific pending input change 和 AskUserQuestion tool change 的前置编译和契约基础；adapter 未实现前会暴露 TypeScript/contract test 缺口，但不会改变 Web DTO、RunStatus 或 channel ownership。
- 边界：`multiple` / `custom` 只能来自 accepted pending request；`producerRef` 只能由 runtime/core 从 trusted execution context 写入 durable pending fact，不进入 tool input、client answer、Web DTO 或 `AgentExecutionOutcome`；`idempotencyKey` / `idempotencySemantic` 是 gateway write metadata；`idempotencySemantic` 由 runtime 从 pending coordinate、target resolve status 和 validated ordered answers 计算，并使用版本化确定性 tuple 编码，gateway 只做 opaque equality comparison；timeout behavior、origin、audit linkage、answer schema 和 model-formatted answer 不进入 `PendingInput` / `PendingInputRecord` / client answer payload。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-core-contracts`：收紧 pending input 问题/答案契约，补充 gateway fact-query、resolve idempotency surface，以及 runtime/core 的 pending pause outcome surface。

## 影响范围（Impact）

- 影响 package：`agent-common` 不变；`agent-contracts/runtime`、`agent-contracts/gateway`、`agent-runtime`、`agent-platform-gateway-local`、`agent-platform-gateway-remote`、相关 contract/architecture tests。
- 依赖关系：后续 `add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`、`add-ts-question-pending-input`、`add-ts-confirmation-pending-input`、`add-ts-authorization-pending-input`、`add-ts-human-handoff` 和 `add-ts-ask-user-question-tool` 消费本 refinement。
- 不修改 Web DTO ownership；channel 仍只投影 safe `PendingInputRequest` 并提交 client answer。Web command idempotency key 属于 command envelope/header 或 channel command boundary，不属于 `PendingInputAnswer` payload。
- 不定义进入 pending 的业务触发条件；后续 producer change 只能通过本 refinement 中的 hook pending intent 或 `AgentRunStatePort.requestPendingInput(...)` 进入 runtime-owned handoff。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：补充 pending input question `multiple` / `custom`、answer shape 约束、gateway fact-query 行为、resolve idempotency 行为和 `AgentExecutionOutcome` 暂停出口。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 active pending lookup、due timeout scan 和 answer resolve idempotency 作为 runtime-owned decision 的边界。
- `openspec/designs/modules/agent-contracts.md`：补充 runtime/gateway owning export surface 变化，并统一 pending question 字段命名与 answer idempotency 归属。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 消费这些 query 和 resolve idempotency 的边界。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。
