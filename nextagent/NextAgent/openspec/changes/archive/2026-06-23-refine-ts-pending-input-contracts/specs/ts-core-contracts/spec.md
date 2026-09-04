## MODIFIED Requirements

### Requirement: Hook And Pending Boundary Baseline

TS 后端 MUST 在核心契约中保留 lifecycle hook 和 human interaction pending boundary 的最小形态。Hook MUST 能在 request、planning、model、capability、context compact 和 terminal stages 接入；需要用户澄清、确认、授权或人工接管时，系统 MUST 使用 runtime-owned pending input boundary。核心契约 MUST NOT 定义泛化 `PolicyPort`；risk、routing、context budget 和 model selection policy MUST 由后续具体 change 定义各自接口。

#### Scenario: Lifecycle hook stages 稳定
- **WHEN** runtime、core、context engine 或 capability 到达 request acceptance、planning、model invocation、model result、capability invocation、capability result、context compact 或 terminal event 前后的 hook point
- **THEN** 系统 MUST 使用核心契约中的 hook stage 标识和 hook input
- **AND** 未注册 hook 时 default provider MUST 表现为空执行

#### Scenario: Lifecycle hook 声明和绑定分离
- **WHEN** Agent 装配 lifecycle hook
- **THEN** hook definition MUST describe hookId、name、source、kind、supportedStages、defaultOrder、defaultTimeoutMs、executionMode、failureMode 和 defaultConfig
- **AND** Agent hook binding MUST describe bindingId、agentId、hookId、enabled、stages、order、timeoutMs 和 config
- **AND** binding MUST NOT modify kind、executionMode、failureMode、source 或 hook 支持边界
- **AND** binding stages MUST be empty or a subset of definition supportedStages
- **AND** SYSTEM hooks MUST run before CUSTOM hooks
- **AND** SYSTEM hooks MUST NOT be disabled by Agent hook binding
- **AND** SYSTEM hooks MUST use FAIL failureMode
- **AND** failureMode MUST be CONTINUE or FAIL
- **AND** failureMode MUST apply only to hook timeout, hook failure, missing hook handler, or invalid hook result
- **AND** hook REJECT and PEND decisions MUST be treated as normal control decisions rather than hook failures

#### Scenario: Hook execution deterministic reduction
- **WHEN** multiple blocking lifecycle hooks are registered for the same stage
- **THEN** runtime MUST invoke them synchronously in deterministic order by kind, then order, then hookId
- **AND** runtime MUST apply a valid mutation to the effective boundary before invoking the next blocking hook
- **AND** runtime MUST stop invoking subsequent blocking hooks when a hook returns REJECT or PEND
- **AND** runtime MUST NOT require parallel decision or mutation merge semantics in the first release
- **AND** NON_BLOCKING hooks MUST be observe-only and MUST NOT control flow or mutate boundaries

#### Scenario: Hook 只通过控制信号和边界 mutation 影响 runtime
- **WHEN** hook 被调用
- **THEN** hook input MUST include hookId、optional bindingId、agentId、agentVersion、stage、stage-specific HookBoundary 和 config
- **AND** hook result contract MUST support optional decision、pendingInputIntent、mutation、safeReason and SafeError fields
- **AND** hook observation MUST be performed by hook implementation itself and MUST NOT require runtime to execute observation from hook result
- **AND** mutation MUST match the current lifecycle stage boundary before runtime applies it
- **AND** effective boundary MUST be produced by runtime after applying a valid mutation, not returned as authoritative hook state
- **AND** missing mutation MUST be treated as no-op
- **AND** NO_OPINION and APPROVE decisions MUST allow flow to continue
- **AND** REJECT decision MUST stop the current flow and MUST include a safeReason
- **AND** PEND decision MUST stop the current flow and MUST include pendingInputIntent
- **AND** when REJECT or PEND is returned with mutation, runtime MUST ignore the mutation and honor the control decision

#### Scenario: Hook boundary and mutation base contracts stay minimal
- **WHEN** core contracts define HookBoundary and BoundaryMutation
- **THEN** the base contracts MUST NOT include payload、patch 或 duplicated stage fields
- **AND** stage MUST remain on HookInput as the invocation coordinate
- **AND** concrete stage boundary and mutation schemas MUST be defined by the lifecycle hook execution change
- **AND** requestContextId MUST NOT be part of generic HookInput

#### Scenario: Hook invocation event is observability evidence
- **WHEN** runtime invokes a lifecycle hook
- **THEN** runtime MUST emit a structured HookInvocationEvent with requestRunId、sessionId、requestId、agentId、agentVersion、hookId、optional bindingId、stage、status、timing、decision、safe reason/error and mutation summary when available
- **AND** runtime MUST publish structured logs and hook metrics for invocation count、latency、timeout and failure outcomes
- **AND** HookInvocationEvent MUST NOT be treated as a core business persistence object
- **AND** HookInvocationEvent MUST NOT be treated as a canonical timeline event
- **AND** runtime MUST NOT provide a first-release hook invocation query API
- **AND** mutationSummary MUST include only the mutation type or stable mutation kind and changed field names, never field values or full boundary/mutation/input/result content

#### Scenario: Hook decision enters timeline only when it changes lifecycle
- **WHEN** a hook decision changes request lifecycle by rejecting the flow or pending for user/system input
- **THEN** runtime MUST publish timeline-only HOOK_DECISION_APPLIED with safe hook id、optional binding id、stage、decision、safe reason and related pending/terminal refs when available
- **AND** runtime MUST NOT publish HOOK_DECISION_APPLIED for every hook invocation
- **AND** hook timeout or failure that does not change request lifecycle MUST remain in HookInvocationEvent、structured logs、metrics or audit sink only

#### Scenario: Pending input 由 runtime 拥有
- **WHEN** a lifecycle hook or a later explicitly defined upstream producer requests user input, confirmation, authorization or human handoff
- **THEN** the request MUST enter the runtime-owned pending input contract through a frozen producer boundary
- **AND** channel 只负责展示和提交 answer
- **AND** model output, client payload and capability-private state MUST NOT create or own pending lifecycle
- **AND** standalone policy logic, runtime-internal steps or capability governance MUST NOT become independent pending producers without a separate contract change
- **AND** a visible or durable partial pending input lifecycle MUST NOT be created unless the owning lifecycle also guarantees checkpoint-before-visible, same-session lane protection, and defined answer, cancel and timeout recovery paths

#### Scenario: Pending input 边界对象保持精简
- **WHEN** runtime 创建 pending input
- **THEN** 持久化对象 MUST 只保存 pendingInputId、requestRunId、sessionId、requestId、requestContextId、checkpointId、kind、questions、timeoutAt、status、createdAt、updatedAt、responseAnswers 和 runtime-owned `producerRef`
- **AND** `producerRef` MUST be limited to `{ kind: "LIFECYCLE_HOOK" }` or `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`
- **AND** `producerRef` MUST be derived from trusted runtime/core execution context and MUST NOT be supplied by model output, client payload, channel metadata, capability args, gateway records or tool input
- **AND** `producerRef` MUST NOT carry identity、owner scope、agent scope、policy、risk level、operation scope、idempotency key、timeout behavior、answer schema 或 capability-private state
- **AND** question 对象 MUST support optional `multiple`，仅表示该 question 的 answer entry 是否允许多个值，缺省 MUST 等价于 `false`
- **AND** question 对象 MUST support optional `custom`，仅表示该 question 是否允许非选项值文本，缺省 MUST 等价于 `false`
- **AND** 发给客户端的 request MUST 只包含 id、sessionId、kind、questions 和 timeoutAt
- **AND** 客户端提交的 answer MUST 只包含 sessionId、pendingInputId 和按问题顺序排列的 answers
- **AND** answers MUST 使用 string 二维数组表达，外层数组与 questions 顺序一致
- **AND** 文本题 answer entry MUST contain exactly one non-empty string
- **AND** 单选题 answer entry MUST contain exactly one string matching an allowed option unless `custom=true`
- **AND** 多选题 answer entry MAY contain multiple unique strings when the accepted question has `multiple=true`
- **AND** option question with `custom=true` MAY include at most one non-option custom text value
- **AND** single-select question with `custom=true` MUST contain exactly one total value, either one allowed option or one non-option custom text value
- **AND** multi-select question with `custom=true` MAY contain multiple unique allowed options and at most one non-option custom text value
- **AND** identity、idempotency key、audit linkage、timeout behavior、origin、run version、step id、answer schema 和 model-formatted answer MUST NOT 出现在 pending input 客户端 answer 或核心持久化对象中

#### Scenario: Pending input answer enters runtime through command boundary
- **WHEN** channel submits a pending input answer to runtime
- **THEN** runtime command MUST include trusted IdentityContext and idempotencyKey injected by the channel/auth boundary
- **AND** runtime MUST resolve the pending input to RECEIVED through the runtime-owned pending lifecycle
- **AND** channel MUST NOT provide identity or idempotency through the client answer payload

#### Scenario: Agent execution can pause for pending input
- **WHEN** Agent/core creates a pending input through a frozen runtime-owned handoff
- **THEN** `Agent.execute(...)` MUST return `AgentExecutionOutcome`
- **AND** `AgentExecutionOutcome` MUST be limited to `{ status: "COMPLETED" }` or `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }`
- **AND** `AgentExecutionOutcome.status="COMPLETED"` MUST be the only outcome that allows runtime to continue to the existing terminal commit path
- **AND** `AgentExecutionOutcome.status="PENDING_INPUT"` MUST mean a runtime-owned pending input fact has been created and the original run is paused but not terminal
- **AND** `PENDING_INPUT` MUST include the safe `PendingInputRequest` reference needed for projection
- **AND** `PENDING_INPUT` MUST NOT carry a reason, lifecycle stage, producerRef, toolCallId, resume hint or other producer coordinate
- **AND** runtime MUST NOT treat `PENDING_INPUT` as completed, failed or canceled
- **AND** `PENDING_INPUT` MUST NOT introduce a new `RunStatus`
- **AND** pending pause MUST NOT be represented by a normal thrown failure/control exception from Agent/core
- **AND** after a runtime-owned pending handoff returns successfully, Agent/core MUST immediately return `AgentExecutionOutcome.status="PENDING_INPUT"` before invoking later tool calls or appending an ordinary capability result
- **AND** runtime MUST stop the current dispatch before terminal output aggregation and terminal commit
- **AND** runtime MUST NOT treat the run as idle or completed for same-session dispatch while the pending lifecycle owns the pause
- **AND** runtime MUST NOT overwrite a same-run accepted active pending fact with completed or failed terminal facts because of the post-handoff Agent return path

#### Scenario: Capability invocation producer uses runtime-owned handoff
- **WHEN** a Capability invocation producer needs to submit a validated `PendingInputIntent`
- **THEN** Agent/core MUST call `AgentRunStatePort.requestPendingInput(run, context, intent)`
- **AND** the call MUST include the accepted `RequestRun`, trusted `RequestContext` and validated `PendingInputIntent`
- **AND** the method MUST return a safe `PendingInputRequest` on acceptance
- **AND** runtime MUST still perform final acceptance validation before the pending input becomes visible
- **AND** the method MUST NOT wait for a human answer
- **AND** the method MUST NOT return answer, terminal, resume or lifecycle-stage decisions
- **AND** the method MUST NOT expose a public Web command, gateway store API or capability-private wait/resume state
- **AND** the method MUST return `PendingInputRequest` only after acceptance succeeds
- **AND** if the owning runtime pending lifecycle is unavailable, checkpoint or pending acceptance fails, an active pending conflict exists, abort occurs, or an unexpected producer failure occurs, the method MUST fail closed through the existing runtime/capability safe failure path rather than returning `PendingInputRequest`
- **AND** a failed handoff MUST NOT create a partial pending input fact
- **AND** a failed handoff MUST NOT be converted into `AgentExecutionOutcome.status="PENDING_INPUT"`
- **AND** a failed handoff MUST NOT introduce a third `AgentExecutionOutcome` status
- **AND** ordinary `CapabilityInvocationPort.invoke(...)` failure semantics MUST continue to use existing `CapabilityInvocationResult.safeError` or producer-specific safe reason code paths

## ADDED Requirements

### Requirement: Pending input gateway fact queries

Core contracts SHALL extend `PendingInputStoreGateway` with fact queries that let runtime inspect durable pending input state without exposing adapter-private queries or lifecycle decisions to channel, core, capability or model packages.

#### Scenario: Runtime loads active pending input for a session lane
- **WHEN** runtime needs to decide whether an owner+agent-scoped session already has an active pending input
- **THEN** runtime MUST call `PendingInputStoreGateway.loadActivePendingInput`
- **AND** the request MUST include trusted `tenantId`, `subjectId`, `agentId` and `sessionId`
- **AND** the gateway MUST return at most one `PendingInputRecord` whose status is `PENDING`
- **AND** gateway implementations MUST enforce or detect the invariant that a tenant+subject+agent+session scope has at most one `PENDING` pending input
- **AND** local gateway implementations MUST use an adapter-private partial unique index or equivalent scoped constraint for active pending records
- **AND** `loadActivePendingInput` MUST NOT arbitrarily select one active row with `ORDER BY` or `LIMIT 1`
- **AND** if multiple active pending facts are detected for the same scope, runtime or gateway MUST treat it as an invariant violation and fail closed through the existing safe conflict normalization path
- **AND** multiple active pending facts MUST NOT be reported only through logs or metrics
- **AND** the gateway MUST NOT decide whether submit, answer, cancel, timeout or recovery should proceed

#### Scenario: Runtime lists pending inputs due for timeout
- **WHEN** runtime timeout or recovery code needs to find pending inputs whose timeout has elapsed
- **THEN** runtime MUST call `PendingInputStoreGateway.listDuePendingInputs`
- **AND** the request MUST include `now` and a positive bounded `limit`
- **AND** the gateway MUST return only `PendingInputRecord` facts whose status is `PENDING` and whose `timeoutAt` is less than or equal to `now`
- **AND** returned records MUST use a deterministic order by `timeoutAt` ascending and then stable pending input id ascending, or an adapter-equivalent stable order
- **AND** each returned record MUST carry tenant、subject、agent、session、run and checkpoint coordinates needed for runtime to apply scoped timeout handling
- **AND** local gateway implementations MUST back due filtering with adapter-private indexed storage, such as a private `timeout_at` column/index or equivalent index structure
- **AND** due query implementations MUST NOT rely on an unbounded JSON/full-table scan and MUST NOT expose the adapter-private timeout index as a new `PendingInputRecord` business field
- **AND** `listDuePendingInputs` MUST observe the accepted `timeoutAt` fact and MUST NOT compute, extend, shorten or otherwise decide timeout policy
- **AND** the query MUST be runtime-internal and MUST NOT be exposed through Web/channel, Agent Core, model, capability or client-facing contracts

### Requirement: Pending input resolve is idempotent

Core contracts SHALL make pending input resolve idempotent at the gateway write boundary without adding idempotency fields to the client answer payload or pending input business object.

#### Scenario: Same answer command replay returns equivalent outcome
- **WHEN** runtime resolves a pending input with a scoped `idempotencyKey` and `idempotencySemantic`
- **AND** the same owner+agent+session+pendingInput receives the same key and semantic again
- **THEN** gateway MUST return the equivalent resolved `PendingInputRecord`
- **AND** runtime MUST NOT publish a second `USER_INPUT_RECEIVED`, resume the run twice, or mutate responseAnswers a second time

#### Scenario: Runtime computes canonical answer resolve semantic
- **WHEN** runtime prepares an answer resolve command for a pending input
- **THEN** runtime MUST compute `idempotencySemantic` as a canonical string from `pendingInputId`, target resolve status and validated ordered `answers`
- **AND** the target resolve status for an accepted answer MUST be `RECEIVED`
- **AND** the canonical string MUST use a versioned deterministic array tuple encoding, such as stable JSON for `["pending-input-resolve-v1", pendingInputId, targetStatus, answers]`
- **AND** the semantic MUST preserve question order and validated answer entry order
- **AND** runtime MUST NOT reorder answers or apply trim, case-folding or other semantic normalization after answer validation
- **AND** the semantic MUST NOT include `answeredAt`, `idempotencyKey`, random ids, trace ids, audit ids, log fields, stream event ids, gateway row ids, adapter-private columns or wall-clock values
- **AND** gateway MUST treat `idempotencySemantic` as opaque write metadata used only for equality comparison within the same tenant+subject+agent+session+pendingInput scope
- **AND** gateway MUST NOT parse `idempotencySemantic`, validate answer business rules or derive lifecycle decisions from it

#### Scenario: Same idempotency key with different answer semantic conflicts
- **WHEN** runtime resolves a pending input with an `idempotencyKey` already used for a different answer semantic in the same owner+agent+session+pendingInput scope
- **THEN** gateway MUST return an idempotency conflict
- **AND** runtime MUST surface a safe conflict outcome
- **AND** the pending input fact MUST NOT be mutated by the conflicting command

#### Scenario: Different command after pending already resolved does not double-resume
- **WHEN** a second device or refreshed client submits a different answer command for a pending input that has already been resolved by another command
- **THEN** runtime MUST use the durable pending input status to reject or report the already-resolved outcome safely
- **AND** runtime MUST NOT mutate the resolved pending input back to `PENDING` or `RECEIVED`
- **AND** runtime MUST NOT resume or terminalize the owning run a second time
