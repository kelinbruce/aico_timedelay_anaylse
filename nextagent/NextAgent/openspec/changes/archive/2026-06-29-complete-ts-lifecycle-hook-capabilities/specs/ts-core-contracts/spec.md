## MODIFIED Requirements

### Requirement: Canonical Timeline And Stream Projection
TS 后端 MUST 在核心契约中冻结 canonical timeline 和用户可见 stream projection 的边界。TimelineEventType MUST 是 request 执行事实的 canonical vocabulary；StreamEventType MUST 是 channel 对 canonical timeline 和 runtime status 的投影。SSE 和 WebSocket MUST 共享同一 stream envelope 和 projection 语义。Web/channel stream resume MUST enter runtime through `RuntimeSessionPort.streamEvents(query: RuntimeSessionStreamEventsQuery): AsyncIterable<RunTimelineEvent>`.

#### Scenario: 事件 vocabulary 被校验
- **WHEN** contract tests 枚举 RunStatus、TimelineEventType 和 StreamEventType
- **THEN** tests MUST 验证 canonical vocabulary 中的状态和事件名称稳定
- **AND** degradation MUST NOT 作为 RunStatus value 表达，MUST 通过 timeline/stream event、result、safe error、audit event 或 observability metric 表达
- **AND** `HOOK_INVOKED` and `POLICY_APPLIED` MUST be timeline-only events and MUST NOT be part of first-release StreamEventType
- **AND** a separate `HOOK_OUTCOME_APPLIED` event MUST NOT remain in the public timeline vocabulary after this refinement
- **AND** deprecated projection name MUST NOT 出现在 public stream contract 中

### Requirement: Hook And Pending Boundary Baseline
TS 后端 MUST 在核心契约中保留 lifecycle hook 和 human interaction pending boundary 的最小形态。Hook MUST 能在 request、planning、model、capability、context compact 和 terminal stages 接入；需要用户澄清、确认、授权或人工接管时，系统 MUST 使用 runtime-owned pending input boundary。核心契约 MUST NOT 定义泛化 `PolicyPort`；risk、routing、context budget 和 model selection policy MUST 由后续具体 change 定义各自接口。

#### Scenario: Lifecycle hook stages 稳定
- **WHEN** lifecycle hook contract 暴露 runtime-owned stage vocabulary
- **THEN** stage vocabulary MUST include request accept、planning、model invoke、model result、capability invoke、capability result、context compact before/after and agent terminal boundaries
- **AND** hook contract MUST NOT create a competing stage vocabulary outside `agent-contracts/runtime`

#### Scenario: Hook definition and Agent activation are separated
- **WHEN** core contracts define lifecycle hook authoring, runtime definition and Agent activation
- **THEN** developer-facing hook implementation MUST use `LifecycleHook` / `defineLifecycleHook(...)` with canonical `hookId`、`kind`、`effects`、`supportedStages`、`failureMode`、`execute` and optional `order`、`timeoutMs`、`configSchema`、`configure`
- **AND** runtime-internal `LifecycleHookDefinition` MUST be materialized from that hook object without executable code
- **AND** `LifecycleHookDefinition` MUST NOT expose `name`、`source`、`defaultOrder`、`defaultTimeoutMs`、`defaultConfig` or `executionMode`
- **AND** Agent hook activation MUST be represented by `AgentAssembly.hooks` entries scoped by the containing assembly
- **AND** independent `AgentHookBinding` MUST NOT remain a public core contract
- **AND** hook activation MUST NOT duplicate `agentId`、`agentVersion` or `agentAssemblyRef` on each hook entry
- **AND** hook activation MUST NOT modify kind、effects、execution strategy、failureMode or hook supported boundary
- **AND** hook activation stages MUST be empty or a subset of definition supportedStages
- **AND** `CUSTOM` hooks MUST require explicit enabled activation in the accepted AgentAssembly
- **AND** `SYSTEM` hooks MUST be default-enabled for every Agent but MAY be explicitly disabled for the current Agent by `enabled=false` or `disabled=true`
- **AND** `SYSTEM` hooks MUST run before `CUSTOM` hooks for the same stage
- **AND** `SYSTEM` hooks MUST use `FAIL` failureMode
- **AND** failureMode MUST apply only to hook timeout, hook failure, missing hook handler, or invalid hook result
- **AND** hook `DENY`、`BLOCK` and `PEND` outcomes MUST be treated as normal control outcomes rather than hook failures
- **AND** hook code MUST accept stage-indexed `HookInput<S>` / `HookResult<S>` and an optional `AbortSignal` so runtime can propagate cancellation or timeout to hook code
- **AND** `defineLifecycleHook(...)` MUST preserve `supportedStages` literal types so hook `execute` receives the exact single-stage or multi-stage `HookInput` union declared by the hook

#### Scenario: Hook execution deterministic reduction
- **WHEN** multiple lifecycle hooks are registered for the same stage
- **THEN** observe-only hooks MUST run in bounded parallel and MUST NOT change request truth
- **AND** hooks whose effects include `TRANSFORM` or `CONTROL` MUST run in a stable serial impact order
- **AND** serial impact order MUST run `SYSTEM` hooks before `CUSTOM` hooks
- **AND** `SYSTEM` order MUST come from explicit framework-owned hook order
- **AND** `CUSTOM` order MUST default to Agent activation declaration order and MAY use `order.priority`、`order.before` or `order.after`
- **AND** `HookExecutionMode` MUST NOT remain a public core contract or binding override
- **AND** execution strategy MUST be derived only from `effects`

#### Scenario: Hook control outcome and pending input remain separate
- **WHEN** hook code wants to affect protected operation continuation
- **THEN** hook result MUST use canonical `outcome`
- **AND** outcome MUST be one of `PASS`、`SKIP`、`DENY`、`BLOCK` or `PEND`
- **AND** `HookDecision` and `HookResult.decision` MUST NOT remain public core contract fields
- **AND** `DENY` and `BLOCK` MUST stop the protected operation with distinguishable safe failure classification
- **AND** `PEND` MUST create a runtime-owned PendingInput only at stages that support pending input
- **AND** pending input lifecycle, answer handling and recovery MUST remain runtime-owned

#### Scenario: Hook boundary and mutation base contracts stay minimal
- **WHEN** core contracts define HookBoundary and BoundaryMutation
- **THEN** the base contracts MUST NOT include payload、patch 或 duplicated stage fields
- **AND** stage MUST remain on `HookInput` as the invocation coordinate
- **AND** `HookInput<S>` MUST use `input.stage` as the TypeScript discriminant for concrete stage boundary narrowing
- **AND** `HookInput` MUST contain runtime boundary facts and safe execution facts only
- **AND** `HookInput.config` MUST NOT remain a runtime invocation field
- **AND** concrete stage boundary and mutation schemas MUST be defined by the lifecycle hook execution change
- **AND** concrete stage mutation typing MUST be stage-indexed so unsupported stage mutations are impossible in the developer-facing type surface
- **AND** requestContextId MUST NOT be part of generic HookInput

#### Scenario: Hook invocation timeline event is observability evidence
- **WHEN** runtime invokes a lifecycle hook
- **THEN** runtime MUST emit a timeline-only `HOOK_INVOKED` with requestRunId、sessionId、requestId、agentId、agentVersion、hookId、stage、kind、effects、execution strategy、status、timing、outcome、safe reason/error and mutation summary when available
- **AND** `HookInvocationEvent` MUST NOT remain a public runtime contract or listener mechanism
- **AND** runtime MUST publish structured logs and hook metrics for invocation count、latency、timeout and failure outcomes
- **AND** `HOOK_INVOKED` MUST NOT be projected as a public user conversation stream event by default
- **AND** runtime MUST NOT provide a first-release hook invocation query API
- **AND** mutationSummary MUST include only the mutation type or stable mutation kind and changed field names, never field values or full boundary/mutation/input/result content

#### Scenario: Hook outcome is recorded in HOOK_INVOKED
- **WHEN** a hook outcome changes request lifecycle by denying, blocking, or pending for user/system input
- **THEN** runtime MUST record safe hook id、stage、outcome、safe reason and related pending/terminal refs when available in the timeline-only `HOOK_INVOKED` event
- **AND** runtime MUST NOT emit a separate `HOOK_OUTCOME_APPLIED` event for lifecycle-changing hook outcomes
- **AND** `HOOK_INVOKED` MUST remain timeline-only and MUST NOT be projected as a public user conversation stream event by default
- **AND** hook timeout or failure that does not change request lifecycle MUST remain in `HOOK_INVOKED`、structured logs、metrics or audit sink only
