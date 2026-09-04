# refine-ts-pending-input-contracts

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：contract refinement change
主要 owner：`agent-contracts/runtime`、`agent-contracts/gateway`、`PendingInputStoreGateway`
依赖：`establish-ts-core-contracts`

目标：

- 收敛后续 Human Pending Input change 共享的 pending input contract surface。
- 避免六个 implementation change 和 AskUser producer 分散修改核心三对象契约、runtime/core 暂停出口、gateway fact query 和 resolve idempotency。

规格输入：

- question/request shape 支持 `multiple?: boolean` 和 `custom?: boolean`，缺省语义都等价 `false`。
- client answer 仍只提交 ordered `string[][]`，不能携带题型、schema、identity、idempotency 或 timeout behavior。
- gateway 必须支持按 owner+agent+session 查询当前 active `PENDING` pending input。
- gateway 必须支持 bounded due timeout fact query，供 runtime timeout/recovery 内部消费。
- pending resolve 必须在 gateway write boundary 支持 scoped idempotency metadata。
- `Agent.execute(...)` 必须返回 `AgentExecutionOutcome`，且 outcome 只允许 `{ status: "COMPLETED" }` 或 `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }`；`PENDING_INPUT` 表达 pending fact 已创建且 run 暂停但未 terminal。
- Capability invocation producer 必须通过 `AgentRunStatePort.requestPendingInput(run, context, intent): Promise<PendingInputRequest>` 提交 producer-local validated `PendingInputIntent`；runtime 仍必须做最终 acceptance validation，该方法只返回 safe pending request，不等待 answer、不返回 lifecycle decision、不保存私有 wait/resume state。
- `requestPendingInput(...)` 是 success-only handoff：只有 acceptance 成功才返回 `PendingInputRequest`；handoff 失败沿用既有 runtime/capability safe failure path，由 producer 归类，不新增第三种 `AgentExecutionOutcome`，也不改变 ordinary `CapabilityInvocationPort.invoke(...)` 的工具失败语义。
- 本 refinement 只冻结 shared contract surface；checkpoint-before-visible、`USER_INPUT_REQUIRED` 发布、same-session lane block、answer resume、cancel resolution、timeout resolution 和 type-specific validation 由后续 pending lifecycle / type-specific changes 实现。

契约输入：

- `PendingInputQuestion.multiple?`
- `PendingInputQuestion.custom?`
- `PendingInputQuestionRecord.multiple?`
- `PendingInputQuestionRecord.custom?`
- `AgentExecutionOutcome`
- `AgentRunStatePort.requestPendingInput`
- `PendingInputStoreGateway.loadActivePendingInput`
- `PendingInputStoreGateway.listDuePendingInputs`
- `PendingInputStoreGateway.resolvePendingInput` write-level `{ idempotencyKey, idempotencySemantic }`

实现约束：

- `multiple` 和 `custom` 只能来自 accepted pending request，不能来自 client answer payload。
- `loadActivePendingInput` 只返回 owner+agent+session scope 下仍为 `PENDING` 的 durable fact，gateway 不决定 submit、answer、cancel、timeout 或 recovery 是否继续。
- `listDuePendingInputs` 只返回到期且仍为 `PENDING` 的 durable facts，必须 bounded by `limit`，并使用稳定返回顺序。
- due timeout query 的本地 adapter 支撑可以使用私有索引，但不得把 adapter-private timeout index 暴露为 `PendingInputRecord` 业务字段。
- active pending 必须在 `tenantId + subjectId + agentId + sessionId` scope 下保持最多一个 `PENDING` fact；local gateway 必须使用 adapter-private partial unique index 或等价 constraint，不得用 `ORDER BY` / `LIMIT 1` 任意选择一条；若检测到多条 active pending，必须通过既有 safe conflict normalization fail closed，且不得只记录 logs/metrics。
- resolve idempotency key 是 gateway write metadata，不进入 `PendingInput`、`PendingInputRecord` 或 client answer payload；`idempotencySemantic` 必须由 runtime 从 `pendingInputId`、target resolve status 和 validated ordered answers 计算，使用版本化确定性 tuple 编码，且不得包含 `answeredAt`、idempotency key、random/trace/audit/log/stream/gateway row/adapter-private/wall-clock fields；gateway 只做 opaque equality comparison，不解析 answer 业务语义。
- `AgentExecutionOutcome.PENDING_INPUT` 不新增 `RunStatus`，也不能用 thrown failure/control exception 表达；outcome 不得携带 reason、lifecycle stage、producerRef、toolCallId、resume hint 或其它 producer 坐标；`requestPendingInput(...)` 成功返回后 Agent/core 必须立即返回 `PENDING_INPUT`，不得继续执行后续 tool call 或 append 普通 capability result；runtime 必须在 terminal output aggregation 和 terminal commit 前停止当前 dispatch，且不得把该 run 当作 idle/completed 释放 same-session dispatch。
- `AgentRunStatePort.requestPendingInput(...)` 是 runtime-owned internal handoff，不是 public Web command、gateway store API、capability runtime context facade、answer API 或 terminal decision API。
- 实现不得创建缺少 checkpoint-before-visible、same-session lane protection 和 answer/cancel/timeout recovery path 的 visible/durable partial pending input；完整 pending lifecycle 不可用时必须 fail closed。

验收要点：

- contract tests 覆盖 text、single-select、multi-select、custom text 和非法 answer shape。
- contract tests 覆盖 `custom=true` 单选题只能提交一个总值，`custom=true` 多选题最多包含一个 custom text。
- gateway contract tests 覆盖 active pending query、due timeout query、limit、status filtering、stable ordering 和 owner+agent scope。
- gateway/source tests 覆盖 active pending scoped uniqueness，不允许多条 active pending 被静默挑选或只被 logs/metrics 记录。
- idempotency tests 覆盖 same key + same semantic 返回等价结果、same key + different semantic 返回 safe conflict。
- idempotency semantic tests 覆盖 semantic canonicalization，只允许 pendingInputId、target resolve status 和 validated ordered answers 进入 semantic，且使用版本化确定性 tuple 编码。
- runtime/core contract tests 覆盖 `AgentExecutionOutcome.PENDING_INPUT` 暂停、不产生 terminal commit/failure commit、`requestPendingInput(...)` 不等待 answer，以及 handoff 成功后立即返回 `PENDING_INPUT`。
- runtime/core contract tests 覆盖 handoff 失败沿用既有 safe failure path，不创建 pending fact、不返回 `PENDING_INPUT`、不新增第三种 `AgentExecutionOutcome`。
- runtime/core contract tests 覆盖 `PENDING_INPUT` 不进入 terminal output aggregation、不释放 same-session dispatch、不创建 partial pending lifecycle。
- architecture/source tests 断言 channel、core、model 和 capability 不直接消费 gateway pending query 或私自 resolve pending lifecycle。

并行边界：

- 不新增 Web answer route。
- 不实现 runtime pending lifecycle。
- 不定义 timeout outcome。
- 不定义 QUESTION、CONFIRMATION、AUTHORIZATION 或 HUMAN_HANDOFF 的 type-specific validation。
- 不新增 generic `PolicyPort`、`CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade、pending record producer/tool-call 字段或 capability-private wait/resume state。
- 不新增 `RunStatus`、`PendingInputStatus`、`TimelineEventType` 或独立 `agent-contracts/pending-input` subpath。
