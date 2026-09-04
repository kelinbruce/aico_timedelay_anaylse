## ADDED Requirements

### Requirement: Hook effects define side effects and execution strategy

系统 SHALL 在 developer-facing `LifecycleHook` interface / `defineLifecycleHook(...)` helper 返回的 hook implementation object 和 materialized runtime definition 中声明非空、去重的 hook effects 集合，用于表达 hook 对 request lifecycle 的允许副作用。支持的 hook effect MUST 包括：

- `OBSERVE`：可以产生日志、指标、trace、审计、诊断观测事实，以及有界、幂等、不影响当前流程的外部观察/通知类副作用；
- `TRANSFORM`：可以返回当前 stage 明确允许的 `BoundaryMutation`，由 runtime 校验并应用到 effective boundary；
- `CONTROL`：可以返回控制结果影响 protected operation 是否继续，支持 `DENY`、`BLOCK`，并支持 stage-limited `PEND` 语义。

同一个 hook MAY 同时声明多个 effects。runtime MUST 按 effects 集合解释 hook result，而不是把 `OBSERVE`、`TRANSFORM`、`CONTROL` 视为互斥分类。

Hook result outcome MUST use the following canonical values:

- `PASS`：hook 已执行且允许流程继续；
- `SKIP`：hook 已进入但自行判断不适用于当前 run，流程继续；
- `DENY`：治理拒绝，流程停止；
- `BLOCK`：条件不满足或执行保护阻断，流程停止；
- `PEND`：可恢复等待，流程挂起并等待 pending input。

所有 hook MAY return `PASS` or `SKIP`. `SKIP` MUST NOT include mutation or pending input intent. A mutation is legal only when the hook declares `TRANSFORM` and returns `PASS`. `DENY`, `BLOCK`, and `PEND` are legal only when the hook declares `CONTROL`; `PEND` is also limited to stages that support pending input. If a hook declares both `TRANSFORM` and `CONTROL`, `PASS` with legal mutation is valid, while `DENY`, `BLOCK`, or `PEND` with mutation MUST use the control result and MUST NOT apply the mutation.

hook execution strategy SHALL 由 effects 决定。Only hooks whose effects set is exactly observe-only (`OBSERVE` and no `TRANSFORM` / `CONTROL`) MUST use the parallel observation strategy. Hooks whose effects include `TRANSFORM` or `CONTROL` MUST use the serial impact strategy, even when they also declare `OBSERVE`. 配置或 binding MUST NOT add, remove, or override effects, MUST NOT 将 observe-only hook 提升为可修改或可阻断主流程的 hook，也 MUST NOT 将包含 `TRANSFORM` / `CONTROL` 的 hook 放入并行观察组。

#### Scenario: Observe-only hook cannot control the request

- **WHEN** 一个 observe-only hook 返回 `DENY`、`BLOCK`、`PEND` 或任何 mutation
- **THEN** runtime MUST 记录该返回为 ignored control output
- **AND** 主流程 truth MUST 不受该返回影响
- **AND** 后续串行影响型 hook 和 protected operation MUST 继续按原 effective boundary 执行

#### Scenario: Transform hook is serialized before downstream consumption

- **WHEN** 一个 `TRANSFORM` hook 在支持 mutation 的 stage 返回合法 mutation
- **THEN** runtime executor MUST 在进入后续影响型 hook 或 protected operation 前把 mutation 归约进 effective boundary
- **AND** 后续影响型 hook MUST 看到更新后的 effective boundary

#### Scenario: Transform and control can coexist in one hook

- **WHEN** 一个同时声明 `TRANSFORM` 和 `CONTROL` 的 hook 返回 `PASS` 和合法 mutation
- **THEN** runtime executor MUST reduce the mutation into the effective boundary
- **WHEN** 同一个 hook 返回 `DENY`、`BLOCK` 或 `PEND` 且同时携带 mutation
- **THEN** runtime MUST apply the control result
- **AND** runtime MUST NOT apply the mutation
- **AND** runtime MUST record a safe diagnostic for ignored mutation

#### Scenario: Skip means the entered hook is not applicable

- **WHEN** 一个 hook 返回 `SKIP`
- **THEN** runtime MUST record that the hook was invoked and self-declared not applicable
- **AND** 主流程 MUST 继续
- **AND** no mutation, pending input, or lifecycle-changing evidence MUST be applied for that hook

#### Scenario: Hook with control effect can stop protected operation

- **WHEN** 一个声明 `CONTROL` effect 的 hook 返回 `DENY` 或 `BLOCK`
- **THEN** runtime MUST 停止后续影响型 hook
- **AND** protected operation MUST NOT be started or consumed after the control result

### Requirement: Developer-facing hook contracts use canonical fields

系统 SHALL expose a canonical developer-facing hook contract before execution. Startup composition, Agent assembly compilation and runtime validation MUST fail closed when hook definitions, Agent hook activation facts, hook results, effects, stage mutations, or outcomes cannot be interpreted safely by the canonical contract.

The canonical developer-facing contract MUST include:

| Contract surface | Canonical field or value |
|---|---|
| executable function | `execute` |
| side-effect permissions | non-empty unique `effects` using `OBSERVE` / `TRANSFORM` / `CONTROL` |
| result control | `outcome` using `PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND` |
| execution strategy | derived from `effects` only |
| mutation | current-stage `BoundaryMutation` closed union |

Inputs that cannot be safely interpreted as a non-empty `OBSERVE` / `TRANSFORM` / `CONTROL` effects set, as a stage mutation owner, or as a canonical outcome MUST fail closed. Developer-visible input restrictions MUST be justified by safety, recovery, auditability, or execution-determinism benefits rather than by internal implementation convenience.

#### Scenario: Canonical result outcome is required

- **WHEN** a hook result needs to influence lifecycle continuation
- **THEN** the result MUST use canonical `outcome`
- **AND** runtime MUST interpret only `PASS`、`SKIP`、`DENY`、`BLOCK` 或 `PEND` as lifecycle hook outcomes

#### Scenario: Unsupported input form fails closed

- **WHEN** startup hook registry input or runtime hook result uses unsupported fields or non-canonical values that cannot be safely interpreted
- **THEN** startup MUST fail closed
- **AND** runtime MUST NOT start with a silently weakened hook snapshot

#### Scenario: Execution strategy is derived from effects

- **WHEN** a hook's effects are exactly observe-only
- **THEN** runtime MUST execute it in the bounded observe group
- **WHEN** a hook's effects include `TRANSFORM` or `CONTROL`
- **THEN** runtime MUST execute it in the serial impact group

### Requirement: Observe hooks execute in bounded parallel without owning request truth

每个 lifecycle stage 的 observe-only hook SHALL 与影响型 hook 分组执行。runtime MUST 并行触发该 stage 的所有 enabled observe-only hook，并为每次 invocation 产生独立 timeline-only `HOOK_INVOKED` observability fact。observe-only hook MAY execute bounded, idempotent external observation or notification side effects, such as audit sink writes, compliance trace emission, diagnostic sampling, asynchronous analysis indexing, or cache/index updates whose result is not read by the current flow. observe-only hook 的完成顺序、失败、超时、返回值或外部观察/通知副作用结果 MUST NOT 改变 request truth、effective boundary、terminal commit、pending input、checkpoint 或 protected operation continuation。

runtime MUST 对 observe-only hook 使用有界等待。每个 observe-only hook MUST 使用 resolved `timeoutMs`；该 stage 的 observe group MUST 使用明确的 group timeout，默认不得超过该 stage 中最长 resolved hook timeout。observe group 超时后，未完成的 observe invocation MUST 记录 `TIMEOUT` 或等价安全降级事实，主流程 MUST 继续。

runtime MUST use this stage-local order: resolve the frozen snapshot, start observe-only hook invocations with the stage entry boundary, immediately execute the serial impact group, then wait for the observe-only group to settle or reach group timeout before returning from the stage. observe-only hooks MUST NOT see boundary mutations produced by the serial impact group.

HookInput for an observe-only invocation MUST include a stable idempotency key that is safe for the hook to use when writing external observation or notification side effects. The key MUST remain stable for recovery retry of the same hook and lifecycle stage occurrence, and MUST be distinct for legitimate new occurrences such as a later planning round or capability invocation. `HOOK_INVOKED` MUST include the same idempotency key.

The idempotency key MUST be `stageOccurrenceKey + ":" + hookId`. `stageOccurrenceKey` MUST NOT contain prompts, model output, tool arguments or results, attachment content, credentials, filesystem paths, external side-effect payloads or external response bodies. `hookInvocationId` MAY change for each execution attempt; the idempotency key MUST remain stable for the same recoverable stage occurrence. Future per-assembly-config isolation MAY append a stable config-version coordinate.

The stage occurrence key MUST be supplied by the stage owner as a replay-stable coordinate, not as a process-local increment-only counter. `LifecycleHookInvocationCoordinates` MUST NOT carry a separate `stageOperationKey`; `stageOccurrenceKey` is the single stage occurrence coordinate. The coordinate MUST be reconstructable from checkpoint state, durable operation ids, current lifecycle truth, or the pre-acceptance submit / acceptance coordinate. The expected stage occurrence coordinates are:

| Stage | Occurrence coordinate |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | pre-acceptance submit idempotency key, channel request coordinate, or runtime acceptance attempt id that is stable for retry of the same submit and distinct for a new submit |
| `BEFORE_PLANNING` | planning step id plus round index restored from agent loop state or checkpoint |
| `BEFORE_MODEL_INVOKE` | step id, round index and model invocation ordinal, or a concrete provider invocation id assigned before provider call |
| `AFTER_MODEL_RESULT` | same model invocation coordinate plus result phase |
| `BEFORE_CAPABILITY_INVOKE` | `toolCallId` plus `invocationId`, or a replay-stable capability invocation ordinal |
| `AFTER_CAPABILITY_RESULT` | same capability invocation coordinate plus result phase |
| `BEFORE_CONTEXT_COMPACT` | compaction operation id, summary idempotency key, or context compaction idempotency coordinate plus before phase |
| `AFTER_CONTEXT_COMPACT` | same real compaction coordinate plus after phase |
| `BEFORE_AGENT_TERMINAL` | step id plus terminal attempt coordinate; a later normal-exit attempt after hook-provided tool calls MUST use a distinct coordinate |

When a stage owner cannot supply a replay-stable occurrence / operation coordinate for the current stage occurrence, runtime MUST fail closed before executing observe side-effect-capable hooks.

#### Scenario: Parallel observe timeout does not delay protected operation indefinitely

- **WHEN** 某个 stage 有多个 `OBSERVE` hook，其中一个 hook 超过 resolved timeout
- **THEN** runtime MUST 记录该 hook 的 timeout evidence
- **AND** 其他 observe hook 的成功或失败 evidence MUST 保留
- **AND** protected operation MUST NOT 因该 observe hook 无限等待

#### Scenario: Observe completion order is not observable as lifecycle truth

- **WHEN** 同一 stage 的多个 `OBSERVE` hook 以不同顺序完成
- **THEN** request lifecycle outcome MUST 与完成顺序无关
- **AND** `HOOK_INVOKED` MUST 能按 hook invocation 追溯各自状态

#### Scenario: Observe side effect uses stable idempotency without changing flow

- **WHEN** an observe-only hook writes an external observation or notification side effect
- **THEN** the hook input MUST provide a stable idempotency key for that lifecycle stage occurrence
- **AND** retrying the same stage occurrence MUST expose the same idempotency key
- **AND** a distinct stage occurrence MUST expose a distinct idempotency key
- **AND** the side effect result MUST NOT change the current protected operation, effective boundary, pending input, terminal commit, checkpoint, or runtime-owned truth

#### Scenario: Observe idempotency key is derived from replay-stable occurrence coordinates

- **WHEN** `BEFORE_PLANNING` round 2 of an accepted run is retried after recovery for the same configured hook
- **THEN** the observe idempotency key MUST be identical to the key generated before recovery
- **WHEN** the same run later enters planning round 3
- **THEN** the observe idempotency key MUST be different from round 2
- **WHEN** a different configured hook runs at the same round 2 occurrence
- **THEN** its observe idempotency key MUST be different
- **WHEN** `BEFORE_REQUEST_ACCEPT` runs before a `requestRunId` exists
- **THEN** the key MUST use the pre-acceptance submit / acceptance coordinate and still distinguish a new submit from a retry of the same submit

### Requirement: Startup composition uses hook object metadata as the semantic authority

系统 SHALL use the `LifecycleHook` implementation object created by `defineLifecycleHook(...)` as the only semantic authority for hook identity, kind, effects, supported stages, failure mode, order, timeout, config schema, startup configuration and executable behavior.

Startup hook registry input MUST be explicit `LifecycleHook` implementation objects supplied by system-owned app composition or by already-composed plugin contributions. This change MUST remove the existing hook directory product path, including `hook-directory-loader.ts`, `loadHookDirectoryForSystemConfig`, `HookDirectoryLoadResult`, `hooksRoot` as a hook source root, `configRoot/hooks` hook discovery, and hook manifest loading such as `hook.json`. This change MUST NOT define hook directory configuration, manifest-based hook loading, plugin discovery, plugin loading, plugin activation, plugin filesystem layout, remote plugin, script hook, or dynamic hook loading. Developer-authored hook contribution into the system is owned by a plugin composition change.

The hook object's `supportedStages` and AgentAssembly activation stage narrowing MUST support the stable runtime contract's full lifecycle stage vocabulary:

- `BEFORE_REQUEST_ACCEPT`
- `BEFORE_PLANNING`
- `BEFORE_MODEL_INVOKE`
- `AFTER_MODEL_RESULT`
- `BEFORE_CAPABILITY_INVOKE`
- `AFTER_CAPABILITY_RESULT`
- `BEFORE_CONTEXT_COMPACT`
- `AFTER_CONTEXT_COMPACT`
- `BEFORE_AGENT_TERMINAL`

Startup composition MUST fail closed when a hook object declares an unknown stage, omits required hook effects, declares invalid effects, declares duplicate `hookId`, declares a `SYSTEM` hook whose failure mode is not `FAIL`, declares a `SYSTEM` hook without explicit `order.priority`, or when a startup source attempts to provide manifest/path/config-driven hook semantics.

#### Scenario: Context compact hooks can be declared in the hook object

- **WHEN** startup composition receives a `LifecycleHook` object whose `supportedStages` include `BEFORE_CONTEXT_COMPACT` or `AFTER_CONTEXT_COMPACT`
- **THEN** app startup MUST accept the hook object when all other fields are valid
- **AND** runtime MUST invoke the hook when the request reaches that stage

#### Scenario: System hook with continue failure mode is rejected during startup

- **WHEN** a startup hook object declares `kind=SYSTEM` and `failureMode=CONTINUE`
- **THEN** app startup MUST fail closed
- **AND** runtime MUST NOT start with a weakened system hook snapshot

#### Scenario: Filesystem configuration is not a hook contribution path

- **WHEN** system configuration, filesystem files, or manifest-like input attempts to declare hook implementation semantics or Agent activation
- **THEN** app startup MUST fail closed
- **AND** hook implementation contribution MUST remain owned by startup composition inputs
- **AND** Agent hook activation MUST remain owned by `agent.yaml.hooks`

## MODIFIED Requirements

### Requirement: Lifecycle hooks execute only at runtime-owned lifecycle stages

系统 SHALL 只在 runtime-owned request lifecycle vocabulary 的固定治理边界上执行 lifecycle hook。stage vocabulary、outcome 解释、pending handoff 和 `HOOK_INVOKED` timeline evidence 由 runtime contract 统一拥有；具体 stage 的物理触发位置 MUST 由最接近真实 protected operation 的模块 owner 承担。支持的 stage MUST 精确包括：

- `BEFORE_REQUEST_ACCEPT`
- `BEFORE_PLANNING`
- `BEFORE_MODEL_INVOKE`
- `AFTER_MODEL_RESULT`
- `BEFORE_CAPABILITY_INVOKE`
- `AFTER_CAPABILITY_RESULT`
- `BEFORE_CONTEXT_COMPACT`
- `AFTER_CONTEXT_COMPACT`
- `BEFORE_AGENT_TERMINAL`

hook MUST 由主流程推进到对应 lifecycle stage 时触发，不得通过后台补采、日志回放、离线任务或独立调度器补建。`OBSERVE` hook 可以在该 stage 内并行执行，但仍属于 request lifecycle execution，不得变成独立调度器或离线观察机制。`agent-runtime` MUST NOT trigger every stage from a single outer `agent.execute()` wrapper when a narrower owner boundary exists.

Stage trigger ownership MUST follow the concrete protected operation:

- `BEFORE_REQUEST_ACCEPT` is triggered by `agent-runtime`;
- `BEFORE_PLANNING` is triggered by `agent-core` inside the agent loop before each planning-turn model call, after request/skill routing, routing constraints and current planning-turn inputs are resolved, and before context assembly or model request construction for that planning turn. Its boundary MUST include the round index, step id, effective step limits and current-run planning inputs, including request-local capability generated messages and context patch effects accumulated from previous rounds. The boundary MUST follow the common boundary immutability rule. It MUST NOT include speculative outputs from the planning turn that has not run yet;
- `BEFORE_MODEL_INVOKE` is triggered by `agent-model` for every concrete model provider invocation after `ModelInvocationRequest` is built and before provider SDK invocation;
- `AFTER_MODEL_RESULT` is triggered by `agent-model` after provider result normalization and before returning the effective result to the caller;
- `BEFORE_CAPABILITY_INVOKE` is triggered by the `agent-core` tool loop after the tool call is resolved to a capability id, descriptor, routing constraints and subagent guard, and after the concrete `CapabilityInvocationRequest` is built, but before the `CAPABILITY_BEFORE_CALL` checkpoint, `CAPABILITY_STARTED` event, and `capabilityInvocation.invoke(...)`;
- `AFTER_CAPABILITY_RESULT` is triggered by the `agent-core` tool loop after `capabilityInvocation.invoke(...)` returns a raw result and the basic `CapabilityInvocationResult` envelope validation succeeds, but before effective result validation, status-specific handling, request-local result effects, `buildModelVisibleCapabilityPayload(...)`, capability result message append, and capability completion event emission. Invocation throws and invalid result envelopes MUST use the existing safe error path and MUST NOT expose a transformable capability result boundary;
- `BEFORE_CONTEXT_COMPACT` and `AFTER_CONTEXT_COMPACT` are triggered by `agent-context-engine` at the real context compaction boundary. `BEFORE_CONTEXT_COMPACT` MUST run before summary generation consumes the effective compaction input. `AFTER_CONTEXT_COMPACT` MUST run after the summary draft is generated and validated but before `commitCompaction` persists the compaction result;
- `BEFORE_AGENT_TERMINAL` is triggered by `agent-core` after the agent loop determines the accepted run can exit normally, no model-produced tool calls remain to execute, and the final agent output is assembled, but before any final-content user-visible event is emitted and before the agent loop completes. Its effective boundary starts with empty `toolCalls`. Runtime terminal commit, cancellation, supersede, and runtime failure paths MUST NOT trigger `BEFORE_AGENT_TERMINAL` or the legacy `BEFORE_AGENT_TERMINAL` stage.

Stage trigger ownership MUST NOT invert package dependencies. `agent-runtime` MUST NOT import `agent-core`, `agent-model`, `agent-context-engine`, `agent-capability`, or other stage owner implementation packages. `agent-model` and `agent-context-engine` MAY import `agent-contracts/runtime` only for lifecycle hook stage invocation symbols: stage vocabulary, hook boundary/mutation/result types, `LifecycleHookInvocationPort` / request / result types, and the shared lifecycle hook control-interruption signal used to propagate `DENY` / `BLOCK` / `PEND` back to the runtime lifecycle boundary. They MUST NOT import `agent-runtime` implementation, and MUST NOT consume `AgentRunStatePort`, checkpoint writer/query types, timeline writer/query types, terminal commit types, runtime command/session ports, RequestRun store facts, owner override objects, agent override objects, or any runtime state mutation contract. `agent-app` composition MUST inject the `agent-runtime` hook executor implementation through `LifecycleHookInvocationPort`.

`agent-contracts/runtime` MUST define `LifecycleHookInvocationPort` as the independent cross-owner invocation contract. The port shape MUST be equivalent to `invoke(request: LifecycleHookInvocationRequest, signal?: AbortSignal): Promise<LifecycleHookInvocationResult>`. `LifecycleHookInvocationRequest` MUST contain the lifecycle stage, accepted run coordinates (`requestRunId`, `sessionId`, `requestId`, `agentId`, `agentVersion`, `agentAssemblyRef`), trusted owner scope reference, stage occurrence / operation coordinate used for hook idempotency, and the stage-safe immutable boundary. The boundary MUST be immutable to hook code by contract and MUST NOT expose owner-owned mutable object references. Implementations MAY use immutable projections, refs, summaries, structural sharing, or copy-on-write; a full deep clone of every boundary is not required. It MUST NOT carry `AgentRunStatePort`, checkpoint writers, timeline writers, terminal commit handles, runtime command/session ports, gateway stores, executable hook code, hook config, credentials, tokens, filesystem paths, or raw prompt/model/tool/attachment content outside fields explicitly allowed by the current stage boundary contract.

Stage boundary exposure and `HOOK_INVOKED` redaction are separate concerns. If a stage boundary explicitly exposes content so the hook can transform it, enabled hook code has in-memory access to that boundary content. Observability redaction MUST prevent that content from being emitted in logs, metrics, audit events, mutation summaries, diagnostics or control signals; it does not prevent the startup-composed hook implementation from reading the boundary while it executes.

`LifecycleHookInvocationResult` MUST be a discriminated stage result. A `CONTINUE` result MUST carry the effective boundary for the stage owner to consume. An `INTERRUPT` result MUST carry a shared safe lifecycle hook control-interruption signal for `DENY`, `BLOCK`, or `PEND`. For `PEND`, the runtime executor MUST create the runtime-owned pending input and durable resume coordinates before returning `INTERRUPT`. If pending input creation fails, the invocation port MUST fail closed and MUST NOT return a `PEND` interruption without pending truth.

The current `AgentRunStatePort.invokeLifecycleHook` shape is a migration baseline, not the target cross-owner contract. This change MUST remove lifecycle hook invocation from `AgentRunStatePort` public owner-facing usage, or restrict any remaining adapter to `agent-runtime` implementation internals. `agent-core`, `agent-model`, and `agent-context-engine` MUST call hooks through injected `LifecycleHookInvocationPort`, never through `AgentRunStatePort.invokeLifecycleHook`.

Stage owners that receive an interrupted result MUST stop the protected operation and propagate the shared control-interruption signal unchanged to the request lifecycle owner. They MUST NOT translate it into provider errors, model safe errors, fallback misses, context degradation, capability failures, terminal content, or owner-local business results. `agent-model` MUST keep `ModelInvocationService.complete(...)` / `stream(...)` model result contracts focused on model results; these APIs MUST NOT add a `PEND` result variant. When `BEFORE_MODEL_INVOKE` returns an interrupted result, `agent-model` MUST NOT call the provider SDK and MUST throw the shared lifecycle hook control-interruption signal unchanged. Model callers with accepted run context MUST rethrow that signal to the runtime lifecycle boundary.

Capability hook stages MUST remain owned by `agent-core` tool loop in this change. `agent-capability` MUST NOT trigger `BEFORE_CAPABILITY_INVOKE` or `AFTER_CAPABILITY_RESULT` and MUST NOT depend on `agent-contracts/runtime` for lifecycle hook execution unless a later change moves all capability invocation orchestration into a capability-owned boundary.

risk policy enforcement MUST NOT be registered as a lifecycle hook definition, Agent hook activation, or hook executor plugin. Risk policy is governed by its own OpenSpec change and MAY only reuse runtime, pending input, timeline, and observability boundaries as downstream infrastructure.

#### Scenario: Request acceptance stage invokes bound hooks in-band

- **WHEN** 请求推进到 `BEFORE_REQUEST_ACCEPT`
- **THEN** runtime MUST 在同一条主流程边界内执行该 stage 生效的 lifecycle hook
- **AND** 不依赖后台任务补执行

#### Scenario: Planning hook runs inside agent loop before planning model calls

- **WHEN** agent-core has resolved request routing, target skill routing and routing constraints for the accepted run
- **AND** agent-core has determined the current planning-turn inputs and is about to assemble context or construct the model request for a planning-turn model call
- **THEN** agent-core MUST trigger `BEFORE_PLANNING`
- **AND** the planning boundary MUST contain request-local capability effects accumulated before that planning turn, such as generated messages and context patch state from previous tool rounds
- **AND** the planning boundary MUST follow the common boundary immutability rule
- **AND** the planning boundary MUST NOT contain model output, tool calls, capability results, generated messages or context patch changes from the planning turn that has not executed yet
- **AND** the effective planning boundary returned by runtime MUST be consumed before that planning-turn model call is built
- **AND** runtime MUST NOT use the outer pre-`agent.execute()` position or the agent-model `BEFORE_MODEL_INVOKE` provider boundary as a substitute for this agent-loop planning boundary

#### Scenario: Model invoke hook runs at every model provider boundary

- **WHEN** any backend path constructs a concrete `ModelInvocationRequest`
- **AND** `agent-model` is about to call the provider SDK or equivalent provider boundary
- **THEN** `agent-model` MUST trigger `BEFORE_MODEL_INVOKE`
- **AND** the trigger MAY use the `agent-contracts/runtime` hook invocation contract but MUST NOT import `agent-runtime` implementation or runtime state mutation contracts
- **AND** the hook MUST run for model invocations from agent loop, fallback routing, context/prompt features, evaluation paths, or any other model-consuming feature that has accepted run context
- **AND** a single runtime pre-`agent.execute()` hook MUST NOT be treated as coverage for all model invocations
- **AND** runtime MUST NOT trigger `BEFORE_MODEL_INVOKE` from the outer `agent.execute()` wrapper before the agent loop starts

#### Scenario: Model invoke boundary exposes messages to enabled hook code but not observability

- **WHEN** `BEFORE_MODEL_INVOKE` runs for a concrete `ModelInvocationRequest`
- **THEN** the stage boundary MAY expose the current effective `messages` to enabled hook code because `ModelInvokeMutation.messages` replaces that field
- **AND** hook code MUST treat those messages as in-memory sensitive prompt content
- **AND** `HOOK_INVOKED`, mutation summary, control-interruption signal, logs, metrics, audit events and safe diagnostics MUST NOT include raw messages, raw prompt content, full boundary or full mutation payload
- **AND** implementation SHOULD use readonly projection, structural sharing or equivalent copy-on-write for unchanged messages and MUST detach/canonicalize only accepted replacement message lists before applying them
- **AND** the performance cost of passing large message boundaries MUST be bounded by normal model request size limits and hook timeouts

#### Scenario: Stage owners use independent lifecycle hook invocation port

- **WHEN** `agent-core`, `agent-model`, or `agent-context-engine` needs to trigger a lifecycle hook stage
- **THEN** it MUST call an injected `LifecycleHookInvocationPort`
- **AND** it MUST pass accepted run coordinates, trusted owner scope reference, stage occurrence coordinate, and the immutable stage boundary
- **AND** it MUST NOT call `AgentRunStatePort.invokeLifecycleHook`
- **AND** `agent-app` composition MUST provide the runtime executor adapter implementing `LifecycleHookInvocationPort`

#### Scenario: Context engine compaction orchestrator receives the hook invocation port through composition

- **WHEN** `agent-app` composes the default context engine
- **THEN** the context engine factory dependencies MUST include an explicit `LifecycleHookInvocationPort` or equivalent hook invocation dependency from `agent-contracts/runtime`
- **AND** `agent-app` MUST pass the runtime executor adapter through that dependency
- **AND** `agent-context-engine` MUST pass that dependency into the summary compression path through explicit assemble-context / summary-compression orchestrator options or deps
- **AND** the summary compression orchestrator MUST NOT import `agent-runtime`, read a global runtime singleton, call `AgentRunStatePort`, or rely on `default-agent` to trigger context compaction hooks

#### Scenario: Model invoke pending propagates without model owning runtime state

- **WHEN** a `CONTROL` hook at `BEFORE_MODEL_INVOKE` returns `outcome=PEND` with a valid `pendingInputIntent`
- **THEN** the runtime-owned hook executor MUST create the pending input and durable resume coordinates through runtime-owned pending input contracts
- **AND** the hook invocation port MUST return an interrupted stage result carrying the shared lifecycle hook control-interruption signal
- **AND** `agent-model` MUST NOT call the provider SDK
- **AND** `agent-model` MUST throw the shared signal unchanged rather than returning a `ModelFinalResult` or model stream item
- **AND** the model caller MUST rethrow the signal to the runtime lifecycle boundary
- **AND** runtime lifecycle handling MUST pause the run using the pending input truth already created by the executor

#### Scenario: Model result hook runs at the model provider boundary

- **WHEN** any backend path receives and normalizes a provider result for an accepted run
- **AND** `agent-model` is about to return the effective model result to its caller
- **THEN** `agent-model` MUST trigger `AFTER_MODEL_RESULT`
- **AND** the trigger MAY use the `agent-contracts/runtime` hook invocation contract but MUST NOT import `agent-runtime` implementation or runtime state mutation contracts
- **AND** raw provider result evidence MUST remain separate from the effective downstream projection
- **AND** agent-core MUST NOT be the only owner for `AFTER_MODEL_RESULT`, because model calls can be made by non-agent-loop consumers with accepted run context

#### Scenario: Context compaction stages invoke bound hooks

- **WHEN** `agent-context-engine` determines that the current context assembly must perform real compaction
- **THEN** `agent-context-engine` MUST trigger `BEFORE_CONTEXT_COMPACT` before the compaction operation consumes its effective input
- **AND** the trigger MAY use the `agent-contracts/runtime` hook invocation contract but MUST NOT import `agent-runtime` implementation or runtime state mutation contracts
- **AND** the effective `targetBudgetUnits` returned by runtime MUST be used for summary generation
- **WHEN** summary generation for that real compaction produces a validated summary draft and retained-tail decision
- **THEN** `agent-context-engine` MUST trigger `AFTER_CONTEXT_COMPACT`
- **AND** the trigger MAY use the `agent-contracts/runtime` hook invocation contract but MUST NOT import `agent-runtime` implementation or runtime state mutation contracts
- **AND** the after boundary MUST run before `commitCompaction` persists the summary message, retained tail or active context update
- **AND** a legal `ContextCompactMutation.after.content` MUST replace the effective `TraceableSummaryDraft.content`
- **AND** context-engine MUST build the persisted summary `SessionMessage` / `SessionMessageRecord` from the effective mutated draft
- **AND** `commitCompaction` MUST receive the mutated summary message while retaining the original retained-tail refs, active-context CAS coordinate, summary idempotency key, owner scope and agent scope
- **AND** the effective compaction result returned by runtime MUST be the only hook-mutated compaction result that context-engine may commit
- **AND** `default-agent` checkpoint or `CONTEXT_COMPACTED` event handling after `commitCompaction` MUST NOT be treated as a valid trigger point for `AFTER_CONTEXT_COMPACT`
- **WHEN** context assembly skips compaction, performs no-op budget checks, or continues without real compression
- **THEN** `AFTER_CONTEXT_COMPACT` MUST NOT be triggered

#### Scenario: Agent terminal hook runs before agent loop returns

- **WHEN** agent-core has determined that an accepted run can exit normally
- **AND** no model-produced tool calls remain to execute for the current agent loop turn
- **AND** agent-core has assembled the final agent output content
- **AND** agent-core has not yet emitted any final-content user-visible event
- **THEN** agent-core MUST trigger `BEFORE_AGENT_TERMINAL`
- **AND** when the effective terminal decision has no continuation `toolCalls`, any legal `finalContent` replacement MUST be reflected in the final-content event that agent-core emits
- **AND** runtime-owned run output collected from that final-content event MUST become the terminal commit input
- **AND** when a legal `AgentTerminalMutation` returns non-empty `toolCalls`, agent-core MUST NOT emit the final-content event for that attempt
- **AND** agent-core MUST execute those tool calls through the existing tool loop before continuing the next planning/model round
- **AND** hook-provided tool calls MUST still pass `BEFORE_CAPABILITY_INVOKE` and `AFTER_CAPABILITY_RESULT`
- **AND** this hook MUST NOT require changing the `Agent.execute(...)` return contract or returning an additional effective handoff object to runtime
- **AND** `DENY`, `BLOCK`, or `PEND` at this stage MUST prevent emission of the final-content event for that attempt
- **AND** runtime terminal commit, cancellation, supersede, or runtime failure terminal paths MUST NOT be treated as this hook's owner
- **AND** runtime terminal commit MUST NOT invoke the legacy `BEFORE_AGENT_TERMINAL` stage

#### Scenario: System output redaction guard protects the final client-visible content

- **GIVEN** the framework registers `system.output-redaction-guard` as a `SYSTEM` hook for `BEFORE_AGENT_TERMINAL`
- **AND** the hook declares `TRANSFORM` and `CONTROL` effects, `failureMode=FAIL`, and explicit system order
- **AND** the hook MAY provide `configSchema` and `configure(config)` for per-Agent pattern, threshold, redaction token, or block policy customization
- **AND** any Agent-provided config MUST be validated and materialized into an AgentAssembly-scoped configured executable before request execution
- **AND** runtime `HookInput` MUST NOT carry that config
- **WHEN** the terminal boundary `finalContent` contains safely redactable sensitive data such as credential-like patterns, internal IP ranges, customer identifiers, phone numbers, or internal/local paths
- **THEN** the hook MAY return `AgentTerminalMutation.finalContent` with the complete redacted final content
- **AND** agent-core MUST emit the final-content event using that effective redacted content
- **AND** `HOOK_INVOKED`, logs, metrics, audit, control signals, and diagnostics MUST NOT include the raw final content or raw findings
- **WHEN** the same hook determines that content cannot be safely redacted or indicates high-risk leakage
- **THEN** the hook MAY return `BLOCK`
- **AND** agent-core MUST NOT emit the final-content event for that attempt
- **AND** the block reason and evidence MUST be safe for observation and MUST NOT contain the sensitive content
- **AND** this final-output guard MUST NOT be implemented by substituting an `AFTER_MODEL_RESULT` hook for intermediate model outputs
- **AND** this guard MUST NOT require changing the `Agent.execute(...)` return contract

#### Scenario: Recovery resumes hook execution only at a recoverable lifecycle stage

- **WHEN** 一个请求从可恢复边界恢复，并且恢复坐标指向某个已冻结的可恢复 `nextLifecycleStage`
- **THEN** runtime MUST resume hook execution from that recoverable lifecycle stage or stage owner operation
- **AND** completed earlier stages before the recovery coordinate MUST remain represented by checkpoint / lifecycle truth rather than being replayed
- **AND** enabled hooks for the resumed stage MUST run according to the frozen hook snapshot when the protected operation for that stage has not completed
- **AND** runtime MUST use only defined recoverable lifecycle stages as recovery landing points

#### Scenario: Impact hooks are recomputed on recovery instead of replayed from cached results

- **WHEN** recovery lands before the protected operation for `BEFORE_MODEL_INVOKE` in planning round 1
- **AND** `BEFORE_PLANNING` for the same round already completed before the recovery coordinate
- **THEN** `BEFORE_PLANNING` hook results MUST be treated as already reflected in the recovered planning/model request truth
- **AND** runtime MUST execute the enabled `BEFORE_MODEL_INVOKE` hooks again before calling the provider
- **AND** runtime MUST recompute `TRANSFORM` / `CONTROL` hook results from the recovered stage boundary instead of caching and replaying their previous returned mutation or control output
- **AND** runtime MUST provide observe idempotency keys only for observe side-effect semantics, not as a runtime idempotency guarantee for `TRANSFORM` / `CONTROL` results
- **AND** hook authors SHOULD make `TRANSFORM` / `CONTROL` execution deterministic or idempotent for recovery retry, including any external configuration, policy, or customer-system reads they depend on

### Requirement: Hook definitions and Agent assembly activation remain separate and bounded

系统 SHALL 为开发者提供 `LifecycleHook` interface、`defineLifecycleHook(...)` helper、单一 hook implementation object 和现有 Agent package 配置中的 hook 启用/关闭入口，并在 startup composition 中 materialize 为 lifecycle hook code registration、runtime-internal hook definition 与 runtime-facing `AgentAssembly.hooks` 三个边界：

- `LifecycleHook` interface MUST be the public structural contract for hook implementation objects；
- `defineLifecycleHook(...)` MUST be the canonical developer authoring helper. It MUST return a `LifecycleHook` object, preserve literal hook metadata types including `supportedStages`, support config typing from `configSchema` where available, infer stage-specific `HookInput` / `HookResult` types for `execute`, and feed the same startup validation used by direct composition tests；
- developer-facing hook implementation object MUST keep hook identity, effects, supported stages, failure behavior, optional config validation, optional startup configuration, and executable body together. It MUST include `hookId`、`kind`、`effects`、`supportedStages`、`failureMode`、`execute` and MAY include `order`、`timeoutMs`、`configSchema` and `configure`；
- `hookId` MUST be the only stable public hook identity and MUST be used as the binding key, code registration key, diagnostic label and deterministic tie-breaker. The contract MUST NOT include a separate `name` field until a concrete display consumer exists；
- hook source, plugin source, raw path, physical source or local module source MUST remain app-composition-internal diagnostic facts and MUST NOT be fields on developer-facing `LifecycleHook` or runtime-internal `LifecycleHookDefinition`；
- hook `execute` MUST be a TypeScript function with the shape `(input: HookInput<SupportedStage>, signal?: AbortSignal) => HookResult<SupportedStage> | Promise<HookResult<SupportedStage>>` or an equivalent inferred shape；
- `HookInput` MUST contain only runtime boundary facts and safe execution facts. It MUST NOT contain Agent hook config or other startup assembly configuration；
- `LifecycleHookExecutable` MUST contain only canonical hook execution behavior and MUST NOT redefine hook identity, kind, effects, supported stages, failure mode or order；
- hook `configure`, when present, MUST be a startup-only function with the shape `(config: JsonObject) => LifecycleHookExecutable` or equivalent configured executable object whose `execute` has the canonical hook execute shape；
- `defineLifecycleHook(...)` MUST NOT register hooks, scan directories, read Agent config, create Agent hook activation, or materialize runtime definitions by itself；
- hook code registration 由 app composition 在启动期从 developer-facing `LifecycleHook` object 显式接入并冻结，将 `hookId` 绑定到可调用 TypeScript hook executable body；
- runtime-internal hook definition is materialized from the same developer-facing hook object by removing the executable body and keeping hook identity, supported stages, hook kind, hook effects, execution strategy, failure mode, order, timeout, and optional config validation；
- `LifecycleHookDefinition` is a runtime-internal contract and MUST include `hookId`、`kind`、`effects`、`supportedStages`、`failureMode` and MAY include `order`、`timeoutMs` and `configSchema`；
- `agent.yaml.hooks` 与 `capabilityBindings` 同级，是当前 Agent 的 hook activation authoring block；
- Agent assembly compiler MUST validate `agent.yaml.hooks` at startup and publish the accepted facts as `AgentAssembly.hooks`；
- Agent hook entry 只允许启用、禁用或收窄 `stages`、为 `CUSTOM` hook 提供 `order`、覆盖 resolved `timeoutMs`、提供 `config`，并在启动期用已校验 `config` 生成 configured executable；
- each `AgentAssembly.hooks` entry MUST include `hookId` and MAY include `enabled`、`disabled`、`stages`、`order`、`timeoutMs`、`config`；
- hook entries MUST NOT carry independent `agentId`、`agentVersion` or `agentAssemblyRef`; those scope facts come from the containing compiled `AgentAssembly`；
- Agent hook entry MUST NOT 改写 `kind`、hook effects、execution strategy、`failureMode` 或 hook 支持边界。

The developer-facing runtime contract MUST include stage-indexed boundary and mutation type maps. `HookInput<S>` MUST be a discriminated union keyed by `input.stage`, and `input.boundary` MUST have the boundary type for that exact stage. `HookResult<S>` MUST bind any legal mutation to the mutation type for that exact stage. Stages with no mutation support MUST use `never` or an equivalent impossible type for mutation in the developer-facing type surface. Multi-stage hooks MUST narrow by `switch (input.stage)` or equivalent TypeScript control flow so that each branch sees only that stage's boundary and legal mutation type. Boundary objects MUST NOT require an independent `boundary.stage` for narrowing; if an implementation includes one internally, it MUST equal `input.stage` and MUST NOT become a second stage authority.

`defineLifecycleHook(...)` MUST use literal-preserving typing for `supportedStages`. A single-stage hook declared for `BEFORE_MODEL_INVOKE` MUST have an `execute` input whose boundary exposes model invoke fields and whose legal mutation is `ModelInvokeMutation`. A hook declared for `BEFORE_PLANNING` and `BEFORE_AGENT_TERMINAL` MUST receive a two-branch union, not the full lifecycle stage union. Agent assembly stage narrowing can only reduce when the hook runs; it MUST NOT widen the developer-facing supported stage type or make unsupported stage boundary fields available.

`disabled=true` MUST be interpreted as disabled. `disabled=false` MUST NOT create an enable override by itself. If `enabled` and `disabled` are both provided and conflict, startup composition MUST fail closed.

`agent.yaml.hooks` MUST only declare when and how a registered hook code is attached to the current Agent lifecycle stage. Runtime MUST resolve effective hook execution settings as definition defaults plus entry overrides from the accepted `AgentAssembly.hooks`, and MUST NOT interpret entry `config` as a business-rule DSL or create hook outcomes / mutations from configuration without executing the registered hook code. If a hook definition provides `configSchema`, startup assembly MUST validate that hook's Agent config against the schema before publishing the assembly; otherwise startup assembly MUST only accept safe JSON object config. Validated config MUST be consumed only by startup materialization through hook `configure(config)` or equivalent closure creation. Runtime invocation MUST NOT pass config through `HookInput`.

Configured executable materialization MUST be scoped to the containing AgentAssembly. The same `hookId` MAY be configured by multiple Agent assemblies with different config; startup materialization MUST produce isolated configured executables for those assemblies, and runtime MUST select the configured executable only from the accepted run's frozen `agentAssemblyRef`. Runtime MUST NOT use a global `hookId` lookup that shares the final configured executable across Agent assemblies.

Developers MUST NOT be required to provide separate definition and executable body objects for the same hook body. Startup composition MAY expose runtime-internal `LifecycleHookDefinition` and code registration to runtime, but this split MUST be produced by startup composition rather than by duplicated developer configuration.

Startup composition MUST resolve hook definitions, code registrations, Agent hook entries, stage narrowing, system order, custom relative order targets, and per-Agent hook config before publishing the frozen hook registry and `AgentAssembly`. A `CUSTOM` hook entry whose `hookId` does not resolve to a registered hook definition and executable, an invalid stage narrowing, an invalid order target, or a config that fails `configSchema` MUST fail startup closed before request acceptance. Runtime unavailable handling applies only to already-published hook registrations that fail at invocation time after startup.

Startup composition MUST enforce a single framework-owned `maxHooksPerStage` limit when compiling each AgentAssembly. The default value SHALL be 16. `maxHooksPerStage` MUST NOT be an Agent-authored setting and MUST NOT have per-Agent or per-stage overrides. For each Agent and lifecycle stage, the effective hook count MUST include enabled `SYSTEM` hooks and enabled `CUSTOM` hooks that apply to that stage after Agent disablement and stage narrowing are resolved. Disabled hooks and hooks not effective for that stage MUST NOT count toward the limit. If any stage exceeds `maxHooksPerStage`, Agent assembly compilation MUST fail closed before publishing the assembly. Runtime MUST NOT truncate the hook list, silently disable hooks, or execute only the first N hooks.

`CUSTOM` hook MUST be Agent-scoped. A `CUSTOM` hook is effective only when the AgentAssembly identified by the accepted run's frozen `agentId`、`agentVersion` and `agentAssemblyRef` has an explicit enabled `hooks` entry for that `hookId`. For `CUSTOM` hooks, omitted entry `enabled` MUST be interpreted as enabled, and `enabled=false` MUST disable that custom entry. A `CUSTOM` hook without an enabled entry in the current accepted AgentAssembly MUST NOT execute for that run.

`SYSTEM` hook MUST be effective for every Agent by default when the run reaches one of the hook's supported stages. A `SYSTEM` hook MUST NOT require an Agent hooks entry to become effective. If `AgentAssembly.hooks` contains an entry for a `SYSTEM` hook, it MAY provide allowed overrides or explicitly disable that system hook for the current Agent by using `enabled=false` or `disabled=true`. Agent hooks entry MUST NOT change a system hook's kind, effects, execution strategy, failure mode, or supported boundary.

An Agent-disableable `SYSTEM` hook MUST NOT be the sole owner of mandatory non-bypassable security or governance invariants. Mandatory governance MUST be enforced by runtime guard, risk policy, gateway, sandbox, app composition, or another non-Agent-disableable boundary.

Runtime MUST resolve effective hooks using the accepted run's frozen `agentId`、`agentVersion`、`agentAssemblyRef` and the frozen `AgentAssembly.hooks`. Runtime MUST NOT use hook manifest activation data, plugin metadata, request body fields, client metadata, default Agent configuration, model output, capability input, or global fallback to decide whether a `CUSTOM` hook is bound to the current Agent.

Hook code MUST be TypeScript backend code composed at startup. This change MUST NOT support non-TypeScript hook runtimes, shell, remote hook code, script files, model-generated code, or runtime hot loading as lifecycle hook implementations.

TypeScript hook implementation MUST be explicitly registered by app composition during startup and frozen before request execution. Runtime MUST NOT scan directories, dynamically import files from configuration paths, load hook code from Agent package directories, or interpret plugin metadata as Agent hook activation.

Hook execution failures MUST be handled by the declared `failureMode` for hooks whose effects include `TRANSFORM` or `CONTROL`. observe-only hook timeout, throw, unavailable, or invalid result MUST be recorded as observation degradation and MUST NOT terminate the request main path.

After startup composition completes, the effective hook code registration, hook definitions, and AgentAssembly hook activation facts MUST be frozen for request execution. Runtime MUST NOT reread hook configuration, reparse `agent.yaml`, or change the effective hook set in the middle of a request.

`SYSTEM` hook MUST be framework-owned and default-enabled for every Agent. Enabled `SYSTEM` impact hooks MUST execute before enabled `CUSTOM` impact hooks for the same stage. A `SYSTEM` hook definition MUST declare explicit `order.priority`; it MAY also declare `order.before` / `order.after` targets that refer only to effective `SYSTEM` hooks in the same stage. Agent hook entries MUST NOT override a system hook's order. `SYSTEM` hook 的 `failureMode` MUST 为 `FAIL`。Startup composition and direct test composition MUST reject or fail closed on a `SYSTEM` hook definition whose failure mode is not `FAIL` or whose order is missing or invalid.

#### Scenario: Activation can narrow stages but cannot change hook kind or effects

- **WHEN** 某个 Agent 的 `agent.yaml.hooks` 对已存在的 hook definition 建立 entry
- **THEN** entry 可以收窄执行 stage、为 custom hook 提供 order、覆盖 resolved timeout 或提供 config
- **AND** 不会把 `SYSTEM` hook 改成 `CUSTOM`
- **AND** 不会添加或删除 `OBSERVE`、`TRANSFORM` 或 `CONTROL` effect

#### Scenario: Agent package compiles hooks into AgentAssembly

- **WHEN** startup assembly parses an Agent package whose `agent.yaml` contains `hooks`
- **THEN** assembly compiler MUST validate those hook activation facts before publishing the assembly
- **AND** runtime-facing `AgentAssembly` MUST contain the accepted `hooks`
- **AND** request execution MUST consume the frozen `AgentAssembly.hooks` rather than reparsing `agent.yaml`

#### Scenario: Hook body is declared through the helper as one implementation object

- **WHEN** a developer declares a lifecycle hook implementation
- **THEN** the declaration MUST use `defineLifecycleHook(...)` to produce a `LifecycleHook` object
- **AND** that object MUST contain hook identity/effects, optional startup configuration hooks, and `execute`
- **AND** startup composition MUST materialize runtime definition and code registration from that single object
- **AND** the developer MUST NOT maintain duplicate definition and executable body declarations for the same hook body

#### Scenario: Hook helper infers stage-specific input and mutation types

- **WHEN** a developer declares a hook with `supportedStages` containing only `BEFORE_MODEL_INVOKE`
- **THEN** TypeScript MUST infer `execute` input as the model invoke hook input
- **AND** `input.boundary.messages` MUST be available without casts
- **AND** a returned mutation MUST be checked as `ModelInvokeMutation`
- **AND** returning `PlanningMutation` or accessing planning-only boundary fields MUST fail TypeScript contract checks
- **WHEN** a developer declares a hook with `supportedStages` containing `BEFORE_PLANNING` and `BEFORE_AGENT_TERMINAL`
- **THEN** TypeScript MUST infer a union over exactly those two stages
- **AND** `switch (input.stage)` MUST narrow `input.boundary` and legal mutation shape to the matching stage in each branch
- **AND** boundary fields from the other seven stages MUST NOT be available in that hook type

#### Scenario: System hook can be explicitly disabled for one Agent

- **WHEN** 某个 Agent hooks entry for a `SYSTEM` hook uses `enabled=false` or `disabled=true`
- **THEN** runtime MUST NOT execute that system hook for runs accepted under that Agent
- **AND** the same system hook MUST remain default-enabled for other Agents without that disabling binding

#### Scenario: Conflicting enabled and disabled fields fail closed

- **WHEN** a hook entry declares `enabled=true` and `disabled=true`
- **THEN** Agent assembly compilation MUST fail closed
- **AND** runtime MUST NOT start with an ambiguous hook activation snapshot

#### Scenario: Custom hook is not global

- **WHEN** a `CUSTOM` hook definition exists and its code is registered
- **AND** the current accepted run's AgentAssembly has no enabled `hooks` entry for that `hookId`
- **THEN** runtime MUST NOT execute that hook for the run

#### Scenario: System hook applies without per-Agent binding

- **WHEN** a `SYSTEM` hook definition exists and its code is registered
- **AND** the current accepted run reaches a supported stage
- **AND** the current AgentAssembly has no `hooks` entry for that hook
- **THEN** runtime MUST still include that hook in the effective hook set

#### Scenario: Stage hook count above max fails closed

- **WHEN** startup assembly resolves more than `maxHooksPerStage` effective hooks for one Agent at one lifecycle stage
- **THEN** Agent assembly compilation MUST fail closed
- **AND** runtime MUST NOT start that Agent with a truncated or partially disabled hook set

#### Scenario: Hook binding follows the frozen run Agent

- **WHEN** a session or run is already accepted with a frozen `agentId`
- **THEN** runtime MUST resolve custom hook activation only from the accepted AgentAssembly identified by frozen `agentId`、`agentVersion` and `agentAssemblyRef`
- **AND** MUST NOT reselect hook activation from request body, model output, capability input, or default Agent configuration

#### Scenario: Hook entry attaches registered code but does not define processing logic

- **WHEN** an AgentAssembly hooks entry references a registered `hookId`
- **THEN** runtime MUST use hook definition defaults plus entry overrides to resolve stage, order, timeout and startup config
- **AND** runtime MUST execute the app-composed hook code for processing logic
- **AND** startup materialization MUST provide resolved config to hook `configure(config)` or equivalent closure creation before request execution
- **AND** runtime `HookInput` MUST NOT contain resolved config
- **AND** runtime MUST NOT synthesize outcome or mutation from the entry config itself

#### Scenario: Configured executable is isolated per AgentAssembly

- **WHEN** Agent A and Agent B both enable the same `hookId` with different validated config
- **THEN** startup materialization MUST create AgentAssembly-scoped configured executables
- **AND** a run accepted under Agent A MUST execute only Agent A's configured executable
- **AND** a run accepted under Agent B MUST execute only Agent B's configured executable
- **AND** runtime MUST NOT share the final configured executable only by `hookId`

#### Scenario: Missing hook registration fails before assembly publication

- **WHEN** an AgentAssembly hooks entry references a hookId whose hook definition or executable code is not registered by startup composition
- **THEN** startup assembly MUST fail closed before publishing that AgentAssembly
- **AND** request acceptance for that Agent MUST NOT begin with a weakened hook activation snapshot

#### Scenario: Hook configuration is frozen after startup

- **WHEN** app startup composition has completed
- **THEN** runtime MUST use the frozen hook registration / definition / AgentAssembly binding snapshot for request execution
- **AND** runtime MUST NOT reload hook configuration during an active request

### Requirement: Impact hooks use a stable synchronous execution order

对每个 lifecycle stage，runtime SHALL 先解析生效 hooks，再将 hook 分为 observation group 和 serial impact group。

serial impact group MUST contain all enabled hooks whose effects include `TRANSFORM` or `CONTROL` for the stage. runtime MUST execute the serial impact group in this stable order:

1. `SYSTEM` group before `CUSTOM` group；
2. `SYSTEM` group 按 framework-owned hook definition 的 explicit order 执行；
3. `CUSTOM` group 构建同 stage custom impact hook graph；
4. `CUSTOM` group 将 `order.before` / `order.after` 作为 graph constraints；
5. `CUSTOM` group stable topological sort comparator MUST be `(priority if present else declarationOrdinal, declarationOrdinal, hookId)`；lower priority value runs earlier, lower declaration ordinal means earlier in the current Agent `hooks` array；
6. 同一 comparator 仍无法区分时再按 `hookId`。

`order` MUST be an object with optional `priority`, `before`, and `after`. `priority` is the absolute order within the current hook group; lower values execute earlier. `before` and `after` each reference one hookId or a non-empty hookId array within the same hook group, same hook kind, same effect group, and effective lifecycle stage. The effect group of an impact hook is the serial impact group; the effect group of an observe-only hook is the observation group. Omitted custom `order` MUST preserve Agent declaration order because its comparator priority value is the hook's declaration ordinal. Runtime and assembly compiler MUST reject bare numeric order values, enum order slots, missing system priority, unknown order targets, cross-kind targets, cross-effect-group targets, targets that are not effective in the same lifecycle stage, cycles, and contradictory constraints.

serial impact group MUST 同步顺序执行并顺序归约。系统 MUST NOT 并行执行会修改 boundary 或影响 protected operation continuation 的 hook，也 MUST NOT 定义并行 mutation 或 control outcome 合并规则。

observation group MUST contain only enabled observe-only hooks and MUST NOT participate in mutation or control ordering. Observe-only hooks execute in bounded parallel and have no execution ordering guarantee among themselves; an observe-only hook's `order.before` / `order.after` targets MUST reference other observe-only hooks in the same stage and effect group, and MUST NOT reference impact hooks. `SYSTEM` / `CUSTOM`, declaration sequence and order constraints MAY be recorded on observe invocation evidence for diagnostics, but observe completion order MUST NOT influence request truth and observe-only hooks MUST NOT be reordered into the serial impact group based on order constraints.

#### Scenario: Relative order uses declaration order as baseline

- **WHEN** two impact hooks are effective for the same stage and neither declares `order`
- **THEN** runtime MUST execute them in their frozen declaration order
- **AND** framework-owned system hooks MUST use explicit system hook definition order
- **AND** custom hooks MUST use the current Agent `hooks` array order

#### Scenario: Relative order can place one hook before another hook

- **WHEN** hook `custom.b` declares `order.after=custom.a`
- **AND** both hooks are effective custom impact hooks for the same stage
- **THEN** runtime MUST execute `custom.a` before `custom.b`

#### Scenario: Absolute custom order can position custom hooks

- **WHEN** hook `custom.a` declares `order.priority=20`
- **AND** hook `custom.b` declares `order.priority=10`
- **AND** both hooks are effective custom impact hooks for the same stage
- **THEN** runtime MUST execute `custom.b` before `custom.a`

#### Scenario: System hook order is explicit and remains before custom hooks

- **WHEN** a `SYSTEM` impact hook and a `CUSTOM` impact hook are both effective for the same stage
- **THEN** runtime MUST execute the system hook before the custom hook
- **AND** custom hook order MUST NOT move the custom hook before the system hook

#### Scenario: Invalid relative order fails closed

- **WHEN** a hook declares an order target that is unknown, disabled, in another kind, in another effect group, not effective in the same stage, cyclic, or contradictory
- **THEN** startup assembly or hook resolution MUST fail closed before executing the affected run

#### Scenario: Cross-effect-group order target fails closed

- **WHEN** an observe-only hook declares `order.before` or `order.after` targeting an impact hook in the same stage
- **OR** an impact hook declares `order.before` or `order.after` targeting an observe-only hook in the same stage
- **THEN** startup assembly or hook resolution MUST fail closed before executing the affected run
- **AND** runtime MUST NOT silently ignore the cross-effect-group constraint

#### Scenario: Observe-only order is diagnostic only and does not affect execution

- **WHEN** two observe-only hooks are effective for the same stage and one declares `order.before` targeting the other
- **THEN** startup assembly MUST accept the order declaration for diagnostic evidence
- **AND** runtime MUST execute both hooks in bounded parallel without ordering guarantee
- **AND** observe completion order MUST NOT be influenced by the declared order
- **AND** `HOOK_INVOKED` evidence for each observe invocation MAY record the declared order constraints for diagnostics

#### Scenario: Impact hooks execute in deterministic order

- **WHEN** 某个 stage 同时存在多个包含 `TRANSFORM` 或 `CONTROL` effect 的 hook
- **THEN** runtime MUST 按固定顺序执行它们
- **AND** 不因注册顺序、执行环境差异、并行 observe hook 完成顺序或下游消费者存在与否而改变顺序

#### Scenario: System control hook stops later custom impact hooks

- **WHEN** 一个 `SYSTEM` hook 声明 `CONTROL` effect 并返回 `DENY` 或 `BLOCK`
- **THEN** runtime MUST 停止该 stage 后续 serial impact hook
- **AND** custom impact hooks for the same protected operation MUST NOT execute

#### Scenario: Later transform hook sees the effective boundary produced by prior mutation

- **WHEN** 前一个声明 `TRANSFORM` effect 的 hook 返回合法 mutation 并被 runtime executor 归约进 effective boundary
- **THEN** 后一个串行影响型 hook MUST 看到更新后的 effective boundary
- **AND** 不是 previous boundary 的快照

### Requirement: Stage-specific boundaries and mutations are minimal runtime contracts

系统 SHALL 将 stage-specific `HookBoundary` 与 `BoundaryMutation` 作为 `agent-contracts/runtime` owned contract 定义。系统 MUST NOT 新增 `agent-contracts/hook` owning surface，也 MUST NOT 将这些 boundary / mutation 归入 hook effects、channel、observability 或 gateway owning surface。

每个 stage 的 boundary MUST 只包含当前 stage 已成立的安全事实、稳定 refs、低敏 safe summary、计数、状态枚举或 policy-neutral flags。HookBoundary 是提供给 hook 的只读 stage context；boundary fields MUST be immutable to hook code by contract. TypeScript `readonly` annotations alone MUST NOT be treated as sufficient runtime immutability. Runtime and stage owners MUST NOT pass owner-owned mutable business objects, arrays, model messages, tool descriptors, capability payloads, context patches, summary drafts, or provider option objects to hooks by mutable reference.

Before invoking hooks, the stage owner or runtime executor MUST finalize the boundary with explicit per-field runtime immutability semantics. A finalized boundary field MUST use one of these implementation strategies:

- immutable projection: construct a hook-visible object / array graph that is not the owner-owned mutable object graph;
- stable ref, digest, count, or safe summary: expose only non-dereferenceable identity or aggregate facts when full content is not required;
- structural sharing: share only values that are already immutable by owner contract or have already been finalized as immutable projections, never mutable owner references;
- copy-on-write or lazy projection: defer copying for large fields while ensuring hook-visible reads cannot mutate owner state and accepted replacements are detached before apply.

Implementations MAY use `Object.freeze`, deep freeze, proxy guards, schema parse, structured clone, field-specific projection, or typed DTO constructors as implementation techniques. A full-boundary deep clone is not required. The runtime invariant is that mutating a hook-received boundary object MUST NOT change stage owner internal state, the current effective boundary, or later protected operation input, and owner-side mutation after hook invocation MUST NOT change the hook-visible boundary snapshot. BoundaryMutation 只能表达当前 stage owner 允许的 effective boundary delta，不能覆盖 boundary 中的事实字段。stage / mutation 支持范围 MUST 保持以下清单：

| Stage | Mutation support | Developer-visible transform target |
|---|---|---|
| `BEFORE_REQUEST_ACCEPT` | none | none |
| `BEFORE_PLANNING` | `PlanningMutation` | effective planning-turn input before model request construction |
| `BEFORE_MODEL_INVOKE` | `ModelInvokeMutation` | effective concrete model invocation request / safe provider options |
| `AFTER_MODEL_RESULT` | `ModelResultMutation` | effective normalized model result projection consumed downstream |
| `BEFORE_CAPABILITY_INVOKE` | `CapabilityInvokeMutation` | effective capability invocation input / safe invocation options |
| `AFTER_CAPABILITY_RESULT` | `CapabilityResultMutation` | effective `CapabilityInvocationResult` consumed by the tool loop |
| `BEFORE_CONTEXT_COMPACT` | `ContextCompactMutation.before` | effective target budget for the current compaction operation |
| `AFTER_CONTEXT_COMPACT` | `ContextCompactMutation.after` | effective compaction result before persistence |
| `BEFORE_AGENT_TERMINAL` | `AgentTerminalMutation` | effective agent-loop terminal decision: final content or continuation tool calls |

For stages whose mutation support is `none`, runtime MUST treat any returned mutation as an invalid hook result. For stages with mutation support, runtime executor MUST validate mutation kind, allowed fields and safe value constraints before reducing it into the effective boundary returned to the stage owner. Runtime MUST reject free-form mutation, generic boundary replacement, JSON Patch, expression DSL, direct DB writes, direct RequestRun state writes, direct checkpoint writes, direct terminal commit writes, direct channel projection writes, and owner-scope or agent-scope overrides from hook output.

#### Mutation Field Contracts

Stage-specific mutation contracts MUST be closed object contracts. Unknown fields MUST fail closed. String fields MUST be bounded and redacted before observation. JSON object fields MUST be safe JSON objects, MUST pass the stage owner's existing schema or invariant checks, and MUST NOT contain credentials, local paths, raw prompts, raw model/provider payloads, attachment content, or owner/agent override fields.

Runtime executor MUST provide a single generic `reduceBoundaryMutation` operation for every stage. The operation takes the current effective boundary and a validated stage mutation, then returns a new effective boundary where each mutation field fully replaces the same-named boundary field and each omitted field keeps its previous boundary value. Hooks express append, remove, filter, or suppress behavior by returning the complete replacement value for that field. Stage-specific code supplies schema, allowed-field, and field-invariant validation before this generic reduction runs. `mutationSummary` MUST include the mutation kind, replaced field names, and safe size/count/digest metadata for each replaced field; it MUST NOT include field values.

Hooks MUST treat boundary values as immutable input. To change a supported field, a hook MUST create a new replacement value in its mutation result. Runtime and stage owners MUST detach or canonicalize only accepted mutation replacement fields before applying them to effective boundary or owner-owned business objects, then validate schema, size, redaction and safety invariants. Detach/canonicalization MAY use schema parsing, structured clone, field-specific projection, or typed DTO construction; it MUST produce an owner-owned value that no longer aliases the hook-returned object graph. Fields not present in the accepted mutation MAY use structural sharing and MUST NOT be cloned solely because a hook ran. Mutating a previously returned replacement object after hook execution MUST NOT change the applied effective boundary or any owner-owned object.

Cross-stage effects of mutation MUST flow only through the owning module's normal execution chain. Runtime MUST NOT maintain a cross-stage effective-boundary cache and MUST NOT copy an earlier stage's boundary into a later stage. After a stage owner consumes the effective boundary returned by runtime, any later stage boundary MUST be reconstructed from the real owner-owned objects produced by that execution path. For example, planning mutations influence context assembly only because `agent-core` consumes the effective planning boundary before building context/model requests; model invoke mutations influence model result only because `agent-model` sends the effective model request to the provider and later normalizes the provider result.

`PlanningMutation` MUST be limited to the current `agent-core` planning-turn boundary before model request construction:

```ts
interface PlanningMutation {
  readonly kind: "planning";
  readonly flowVariables?: JsonObject;
  readonly capabilityGeneratedMessages?: readonly CapabilityGeneratedMessage[];
  readonly capabilityContextPatch?: CapabilityContextPatch;
  readonly maxRounds?: number;
  readonly maxCalls?: number;
}
```

- `flowVariables` fully replaces the current-run effective planning flow variables used by context assembly, prompt template matching and variable resolution. It MUST be a safe `JsonObject` compatible with the existing `RequestContext.flowVariables` shape and MUST NOT contain owner scope, agent scope, routing constraints, request text, attachment authority, or accepted assembly facts.
- `capabilityGeneratedMessages` fully replaces the effective `ContextAssemblyRequest.capabilityGeneratedMessages` for this planning turn. Each message MUST obey `CapabilityGeneratedMessage` bounds and role constraints.
- `capabilityContextPatch` fully replaces the effective `ContextAssemblyRequest.capabilityContextPatch` for this planning turn. It MUST pass capability/context patch validation and MUST NOT become persisted active context truth by itself.
- `maxRounds` fully replaces the current effective agent-loop model round limit for this run. It MUST be a bounded non-negative integer and MUST NOT increase beyond the framework/Agent effective maximum already in force.
- `maxCalls` fully replaces the current effective per-round capability invocation limit for this run. It MUST be a bounded non-negative integer and MUST NOT increase beyond the governed routing/tool-call maximum already in force.

`ModelInvokeMutation` MUST be limited to the current concrete `ModelInvocationRequest`:

```ts
interface ModelInvokeMutation {
  readonly kind: "model.invoke";
  readonly messages?: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDescriptor[];
  readonly commonOptions?: ModelCommonOptions;
  readonly providerOptions?: ModelProviderOptions;
  readonly timeoutMs?: number;
}
```

- `messages` fully replaces the current effective `ModelInvocationRequest.messages` for this invocation. It MUST pass model message validation and size limits. Hook authors that want to add a system instruction MUST return the complete replacement message list; raw context sources and prompt-source facts remain unchanged. The boundary value may contain complete prompt, conversation history, system instructions and assembled context. Enabled hook code can read it in memory; observability outputs and control signals MUST NOT contain it.
- `tools` fully replaces the current effective `ModelInvocationRequest.tools` for this invocation. It MUST contain only descriptors already present in the current effective request, preserving descriptor identity and schemas; an empty array means no tools are visible for this invocation.
- `commonOptions` fully replaces the current effective provider-neutral model options for this invocation. It MAY contain only `temperature`, `maxOutputTokens`, `topP`, and `thinking` values within model/profile bounds; omitted option keys in the replacement are treated as absent for the effective invocation, not merged from the previous value.
- `providerOptions` fully replaces the current effective provider options for this invocation. It MAY contain only provider-safe options already represented in `ModelProviderOptions`; it MUST NOT set provider credentials, `baseUrl`, model identity, or provider-native raw request fields.
- `timeoutMs` MUST be a bounded positive integer and MUST NOT exceed the effective model/profile timeout.
- Hooks MUST NOT mutate `providerKind`, `modelName`, `baseUrl`, `credentialRef`, `requestId`, `stepId`, `locale`, owner scope, agent scope, raw rendered prompt sources, or later unrelated model invocations.

`ModelResultMutation` MUST be limited to the downstream projection of one normalized provider result:

```ts
interface ModelResultMutation {
  readonly kind: "model.result";
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly ModelToolCall[];
}
```

- `content` fully replaces effective downstream content for the current result. Raw provider result evidence MUST remain available for audit or recovery.
- `reasoning` fully replaces effective downstream reasoning projection. Reasoning mutation MUST obey the same redaction and size limits as model output projection. An empty string means no reasoning is exposed downstream.
- `toolCalls` fully replaces the current effective downstream `ModelFinalResult.toolCalls` projection. It MAY only contain tool calls already present in the normalized provider result and MUST NOT rewrite tool names, arguments or ids. An empty array means no tool calls are visible downstream.
- Hooks MUST NOT mutate `finishReason`, `usage`, `providerResponseId`, `providerModelId`, `safeError`, owner scope, agent scope, or raw provider evidence.

`CapabilityInvokeMutation` MUST be limited to the current `agent-core` capability invocation request:

```ts
interface CapabilityInvokeMutation {
  readonly kind: "capability.invoke";
  readonly arguments?: JsonObject;
  readonly timeoutMs?: number;
}
```

- `arguments` replaces only the effective capability input arguments for the current invocation. The replacement MUST validate against the resolved capability descriptor input schema and MUST NOT contain owner/agent scope overrides, credentials, local paths, or hidden runtime coordinates.
- `timeoutMs` MUST be a bounded positive integer and MUST NOT exceed the framework/capability effective timeout.
- Hooks MUST NOT mutate `invocationId`, `capabilityId`, `toolCallId`, `sessionId`, `requestId`, `runId`, `requestContextId`, `stepId`, `identityContext`, `agentId`, `agentVersion`, `idempotencyKey`, capability authorization facts, or capability identity.

`CapabilityResultMutation` MUST be limited to mutable fields on the effective `CapabilityInvocationResult` consumed by the `agent-core` tool loop:

```ts
interface CapabilityResultMutation {
  readonly kind: "capability.result";
  readonly structuredPayload?: JsonObject;
  readonly generatedMessages?: readonly CapabilityGeneratedMessage[];
  readonly contextPatch?: CapabilityContextPatch;
}
```

- `structuredPayload` fully replaces the effective `CapabilityInvocationResult.structuredPayload` used to build the model-visible capability result message and downstream projection. It MUST remain within capability result size limits and redaction constraints. Raw capability result evidence remains available for audit or recovery.
- `generatedMessages` fully replaces the effective `CapabilityInvocationResult.generatedMessages` consumed by subsequent context assembly. Each message MUST obey `CapabilityGeneratedMessage` bounds and role constraints. An empty array means no generated messages are exposed downstream.
- `contextPatch` fully replaces the effective `CapabilityInvocationResult.contextPatch` consumed by subsequent context assembly. It MUST pass capability/context patch validation and MUST NOT become persisted active context truth by itself. Omission leaves the current effective context patch unchanged.
- Hooks MUST NOT mutate `status`, `safeError`, `fallbackTriggered`, `resultRef`, `artifactRefs`, durable artifacts, capability completion truth, owner scope, or agent scope.

`ContextCompactMutation.before` MUST be limited to the current context-engine compaction operation before compression executes:

```ts
interface ContextCompactBeforeMutation {
  readonly kind: "context.compact.before";
  readonly targetBudgetUnits?: number;
}
```

- `targetBudgetUnits` MAY lower or safely tune the current summary-generation target budget within the context-engine budget window; it MUST NOT make an otherwise insufficient minimum-safe context appear sufficient.
- Hooks MUST NOT mutate source message refs, covered message refs, retained tail refs, budget evidence, role evidence, active context version, owner scope, agent scope, summary idempotency key, or persistence facts.

`ContextCompactMutation.after` MUST be limited to the effective compaction result after summary draft generation and before persistence:

```ts
interface ContextCompactAfterMutation {
  readonly kind: "context.compact.after";
  readonly content?: string;
}
```

- `content` fully replaces the effective `TraceableSummaryDraft.content` / summary message `content` that context-engine will persist for this compaction operation. It MUST be bounded, safe for model-visible summary use, and validated by the same summary-content invariants as the generated draft. Hook authors that want to append missing information MUST return the complete replacement content.
- Hooks MUST NOT mutate source message refs, retained tail refs, summary message id, summary idempotency key, `ContextCompressionEvidence`, `sourceActiveContextVersion`, `targetActiveContextVersion`, active context records, checkpoint truth, terminal truth, owner scope, or agent scope.
- `ContextCompactMutation.after` MUST NOT run or apply on skipped/no-op compaction paths and MUST NOT run after `commitCompaction` has persisted the compaction result.

`AgentTerminalMutation` MUST be limited to the agent-loop terminal decision after `agent-core` determines the run can exit normally and before `agent-core` emits the final-content event:

```ts
interface AgentTerminalMutation {
  readonly kind: "agent.terminal";
  readonly finalContent?: string;
  readonly toolCalls?: readonly ModelToolCall[];
}
```

- `finalContent` fully replaces the effective final content emitted by `agent-core` for the current run. It MUST remain within model-visible output limits and terminal completeness validation. Runtime terminal commit MUST consume the runtime-owned run output produced from that effective final event.
- `toolCalls` fully replaces the effective continuation tool calls for this terminal decision. The initial effective value is an empty array because `BEFORE_AGENT_TERMINAL` runs only after model-produced tool calls are absent. A non-empty array means this attempt does not terminate: `agent-core` MUST execute those tool calls through the existing tool loop and then continue the next planning/model round. An empty array means no continuation tool calls are requested.
- `toolCalls` MUST contain only capability calls that are bound to the current Agent, allowed by the current routing constraints and subagent guard, resolvable by the current capability descriptor set, valid against capability input schemas, and within current `maxCalls` and remaining round-budget limits. It MUST NOT reference hidden, unbound, forbidden or cross-Agent capabilities, and MUST NOT carry owner/agent scope overrides, credentials, local paths or hidden runtime coordinates.
- A mutation result MUST NOT replace `finalContent` and provide non-empty `toolCalls` in the same result. Hook authors that want to prevent exit by running a business validation capability MUST return `toolCalls` without `finalContent`; hook authors that want to change the final answer MUST return `finalContent` without non-empty `toolCalls`.
- Hooks MUST NOT mutate final event type, final-event flags, `stepId`, terminal status, terminal message id, terminal commit metadata, runtime terminal commit state, terminal timeline facts, run status, cancellation/supersede/failure terminal paths, checkpoint truth, raw model evidence, raw capability evidence, owner scope, or agent scope.

#### Scenario: Unsupported stage mutation is rejected

- **WHEN** a hook at `BEFORE_REQUEST_ACCEPT` returns any mutation
- **THEN** runtime MUST treat the result as invalid for that stage
- **AND** handles it through the hook failure mode for impact hooks

#### Scenario: Model invoke mutation changes only effective request facts

- **WHEN** a hook with `TRANSFORM` effect at `BEFORE_MODEL_INVOKE` returns a legal `ModelInvokeMutation`
- **THEN** `agent-model` MUST consume the validated effective concrete model invocation request or safe provider options returned by runtime executor
- **AND** raw prompt sources, owner scope, agent scope and persisted request truth MUST NOT be overwritten by the hook
- **AND** the mutation MUST apply to the current model invocation only, not to a global model profile or later unrelated invocation

#### Scenario: Boundary contract is readonly and replacement fields are detached

- **WHEN** a hook receives a boundary containing nested arrays or objects
- **THEN** attempts to mutate that boundary object by reference MUST NOT change stage owner internal state or the effective boundary
- **AND** implementation MAY satisfy this through immutable projection, safe refs/summaries, structural sharing, freezing, or copy-on-write rather than full-boundary deep clone
- **WHEN** a hook returns a legal mutation replacement object and later mutates the same object reference after returning
- **THEN** runtime or the stage owner MUST have detached or canonicalized that accepted replacement field and validated it
- **AND** the post-return mutation MUST NOT change the applied effective boundary or owner-owned business object
- **AND** fields omitted from the mutation MUST NOT require cloning

#### Scenario: Cross-stage mutation is visible only through owner execution

- **WHEN** `BEFORE_PLANNING` returns a legal mutation that changes planning inputs used to build a model request
- **THEN** `agent-core` MUST consume the effective planning boundary before context assembly or model request construction
- **AND** the later `BEFORE_MODEL_INVOKE` boundary MUST be constructed from the resulting model request, not from a cached pre-mutation planning boundary
- **WHEN** `BEFORE_MODEL_INVOKE` returns a legal mutation that changes model request messages
- **THEN** `agent-model` MUST send the effective request to the provider
- **AND** the later `AFTER_MODEL_RESULT` boundary MUST be constructed from the normalized provider result produced by that effective request
- **AND** runtime MUST NOT provide cross-stage boundary inheritance or a global mutable boundary store

#### Scenario: Model result mutation changes only downstream projection

- **WHEN** a hook with `TRANSFORM` effect at `AFTER_MODEL_RESULT` returns a legal `ModelResultMutation`
- **THEN** `agent-model` MUST consume the validated effective model result projection returned by runtime executor before exposing it to downstream stages
- **AND** raw model result evidence MUST remain available for audit or recovery
- **AND** the mutation MUST apply at the `agent-model` provider boundary before the result is returned to the caller

#### Scenario: Capability invoke mutation changes only effective invocation input

- **WHEN** a hook with `TRANSFORM` effect at `BEFORE_CAPABILITY_INVOKE` returns a legal `CapabilityInvokeMutation`
- **THEN** `agent-core` MUST consume the validated effective capability invocation input or safe invocation options returned by runtime executor
- **AND** capability identity, owner scope, agent scope and trusted authorization facts MUST NOT be overwritten by the hook

#### Scenario: Capability result mutation preserves raw result evidence

- **WHEN** a hook with `TRANSFORM` effect at `AFTER_CAPABILITY_RESULT` changes mutable fields on the effective `CapabilityInvocationResult`
- **THEN** `agent-core` MUST consume the validated effective `CapabilityInvocationResult` returned by runtime executor
- **AND** raw capability result evidence MUST remain available for audit or recovery
- **AND** request-local result effects and downstream model-visible result consumption MUST use the validated effective result

#### Scenario: Agent terminal mutation changes final content or continues through tool calls

- **WHEN** a hook with `TRANSFORM` effect at `BEFORE_AGENT_TERMINAL` returns a legal `AgentTerminalMutation`
- **THEN** `agent-core` MUST consume the validated effective terminal decision returned by runtime executor before emitting the final-content event
- **AND** if the effective terminal decision contains non-empty `toolCalls`, agent-core MUST skip the final-content event for that attempt and continue through the existing tool loop
- **AND** raw model result evidence, raw capability evidence, checkpoint truth, runtime terminal commit fields, owner scope and agent scope MUST NOT be overwritten by the hook
- **AND** runtime cancellation, supersede or runtime failure terminal paths MUST NOT consume `AgentTerminalMutation`

#### Scenario: Context mutation changes only effective context operation facts

- **WHEN** a hook with `TRANSFORM` effect at `BEFORE_CONTEXT_COMPACT` or `AFTER_CONTEXT_COMPACT` returns a legal `ContextCompactMutation`
- **THEN** `agent-context-engine` MUST consume the validated effective context boundary returned by runtime executor
- **AND** `BEFORE_CONTEXT_COMPACT` mutation MUST only change the effective target budget for the current compaction operation
- **AND** `AFTER_CONTEXT_COMPACT` mutation MUST only change the effective summary draft `content` after summary draft generation and before compaction persistence
- **AND** raw context sources, budget evidence, active context version coordinates, owner scope, agent scope, summary ids, source/retained refs, compression evidence, checkpoint truth and terminal truth MUST NOT be overwritten by the hook
- **AND** `AFTER_CONTEXT_COMPACT` mutation MUST never apply to skipped or no-op context paths

#### Scenario: Boundary contracts stay in runtime surface

- **WHEN** implementation adds or changes stage-specific hook boundary or mutation types
- **THEN** those contracts MUST be exported from `agent-contracts/runtime`
- **AND** no `agent-contracts/hook` export surface MUST be introduced

### Requirement: Runtime executor is the only authority that interprets outcomes and reduces mutations

hook 正常返回后，runtime SHALL 只按以下固定语义处理 result：

- `PASS`：hook 已执行且允许流程继续；
- `SKIP`：hook 已进入但自行判断不适用于当前 run，流程继续；
- `DENY`：治理拒绝，停止后续影响型 hook 和主流程，并进入 policy-denied / validation-denied safe failure path；
- `BLOCK`：条件不满足或执行保护阻断，停止后续影响型 hook 和主流程，并进入 blocked / unavailable / precondition safe failure path；
- `PEND`：停止后续影响型 hook 和主流程，并创建 pending input。

`PEND` MUST be legal only at `BEFORE_MODEL_INVOKE`, `BEFORE_CAPABILITY_INVOKE`, and `BEFORE_AGENT_TERMINAL`. A `PEND` outcome at `BEFORE_REQUEST_ACCEPT`, `BEFORE_PLANNING`, `AFTER_MODEL_RESULT`, `AFTER_CAPABILITY_RESULT`, `BEFORE_CONTEXT_COMPACT`, or `AFTER_CONTEXT_COMPACT` MUST be treated as an invalid impact hook result and handled through `failureMode`. `BEFORE_PLANNING` MUST NOT support `PEND` until planning pause/resume checkpoint, answer continuation position and visible waiting state semantics are explicitly defined.

For a control outcome that stops the protected operation, the runtime hook executor MUST produce a shared lifecycle hook control-interruption signal through the hook invocation port. The signal MUST contain only safe lifecycle control metadata such as stage, hook invocation id, outcome, safe reason, and pending input reference when applicable. It MUST NOT contain raw prompt, model output, tool arguments/result, attachment content, provider raw errors, filesystem paths, credentials, tokens, full boundary, full mutation, or runtime state ports.

若 hook 返回 mutation，runtime executor MUST 先校验 mutation 是否与当前 stage boundary 和 hook effects 匹配，只有合法 mutation 才能被归约进返回给 stage owner 的 effective boundary。effective boundary MUST 由 runtime executor 产生并由 stage owner 消费，而不是由 hook 直接拥有或写入业务对象。

若 `DENY`、`BLOCK` 或 `PEND` 与 mutation 同时出现，runtime MUST 以控制信号为准，并忽略 mutation。

observe-only hook 返回 `DENY`、`BLOCK` 或 `PEND` MUST be treated as ignored invalid control output and MUST NOT be handled through failure mode. A hook without `CONTROL` effect that is not observe-only and returns `DENY`、`BLOCK` 或 `PEND` MUST be treated as an invalid result and handled through failure mode. A hook without `TRANSFORM` effect that is not observe-only and returns mutation MUST be treated as an invalid result and handled through failure mode. A hook with `TRANSFORM` effect that returns `SKIP` with mutation MUST be treated as an invalid result. A hook with both `TRANSFORM` and `CONTROL` effects that returns `DENY`、`BLOCK` 或 `PEND` with mutation MUST apply the control result and ignore the mutation.

#### Scenario: Deny wins over mutation

- **WHEN** 某个 hook 同时返回 `DENY` 和 mutation
- **THEN** runtime MUST 停止主流程并进入治理拒绝路径
- **AND** 不应用该 mutation
- **AND** `HOOK_INVOKED` evidence MUST distinguish `DENY` from `BLOCK`

#### Scenario: Block is distinct from deny

- **WHEN** 某个 hook 返回 `BLOCK`
- **THEN** runtime MUST stop the protected operation
- **AND** safe failure category / reason MUST 表达执行保护阻断而不是治理拒绝

#### Scenario: Pending input is created only from a valid pending intent

- **WHEN** 某个 hook 返回 `outcome=PEND` 且带有合法 `pendingInputIntent`
- **THEN** runtime MUST 创建真正的 pending input
- **AND** pending input MUST 可追溯到该次 hook invocation

#### Scenario: Pending is supported only at resumable before stages

- **WHEN** a hook with `CONTROL` effect returns `outcome=PEND` at `BEFORE_MODEL_INVOKE`, `BEFORE_CAPABILITY_INVOKE`, or `BEFORE_AGENT_TERMINAL` with a valid `pendingInputIntent`
- **THEN** runtime MUST create a runtime-owned pending input and pause the run at the supported stage
- **WHEN** the same hook returns `outcome=PEND` at any other lifecycle stage
- **THEN** runtime MUST treat the result as invalid for that stage
- **AND** runtime MUST handle it through the hook's `failureMode`

#### Scenario: Pending interruption is not returned as a model result

- **WHEN** `BEFORE_MODEL_INVOKE` produces a valid `PEND` interruption
- **THEN** `ModelInvocationService.complete(...)` and `stream(...)` MUST NOT return a `ModelFinalResult` or stream result variant representing pending
- **AND** the shared lifecycle hook control-interruption signal MUST propagate unchanged through model callers to the runtime lifecycle boundary
- **AND** fallback routing, model error handling, provider error mapping, and model safe-error projection MUST NOT consume that signal

#### Scenario: Planning pending remains deferred

- **WHEN** a hook at `BEFORE_PLANNING` returns `outcome=PEND`
- **THEN** runtime MUST treat the result as invalid for that stage
- **AND** runtime MUST handle it through the hook's `failureMode`
- **AND** a later change MUST define planning pause/resume semantics before enabling planning-stage pending

#### Scenario: Answered pending input resumes from the saved recoverable stage

- **WHEN** 某个 hook 触发的 pending input 后续被正式回答
- **THEN** runtime MUST 依据挂起前保存的 checkpoint 与 `nextLifecycleStage` 从最近的可恢复 lifecycle stage 恢复执行
- **AND** 不从请求起点重新接受或重放已完成的前序 lifecycle stage
- **AND** 恢复执行继续使用启动期冻结的 hook registration / definition / binding 快照

### Requirement: Observe-only hooks are observational only

observe-only hook 是唯一允许非阻塞/并行执行的 lifecycle hook。它们只能观察当前 boundary，并可产生日志、指标、trace、审计、诊断观测事实，或执行有界、幂等、不影响当前流程的外部观察/通知类副作用。它们 MUST NOT 控制流程、创建 pending input、修改 boundary、写入 runtime-owned truth，或执行会改变网络配置、工单、客户系统业务状态、订单状态、capability result truth 的业务命令。

observe-only hook 执行外部观察/通知类副作用时 MUST 使用 runtime 提供的 stable idempotency key 或等价幂等坐标。该副作用 MUST 受 hook timeout / observe group timeout 约束，副作用结果 MUST NOT 被当前 lifecycle stage 读回并影响 protected operation、effective boundary 或 terminal decision。副作用 payload、外部系统返回值和错误细节 MUST 按 hook observability redaction 规则处理。

如果 observe-only hook 返回 `DENY`、`BLOCK`、`PEND`、pending intent 或 mutation，runtime MUST 记录诊断并忽略这些控制结果。主流程 MUST 继续。

#### Scenario: Observe control outcome is ignored

- **WHEN** 一个 observe-only hook 返回 `DENY`、`BLOCK` 或 `PEND`
- **THEN** runtime MUST 记录该返回不合法的诊断
- **AND** 主流程 MUST 继续

#### Scenario: Observe mutation is ignored

- **WHEN** 一个 observe-only hook 返回 mutation
- **THEN** runtime MUST 不应用该 mutation
- **AND** 后续流程 MUST 继续基于原 effective boundary 运行

#### Scenario: Observe side-effect failure is diagnostic only

- **WHEN** an observe-only hook attempts an external audit, notification, trace, diagnostic sampling, analysis-index, or cache side effect with the runtime-provided idempotency key
- **AND** that side effect fails, times out, or returns an unsafe error
- **THEN** runtime MUST record observation degradation evidence for that hook invocation
- **AND** 主流程 MUST 继续
- **AND** no mutation, pending input, lifecycle-changing timeline evidence, terminal commit change, checkpoint change, or runtime-owned truth write MUST be applied because of that side-effect failure

### Requirement: Hook failure handling is explicit and bounded by failure mode

当包含 `TRANSFORM` 或 `CONTROL` effect 的 hook 超时、抛错、不可用或返回非法结果时，runtime SHALL 只按 `failureMode` 处理 hook 自身失败：

- `CONTINUE`：记录失败观测事实后继续主流程；
- `FAIL`：记录失败观测事实后终止主流程并进入失败路径。

`SYSTEM` hook MUST always use `FAIL`; startup and direct composition validation MUST reject a `SYSTEM` hook using any other failure mode.

当 observe-only hook 超时、抛错、不可用或返回非法结果时，runtime MUST 记录观测降级事实并继续主流程，不得使用 `failureMode` 改变主流程。系统 MUST NOT 静默吞掉 hook 失败，也 MUST NOT 无限等待 hook 完成。

#### Scenario: Continue-mode impact timeout leaves evidence and preserves flow

- **WHEN** 某个包含 `TRANSFORM` 或 `CONTROL` effect 的 hook 超时且其 `failureMode=CONTINUE`
- **THEN** runtime MUST 记录 `TIMEOUT` 观测事实
- **AND** 主流程 MUST 继续

#### Scenario: Fail-mode impact exception stops the request path

- **WHEN** 某个包含 `TRANSFORM` 或 `CONTROL` effect 的 hook 抛错且其 `failureMode=FAIL`
- **THEN** runtime MUST 记录 `FAILED` 观测事实
- **AND** 当前请求 MUST 进入失败路径

#### Scenario: Observe exception is a degradation fact only

- **WHEN** 某个 observe-only hook 抛错
- **THEN** runtime MUST 记录该 observe invocation 失败
- **AND** 当前请求 lifecycle outcome MUST 不受该失败影响

### Requirement: Every hook invocation produces a timeline-only observability fact

每次 hook invocation MUST 形成一条 timeline-only `HOOK_INVOKED` event。它至少 MUST 能追溯：

- `requestRunId`
- `sessionId`
- `requestId` (the root user message id for the run)
- `hookId`
- `agentId`
- `agentVersion`
- `stage`
- `kind`
- hook effects
- execution strategy
- invocation idempotency key
- invocation `status`
- 时间信息
- `outcome`
- `safeReason` 或 `error`
- `mutationSummary`
- ignored control output diagnostic when applicable
- safe observe side-effect diagnostic when applicable

`HOOK_INVOKED` 是 canonical timeline event，但 MUST remain timeline-only and MUST NOT be projected as a public user conversation stream event by default. Observability MUST consume hook invocation facts from timeline projection. Runtime MUST NOT expose a separate `HookInvocationEvent` contract, listener mechanism, or first-release hook invocation query API.

`mutationSummary` MUST only contain stable mutation kind, replaced field names and safe size/count/digest metadata for replaced fields. It MUST NOT contain field values, raw prompt, model output, final content, tool arguments, tool result content, attachment content, credential, token, phone number, customer identifier, filesystem path, raw provider error, full hook input, full hook result, full boundary, or full mutation payload. `mutationSummary` MUST only be produced for mutations that the runtime executor actually applies to the effective boundary; observe-only hooks returning mutation or control output that is ignored MUST NOT produce a `mutationSummary`, and the ignored output MUST be recorded only as a diagnostic code. Observe side-effect diagnostics MUST use safe status / reason codes and safe idempotency metadata only; they MUST NOT include side-effect payloads, external response bodies, external raw errors, customer data, credentials, paths, prompts, model outputs, final content, tool arguments, tool result contents, or attachment contents.

#### Scenario: Successful invocation emits a hook timeline fact

- **WHEN** 某个 hook 正常完成
- **THEN** 系统 MUST 形成一条 `HOOK_INVOKED`
- **AND** 该事件 MUST 可被日志、指标和审计从 timeline projection 消费

#### Scenario: Failed invocation still emits a hook timeline fact

- **WHEN** 某个 hook 超时、抛错或返回非法结果
- **THEN** 系统 MUST 仍形成一条 `HOOK_INVOKED`
- **AND** 其中包含安全的失败状态与诊断信息

#### Scenario: Ignored observe control output is observable

- **WHEN** 一个 observe-only hook 返回被忽略的 outcome、pending intent 或 mutation
- **THEN** `HOOK_INVOKED` MUST include a safe diagnostic code for ignored control output
- **AND** `HOOK_INVOKED` MUST NOT include a `mutationSummary` for the ignored mutation
- **AND** no canonical timeline lifecycle change MUST be emitted for that ignored output

### Requirement: Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection

`HOOK_INVOKED` timeline events already record the `outcome` field for every hook invocation, including lifecycle-changing outcomes (`DENY`, `BLOCK`, `PEND`). Consumers filter `HOOK_INVOKED` events by `outcome` to identify lifecycle-changing decisions. Runtime MUST NOT emit a separate `HOOK_OUTCOME_APPLIED` event — the `HOOK_INVOKED` event is the single source of truth for hook invocation evidence.

`HOOK_INVOKED` MUST NOT 默认映射成新的用户可见 `StreamEventType`。For `PEND`, the `USER_INPUT_REQUIRED` event carries the `pendingInputId` for downstream correlation.

#### Scenario: Deny is recorded in HOOK_INVOKED without a separate event

- **WHEN** 某个 hook 的 `DENY` 改变了请求生命周期
- **THEN** runtime 的 `HOOK_INVOKED` event 记录 `outcome: "DENY"`
- **AND** 不新增单独的 `HOOK_OUTCOME_APPLIED` event
- **AND** 不新增对应的用户可见 stream event type

#### Scenario: Block is distinguishable from deny in HOOK_INVOKED

- **WHEN** 某个 hook 的 `BLOCK` 改变了请求生命周期
- **THEN** runtime 的 `HOOK_INVOKED` event 记录 `outcome: "BLOCK"`
- **AND** `HOOK_INVOKED` evidence MUST distinguish `BLOCK` from `DENY`

#### Scenario: Pending is recorded in HOOK_INVOKED and linked by pending input

- **WHEN** 某个 hook 的 `PEND` 导致请求进入等待用户输入状态
- **THEN** runtime 的 `HOOK_INVOKED` event 记录 `outcome: "PEND"`
- **AND** runtime MUST also publish `USER_INPUT_REQUIRED` with the pending input reference
- **AND** 下游可将该 hook invocation evidence 与 pending input truth 关联

### Requirement: Hook execution must not create silent degradation or truth ambiguity

当 hook 执行、pending input 创建、mutation 应用、并行 observe 调度、观测输出或下游写出失败时，系统 MUST 显式暴露失败或降级结果。系统 MUST NOT 产生“既未继续、也未失败、也未挂起”的不一致状态。

串行影响型 hook 的控制结果、合法 mutation 和 failure mode MUST have a single runtime-owned interpretation. 并行观察 hook 的失败、超时或非法输出 MUST only create observation degradation and MUST NOT change request truth.

#### Scenario: Pending creation failure does not masquerade as successful suspension

- **WHEN** hook 返回 `PEND`，但后续 pending input 无法被正式创建
- **THEN** 系统 MUST 显式暴露该失败或降级结果
- **AND** 不把请求伪装成已成功挂起

#### Scenario: Mutation validation failure is explicit

- **WHEN** a hook with `TRANSFORM` effect returns a mutation that fails stage validation
- **THEN** runtime MUST record invalid mutation evidence
- **AND** runtime MUST handle the failure through the hook failure mode
- **AND** the invalid mutation MUST NOT partially modify the effective boundary

#### Scenario: Observability sink failure does not rewrite hook truth

- **WHEN** hook invocation 的日志、指标或审计下游写出失败
- **THEN** hook 的 lifecycle 结果 MUST 仍以 runtime 已成立的控制结果为准
- **AND** 系统留下最小可诊断证据
