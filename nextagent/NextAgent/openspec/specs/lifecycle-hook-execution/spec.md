# lifecycle-hook-execution Specification

## Purpose
Define the baseline runtime-owned lifecycle hook execution contract for the TypeScript backend, including stage ownership, startup hook objects, Agent assembly activation boundaries, outcome and mutation handling, pending integration, observability facts, and failure-mode-governed execution-error behavior.

## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Lifecycle hooks execute only at runtime-owned lifecycle stages

系统 SHALL 只在 runtime-owned request lifecycle 的固定治理边界上执行 lifecycle hook。支持的 stage MUST 精确包括：

- `BEFORE_REQUEST_ACCEPT`
- `BEFORE_PLANNING`
- `BEFORE_MODEL_INVOKE`
- `AFTER_MODEL_RESULT`
- `BEFORE_CAPABILITY_INVOKE`
- `AFTER_CAPABILITY_RESULT`
- `BEFORE_CONTEXT_COMPACT`
- `AFTER_CONTEXT_COMPACT`
- `BEFORE_AGENT_TERMINAL`

hook MUST 由主流程推进到对应 lifecycle stage 时同步触发，不得通过后台补采、日志回放、离线任务或独立调度器补建。系统 MUST NOT 从一个通用外层执行边界触发所有 stage；每个 hook 必须在对应 protected operation 实际发生时执行。

risk policy enforcement MUST NOT be registered as a lifecycle hook definition, Agent hook binding, or hook executor plugin. Risk policy is governed by its own OpenSpec change and MAY only reuse runtime, pending input, timeline, and observability boundaries as downstream infrastructure.

#### Scenario: Request acceptance stage invokes bound hooks in-band

- **WHEN** 请求推进到 `BEFORE_REQUEST_ACCEPT`
- **THEN** runtime 在同一条主流程边界内执行该 stage 生效的 lifecycle hook
- **AND** 不依赖后台任务补执行

#### Scenario: Recovery resumes hook execution only at a recoverable lifecycle stage

- **WHEN** 一个请求从可恢复边界恢复，并且恢复坐标指向某个已冻结的可恢复 `nextLifecycleStage`
- **THEN** runtime 只从该可恢复 lifecycle stage 重新接入 hook 执行
- **AND** 不跳过该 stage 的已绑定 hook
- **AND** 不把其他非恢复型 lifecycle stage 当作恢复落点

### Requirement: Hook definitions and Agent assembly activation remain separate and bounded

系统 SHALL use explicit startup-composed TypeScript `LifecycleHook` implementation objects created with `defineLifecycleHook(...)` as the semantic authority for hook identity, kind, effects, supported stages, failure mode, optional `configSchema`, optional startup-only `configure(config)`, and executable behavior.

`LifecycleHookDefinition` is the runtime-internal declaration derived from the hook object. `AgentAssembly.hooks` is the accepted Agent's activation fact and may contain only `hookId`, `enabled?`, `disabled?`, `stages?`, `order?`, `timeoutMs?`, and `config?`.

The product path MUST NOT load lifecycle hooks from hook directories, manifest files, remote URLs, scripts, runtime dynamic imports, generated code, or hot reload. Developer hook contribution into app composition is owned by a later plugin composition change.

`CUSTOM` hooks are effective only when enabled by the accepted Agent's frozen `AgentAssembly.hooks`. `SYSTEM` hooks are effective by default for every Agent and MAY be disabled for the current Agent with `enabled=false` or `disabled=true`; system kind, effects, failure mode, supported stages, and order remain framework-owned.

#### Scenario: Startup materializes hook objects into a frozen snapshot

- **WHEN** app composition has received valid lifecycle hook objects and compiled Agent assemblies
- **THEN** request execution uses only that frozen startup snapshot
- **AND** runtime does not rescan filesystem hook sources during active requests

#### Scenario: Agent activation cannot rewrite hook identity or effect authority

- **WHEN** an Agent hook entry attempts to alter kind, effects, failure mode, execution strategy, owner scope, or agent scope
- **THEN** assembly compilation fails closed

#### Scenario: Runtime does not reload hooks during an active request

- **WHEN** startup composition has completed and a request is already executing
- **THEN** runtime MUST keep using the frozen startup hook object, definition, executable, and Agent assembly activation snapshot
- **AND** external filesystem changes MUST NOT change the effective hook set for that request

### Requirement: Hook effects define execution strategy and stable ordering

Hook effects SHALL be a non-empty unique set of `OBSERVE`, `TRANSFORM`, and `CONTROL`.

Only observe-only hooks use the bounded parallel observe group. Any hook with `TRANSFORM` or `CONTROL` uses the serial impact group, even when it also declares `OBSERVE`. Runtime SHALL start observe-only hooks with the stage entry boundary, execute serial impact hooks, and wait for observe hooks to settle or time out before returning from the stage. Observe-only hooks MUST NOT see boundary mutations produced by the serial impact group. The observation group MUST NOT participate in mutation or control ordering; observe-only hooks have no execution ordering guarantee among themselves and observe completion order MUST NOT influence request truth.

Hook result outcome MUST use canonical values `PASS`, `SKIP`, `DENY`, `BLOCK`, and `PEND`. `SKIP` means the hook entered but is not applicable and MUST NOT include mutation or pending intent. A mutation is legal only when the hook declares `TRANSFORM` and returns `PASS`. `DENY`, `BLOCK`, and `PEND` are legal only when the hook declares `CONTROL`; if a hook returns a control outcome together with mutation, runtime MUST honor the control outcome and MUST NOT apply the mutation.

Serial impact hooks SHALL execute system hooks before custom hooks. System hooks use framework-owned explicit order. Custom hooks use `order.before` / `order.after` graph constraints and stable topological sorting with `(priority if present else declaration ordinal, declaration ordinal, hookId)` as the comparator.

`order` MUST be an object with optional `priority`, `before`, and `after`. `before` and `after` each reference one hookId or a non-empty hookId array within the same hook group, same hook kind, same effect group, and effective lifecycle stage. Runtime and assembly compiler MUST reject bare numeric order values, unknown order targets, cross-kind targets, cross-effect-group targets, targets that are not effective in the same lifecycle stage, cycles, and contradictory constraints. Observe-only hooks' `order.before` / `order.after` targets MUST reference other observe-only hooks in the same stage; observe-only order constraints MAY be recorded on observe invocation evidence for diagnostics but MUST NOT influence execution order or reorder observe-only hooks into the serial impact group.

#### Scenario: Observe-only hook cannot control the request

- **WHEN** an observe-only hook returns mutation, `DENY`, `BLOCK`, or `PEND`
- **THEN** runtime records ignored control diagnostics
- **AND** the request truth and protected operation continue unchanged

#### Scenario: TRANSFORM-only hook cannot return control outcomes

- **WHEN** a hook with `effects=["TRANSFORM"]` (no `CONTROL`) returns `DENY`, `BLOCK`, or `PEND`
- **THEN** runtime treats the result as invalid
- **AND** handles it through the hook failure mode

#### Scenario: CONTROL-only hook cannot return mutation

- **WHEN** a hook with `effects=["CONTROL"]` (no `TRANSFORM`) returns a mutation
- **THEN** runtime treats the result as invalid
- **AND** handles it through the hook failure mode

#### Scenario: Serial impact hooks execute in deterministic order

- **WHEN** a stage has multiple serial impact hooks
- **THEN** runtime orders system hooks first and custom hooks by their validated order graph
- **AND** execution environment differences do not change the order

#### Scenario: Later impact hook sees the effective terminal boundary produced by prior mutation

- **WHEN** 前一个 serial impact hook 在 `BEFORE_AGENT_TERMINAL` 返回合法 mutation 并被 runtime 应用
- **THEN** 后一个 serial impact hook 看到的是更新后的 effective boundary
- **AND** 不是旧 boundary 的快照

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

### Requirement: Per-stage hook count is bounded by maxHooksPerStage

Startup composition MUST enforce a single framework-owned `maxHooksPerStage` limit. The default value SHALL be 8, derived from the execution model: 4 observe-only hooks (parallel, bounded by group timeout) + 4 impact hooks (serial, each adds latency). `maxHooksPerStage` MUST NOT be an Agent-authored setting and MUST NOT have per-Agent or per-stage overrides. For each Agent and lifecycle stage, the effective hook count MUST include enabled `SYSTEM` hooks and enabled `CUSTOM` hooks after Agent disablement and stage narrowing. If any stage exceeds `maxHooksPerStage`, Agent assembly compilation MUST fail closed. Runtime MUST NOT truncate the hook list, silently disable hooks, or execute only the first N hooks.

#### Scenario: Stage hook count above max fails closed

- **WHEN** startup assembly resolves more than `maxHooksPerStage` effective hooks for one Agent at one lifecycle stage
- **THEN** Agent assembly compilation MUST fail closed
- **AND** runtime MUST NOT start that Agent with a truncated or partially disabled hook set

### Requirement: Hook inputs are stage-scoped, minimal, and authority-safe

每次通用 `LifecycleHook` 执行 SHALL 至少接收以下输入：

- `hookId`
- `agentId`
- `agentVersion`
- `agentAssemblyRef?`
- 当前 `stage`
- 与该 stage 对应的 typed `HookBoundary`
- stable safe idempotency key or digest

通用 `HookInput` MUST 只携带当前 stage 已成立且允许暴露的边界事实。通用 `HookInput` MUST NOT 混入 `RequestRun` 全对象、通用 `requestContextId` 引用、`tenantId`、`subjectId`、未经当前 stage 定义的 payload、raw prompt、raw model output、tool args/result、附件正文、secret 或 credential。

runtime MAY 为 app composition 注册的受信终末 Hook executor 提供一个不属于 `LifecycleHook`、`HookInput` 或 plugin SDK 的内部执行上下文。该上下文仅可包含当前请求的可信 Owner Scope、Agent Scope、RequestRun 坐标、已允许的 stage boundary 和 cancellation signal。runtime MUST 只在 AgentAssembly 已激活且 Hook ID 已由 app composition 注册时使用该通道；其他 Hook MUST 继续只接收通用 `HookInput`。

受信终末 Hook MUST 在同一 stage 的普通 observe/impact Hook 完成后执行；其结果生效后 MUST NOT 再执行其他 Hook。受信执行上下文及结果 MUST NOT 被转发、序列化或作为 plugin 配置、模型输入、Web API 或 capability 参数暴露。未注册、未激活或阶段不匹配的 Hook MUST NOT 获得受信上下文，也不得降级为带 Owner Scope 的普通 Hook。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 通用 Hook 仅接收阶段边界事实
- **WHEN** runtime 在任一 stage 调用通用 Hook
- **THEN** `HookInput` MUST 只包含该 stage 的 boundary facts
- **AND** 系统 MUST NOT 将完整请求运行时对象或 Owner Scope 交给通用 Hook

#### Scenario: 受信终末 Hook 在普通 Hook 后执行
- **GIVEN** AgentAssembly 激活了 app composition 注册的受信终末 Hook
- **WHEN** runtime 调用该 Hook 支持的 stage
- **THEN** runtime MUST 先完成同阶段全部普通 Hook，再通过内部上下文执行受信 Hook
- **AND** 普通或 plugin Hook MUST NOT 看到受信 Hook 的作用域或 mutation

#### Scenario: 非受信 Hook 不能请求内部作用域
- **WHEN** 未注册到受信 executor map 的 Hook 声明、配置或尝试读取 Owner Scope
- **THEN** runtime MUST 拒绝该配置或执行路径
- **AND** 系统 MUST NOT 为补齐该 Hook 输入发起跨 owner 探测

### Requirement: Pending is allowed only at explicitly supported lifecycle stages

`outcome=PEND` MUST be treated as a stage capability, not a universal hook outcome. In the first release:

- `BEFORE_MODEL_INVOKE` MAY support `PEND`
- `BEFORE_CAPABILITY_INVOKE` MAY support `PEND`
- `BEFORE_AGENT_TERMINAL` MAY support `PEND`
- all other lifecycle stages MUST treat `PEND` as an invalid hook result unless a later OpenSpec change explicitly enables it

When a stage does not support `PEND`, runtime MUST treat the returned `PEND` as invalid hook result evidence, handle it through the resolved hook failure mode, and MUST NOT create pending input truth.

#### Scenario: Unsupported stage pend is rejected through failure mode

- **WHEN** a hook at `BEFORE_REQUEST_ACCEPT` returns `outcome=PEND`
- **THEN** runtime treats the result as invalid for that stage
- **AND** does not create pending input truth
- **AND** handles the invalid result through the hook failure mode

### Requirement: Hook code execution is app-composed and bounded

系统 SHALL execute only app-composed TypeScript backend hook objects that were provided during startup composition and frozen before serving requests. Runtime, core, model, context-engine, channel, gateway, and capability packages MUST NOT scan hook directories, dynamically import hook modules, or execute Python, Java, shell, Wasm, remote, script-file, runtime-downloaded, or model-generated hook implementations as lifecycle hooks.

#### Scenario: Unsupported hook contribution path fails closed

- **WHEN** filesystem files, manifest-like input, request data, model output, or remote URLs attempt to declare lifecycle hook implementation semantics
- **THEN** app composition rejects that contribution path
- **AND** request execution continues to use only startup-composed hook objects

### Requirement: Stage-specific boundaries and mutations are minimal runtime contracts

系统 SHALL 把各 stage 的 `HookBoundary` 与 `BoundaryMutation` 定义为 `agent-contracts/runtime` contract。系统 MUST NOT 新增 `agent-contracts/hook` public surface，也 MUST NOT 从 capability、channel、observability 或 gateway contract 暴露这些 boundary 或 mutation。

首版每个 stage 的 boundary MUST 只包含当前 stage 已成立的安全事实、稳定 refs、低敏 safe summary、计数、状态枚举或 policy-neutral flags。每个 stage 的 mutation MUST 是封闭对象。目标 stage / mutation 支持范围 MUST 恰好为：

| Stage | Mutation fields |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | none |
| `BEFORE_PLANNING` | `flowVariables`, `capabilityGeneratedMessages`, `capabilityContextPatch`, `maxRounds`, `maxCalls` |
| `BEFORE_MODEL_INVOKE` | `messages`, `tools`, `temperature`, `maxOutputTokens`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `thinking`, `providerOptions`, `timeoutMs`, `maxRetries` |
| `AFTER_MODEL_RESULT` | `content`, `reasoning`, `toolCalls` |
| `BEFORE_CAPABILITY_INVOKE` | `arguments`, `timeoutMs` |
| `AFTER_CAPABILITY_RESULT` | `structuredPayload`, `generatedMessages`, `contextPatch` |
| `BEFORE_CONTEXT_COMPACT` | `targetBudgetUnits` |
| `AFTER_CONTEXT_COMPACT` | `content` |
| `BEFORE_AGENT_TERMINAL` | `finalContent`, `toolCalls` |

`BEFORE_MODEL_INVOKE` mutation fields MUST 复用 `ModelInvocationRequest` 的同名字段约束。mutation 省略任一 optional 字段时 MUST 保持 hook 前的 effective value，MUST NOT 清空该字段或由 hook 合成默认值；hook 前 request/profile 均未提供的字段 MUST 继续使用模型调用契约定义的固定默认值或缺省语义。`providerOptions` 只有在 hook 已激活且具有 model-invocation transform authority、mutation 通过 runtime stage schema 校验并随后通过 selected-provider reserved-field validation 时，MUST 才构成授权来源。该 mutation MUST NOT 修改 selected `modelId`、`invocationScope`、provider identity、endpoint、credential、header、transport、Owner Scope、Agent Scope 或 execution budget。单一 scope 的 `operationId` 与 all-or-none optional `sessionId/requestId/runId` 是 owning lifecycle 已冻结的受保护 correlation coordinates，MUST NOT 由 mutation 修改或在顶层重复。系统 MUST 对通过统一 `ModelInvocationService` 进入的每一次 concrete provider invocation 执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook；run-bound/background lifecycle MUST 由可信活跃/终态事实决定，MUST NOT 从 scope shape、operation id 格式或调用方 marker 推断。没有活跃 accepted run 的 background caller MUST NOT 为进入 hook、pending 或 timeline 而合成 coordinates。background model hook MAY `PASS`、`SKIP`、`TRANSFORM`、`DENY` 或 `BLOCK`；`PEND` 依赖活跃 run checkpoint/resume truth，因此 background `BEFORE_MODEL_INVOKE` hook 返回 `PEND` 时 MUST 在 provider execution 前安全失败，MUST NOT 创建 pending input。background model hook invocation MUST NOT 写入或合成 request-run `HOOK_INVOKED` 或 `MODEL_INVOCATION_*` timeline fact。prompt locale 由上游选择和渲染消费。显式 `null`、closed schema 未列出的字段、非法值和修改受保护字段的尝试 MUST 在 provider access 前 fail closed。

成功完成的 `AFTER_MODEL_RESULT` boundary MUST 包含 `modelE2ELatencyMs`。该字段 MUST 是非负整数毫秒，测量起点是 concrete provider invocation 开始，终点是成功 terminal result 返回。系统检测到首个非空 content delta、非空 reasoning delta、tool call delta，或成功 terminal result 中首个非空 content、非空 reasoning、至少一个 tool call 时，boundary MUST 包含 `firstContentLatencyMs`；该字段 MUST 是从同一测量起点到首个可识别反馈的非负整数毫秒。content、reasoning 和 tool call 同时出现时，最先被系统观察到的任一反馈 MUST 确定该值。成功结果没有上述任一反馈时，boundary MUST 省略 `firstContentLatencyMs`。

成功 `ModelFinalResult` 携带 `usage` 时，`AFTER_MODEL_RESULT` boundary MUST 投影同一 `usage` 对象中已提供的 `inputTokens`、`outputTokens` 和 `totalTokens`；每个已提供字段 MUST 保持原始非负安全整数值，未提供字段 MUST 保持缺失。成功结果未携带 `usage` 时，boundary MUST 省略 `usage`。系统 MUST NOT 估算、补齐或从其他 token 字段推导 usage。`modelE2ELatencyMs`、`firstContentLatencyMs` 和 `usage` 仅是 observe-only boundary facts，MUST NOT 成为 mutation fields；hook 对这些字段返回的任何修改 MUST NOT 改变模型结果。

系统交付给 hook 的 `messages`、`tools`、`thinking` 和 `providerOptions` MUST 与有效模型请求安全隔离。hook 对收到的嵌套值执行原地修改，或在返回 replacement 后继续修改同一引用，MUST NOT 改变 hook 前请求、已接受的 effective request 或 provider input。

未知 mutation 字段、owner/agent override、runtime state mutation、JSON Patch、expression DSL 和 cross-stage mutation MUST fail closed。Mutation type MUST 由 lifecycle stage 决定；runtime SHALL 在校验时推导 mutation kind。`HOOK_INVOKED.mutationSummary` MUST 只包含由 stage 推导的 mutation kind 和被替换字段名，MUST NOT 包含字段值或 provider option value。

**需求类别**：功能性需求

#### Scenario: 拒绝不受支持的 stage mutation

- **WHEN** `BEFORE_REQUEST_ACCEPT` stage 的 hook 返回任一 mutation
- **THEN** runtime MUST 把该 result 视为此 stage 的非法结果
- **AND** MUST 按 hook failure mode 处理

#### Scenario: Boundary contracts 保持在 runtime surface

- **WHEN** 系统提供 stage-specific hook boundary 或 mutation type
- **THEN** 这些 contracts MUST 从 `agent-contracts/runtime` 导出
- **AND** MUST NOT 引入 `agent-contracts/hook` export surface

#### Scenario: Model hook 应用 provider-neutral 调用字段

- **WHEN** 已激活且已授权的 `BEFORE_MODEL_INVOKE` hook 返回通过 schema 校验的 provider-neutral inference fields、timeout 或 max retries
- **THEN** runtime MUST 只把这些字段应用到 effective model invocation boundary
- **AND** model invocation MUST 继续执行 selected profile defaults、runtime budget、cancellation 和 provider capability validation

#### Scenario: Model hook 省略可选调用字段

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 省略一个或多个 optional model invocation fields
- **THEN** runtime MUST 保持这些字段的 hook 前 effective value
- **AND** hook MUST NOT 清空字段、合成默认值或改变模型调用契约的后续缺省解析

#### Scenario: Model hook 提供 selected-provider options

- **WHEN** 已激活且已授权的 `BEFORE_MODEL_INVOKE` hook 返回通过 schema 校验的 inner `providerOptions`
- **THEN** runtime MUST 把该值传给 effective provider-options merge 和 selected-provider validation
- **AND** raw option values MUST NOT 进入 `mutationSummary`、error、log、metric、trace、audit 或用户可见输出

#### Scenario: Model hook mutation 遵守封闭 schema

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 包含该 stage contract 未列出的字段
- **THEN** runtime MUST 将其作为未知字段拒绝
- **AND** effective model invocation MUST 保持不变

#### Scenario: Model hook 原地修改嵌套 boundary

- **WHEN** hook 尝试原地修改 received `messages`、tool descriptor、`thinking` 或 `providerOptions` 的嵌套数组或对象，且未返回对应 replacement mutation
- **THEN** owner request、effective request 和 provider input MUST 保持不变
- **AND** 未替换字段 MUST NOT 仅因为 hook 运行而要求全量 deep clone

#### Scenario: Hook 返回 replacement 后继续修改原引用

- **WHEN** hook 返回合法 replacement mutation，runtime 接受该 mutation 后 hook code 继续修改同一 replacement object reference
- **THEN** 已应用的 effective model request MUST 保持不变
- **AND** provider input MUST 保持已接受 mutation 时的值

#### Scenario: Model hook 尝试修改受保护 authority

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 包含 model identity、lifecycle scope、provider access、transport、Owner/Agent Scope 或 execution-budget authority
- **THEN** runtime MUST 在 provider access 前拒绝该 mutation
- **AND** selected model、scope 和 provider access MUST 保持不变

#### Scenario: Background 模型调用执行同一 model hook

- **WHEN** recommendation、memory extraction 或其他没有活跃 accepted run 的受治理 background caller 通过统一 `ModelInvocationService` 调用模型
- **THEN** 系统 MUST 执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook
- **AND** 合法 mutation MUST 按与 run-bound invocation 相同的模型字段规则生效
- **AND** runtime MUST NOT 创建或合成 request-run `HOOK_INVOKED` 或 `MODEL_INVOCATION_*` timeline fact

#### Scenario: Background model hook 请求 pending

- **WHEN** background `BEFORE_MODEL_INVOKE` hook 返回 `PEND`
- **THEN** provider execution MUST NOT 启动
- **AND** runtime MUST NOT 创建 pending input、checkpoint、synthetic run coordinates 或 request-run timeline fact
- **AND** background owner MUST 收到安全失败

#### Scenario: 流式调用以首个模型反馈计时

- **WHEN** 成功流式模型调用首次返回非空 content delta、非空 reasoning delta 或 tool call delta 中的任一反馈
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 包含从 provider invocation 开始到该反馈的 `firstContentLatencyMs`
- **AND** boundary MUST 包含从 provider invocation 开始到成功 terminal result 的 `modelE2ELatencyMs`

#### Scenario: 非流式结果以 terminal tool call 计时

- **WHEN** 成功非流式模型调用的 terminal result 没有非空 content 和 reasoning，但包含至少一个 tool call
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 包含以该 terminal result 为首次反馈的 `firstContentLatencyMs`
- **AND** `modelE2ELatencyMs` MUST 使用同一调用起点和成功 terminal result 终点

#### Scenario: 成功结果不包含可识别反馈

- **WHEN** 成功模型调用的 stream 和 terminal result 均不包含非空 content、非空 reasoning 或 tool call
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 省略 `firstContentLatencyMs`
- **AND** MUST 仍包含 `modelE2ELatencyMs`

#### Scenario: 精确投影部分 usage

- **WHEN** 成功 `ModelFinalResult.usage` 只提供 `inputTokens` 和 `totalTokens`
- **THEN** `AFTER_MODEL_RESULT.usage` MUST 保持这两个字段的原始值
- **AND** MUST 省略 `outputTokens`

#### Scenario: Provider 未返回 usage

- **WHEN** 成功 `ModelFinalResult` 未携带 `usage`
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 省略 `usage`
- **AND** 系统 MUST NOT 估算、补齐或推导 token 计数

#### Scenario: 模型调用失败

- **WHEN** concrete provider invocation 未返回成功 terminal result
- **THEN** 系统 MUST NOT 合成 `AFTER_MODEL_RESULT` boundary
- **AND** MUST NOT 以失败时刻合成 model E2E、first feedback 或 usage 诊断事实

### Requirement: Runtime executor is the only authority that interprets outcomes and reduces mutations

hook 正常返回后，runtime SHALL 只按以下固定语义处理结果：

- `PASS`：hook executed and flow continues
- `SKIP`：hook entered but is not applicable, flow continues without mutation or control
- `DENY`：governance denial, stop later impact hooks and the protected operation
- `BLOCK`：protective block or unmet precondition, stop later impact hooks and the protected operation
- `PEND`：recoverable wait with pending input

若 hook 返回 mutation，runtime MUST 先校验 mutation 是否与当前 stage boundary 匹配，只有合法 mutation 才能被应用。effective boundary MUST 由 runtime 产生，而不是由 hook 直接拥有。

若 `DENY`、`BLOCK` 或 `PEND` 与 mutation 同时出现，runtime MUST 以控制信号为准，并忽略 mutation。

#### Scenario: Deny wins over mutation

- **WHEN** 某个 hook 同时返回 `DENY` 和 mutation
- **THEN** runtime 停止主流程并进入拒绝/失败路径
- **AND** 不应用该 mutation

#### Scenario: Pending input is created only from a valid pending intent

- **WHEN** 某个 hook 返回 `outcome=PEND` 且带有合法 `pendingInputIntent`
- **THEN** runtime 创建真正的 pending input
- **AND** pending input 可追溯到该次 hook invocation

#### Scenario: Answered pending input resumes from the saved recoverable stage

- **WHEN** 某个 hook 触发的 pending input 后续被正式回答
- **THEN** runtime 依据挂起前保存的 checkpoint 与 `nextLifecycleStage` 从最近的可恢复 lifecycle stage 恢复执行
- **AND** 不从请求起点重新接受或重放已完成的前序 lifecycle stage
- **AND** 恢复执行继续使用启动期冻结的 hook registration / definition / AgentAssembly activation snapshot

#### Scenario: Pending answer resumes the same run identity

- **WHEN** 某个 hook 触发的 pending input 被正式回答并恢复执行
- **THEN** runtime continues the same `requestRunId` and request identity
- **AND** does not create a new run or increment attempt only because of pending-input resume

### Requirement: Observe-only hooks are observational only

Observe-only hooks can observe the current boundary and may produce bounded diagnostics, logs, metrics, trace, audit, or idempotent external observation. They MUST NOT control flow, create pending input, modify boundary, write runtime-owned truth, or execute business commands that alter external network/customer state.

如果 observe-only hook 返回 control outcome、pending intent 或 mutation，runtime MUST 记录诊断并忽略这些控制结果。主流程 MUST 继续。

#### Scenario: Observe control outcome is ignored

- **WHEN** 一个 observe-only hook 返回 `DENY`、`BLOCK` 或 `PEND`
- **THEN** runtime 记录该返回不合法的诊断
- **AND** 主流程继续

#### Scenario: Observe mutation is ignored

- **WHEN** 一个 observe-only hook 返回 mutation
- **THEN** runtime 不应用该 mutation
- **AND** 后续流程继续基于原 effective boundary 运行

### Requirement: Hook failure handling is explicit and bounded by failure mode

当 impact hook 超时、抛错、不可用或返回非法结果时，runtime SHALL 只按 `failureMode` 处理 hook 自身失败：

- `CONTINUE`：记录失败观测事实后继续主流程
- `FAIL`：记录失败观测事实后终止主流程并进入失败路径

`SYSTEM` hooks MUST use `FAIL`. Observe-only hook failures and timeouts create observation degradation only and MUST NOT use failure mode to change request truth. 系统 MUST NOT 静默吞掉 hook 失败，也 MUST NOT 无限等待 hook 完成。

#### Scenario: Continue-mode timeout leaves evidence and preserves flow

- **WHEN** 某个 impact hook 超时且其 `failureMode=CONTINUE`
- **THEN** runtime 记录 `TIMEOUT` 观测事实
- **AND** 主流程继续

#### Scenario: Fail-mode exception stops the request path

- **WHEN** 某个 impact hook 抛错且其 `failureMode=FAIL`
- **THEN** runtime 记录 `FAILED` 观测事实
- **AND** 当前请求进入失败路径

### Requirement: Every hook invocation produces a timeline-only observability fact

每次 `BEFORE_REQUEST_ACCEPT` Hook invocation，以及每次具有 active accepted-run 坐标的 Hook invocation，MUST 形成恰好一条 timeline-only `HOOK_INVOKED` event。缺少 active accepted-run 坐标的 background model Hook invocation MUST NOT 合成 request-run `HOOK_INVOKED`。事件至少 MUST 能追溯可适用的 `requestRunId`、`sessionId`、`requestId`，以及 `agentId`、`agentVersion`、`hookId`、stage、执行状态、resolved `failureMode` 与耗时。除 Hook 依照 `Hook 结果输出必须由 Hook 明确负责 timeline 安全性` 主动提供的 `resultSummary` 外，系统 MUST 对 event payload 执行既有安全投影；MUST NOT 持久化或投影 prompt、模型输入输出、Hook mutation 值、Owner Scope、原始异常或其他不安全内容。

当 Hook 返回合法 `HookResult` 时，`HOOK_INVOKED` MUST 记录 `status: "SUCCESS"` 和该结果的真实 `outcome`。该结果提供 `resultSummary` 时，系统 MUST 把同一个 JSON 结果对象写入同一事件的 `inlinePayload.resultSummary`；未提供时该字段 MUST 缺失。系统 MUST 保持 `mutationSummary` 只记录由 stage 推导的 mutation kind 和被修改字段名，MUST NOT 将 `resultSummary`、mutation 值或处理后 boundary 值写入 `mutationSummary`。

当 Hook 超时、抛错、不可用或返回非法结果时，`HOOK_INVOKED` MUST 分别记录可适用的 `TIMEOUT`、`FAILED` 或 `INVALID_RESULT` 非成功 `status`，MUST 记录 resolved `failureMode`，并且 MUST 省略 `outcome` 和 `resultSummary`。系统 MUST NOT 为未返回合法结果的 invocation 合成 `outcome: "PASS"`。

对于 `user-query-memory-recall`，系统 MUST 保持既有聚合 `diagnosticCode` 的含义，并以固定、无敏感内容的新增码区分坐标不完整、Assembly/RequestRun/根消息读取失败，以及 L1 搜索和 L2 详情读取的失败或取消。日志还 MUST 在路径适用时记录 L1 候选数、可用 L2 详情数和上下文准入结果。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: Hook 结果输出进入同一条 invocation fact

- **WHEN** run-bound Hook 返回携带合法 `resultSummary` 的合法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 同时记录 `status: "SUCCESS"`、真实 `outcome`、resolved `failureMode` 和与 Hook 返回对象 JSON 语义等价的 `resultSummary`
- **AND** 同一次 invocation MUST NOT 因结果输出产生第二条 timeline event

#### Scenario: 省略结果输出时事件不合成字段

- **WHEN** run-bound Hook 返回不含 `resultSummary` 的合法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 记录 `status: "SUCCESS"`、真实 `outcome` 和 resolved `failureMode`
- **AND** `inlinePayload.resultSummary` MUST 缺失

#### Scenario: 非成功 invocation 不伪造控制结论

- **WHEN** run-bound Hook 超时、抛错、不可用或返回非法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 记录匹配失败事实的非成功 `status` 和 resolved `failureMode`
- **AND** `outcome` 和 `resultSummary` MUST 缺失
- **AND** 系统 MUST NOT 以 `PASS`、`SKIP`、`DENY`、`BLOCK` 或 `PEND` 伪装 Hook 未返回的结论

#### Scenario: 主动召回输出可定位的安全摘要

- **GIVEN** `user-query-memory-recall` 已被调用
- **WHEN** Hook 被跳过、依赖读取失败、L1 未命中或失败、L2 失败、未准入上下文或成功注入
- **THEN** `HOOK_INVOKED` MUST 记录对应阶段的固定 `diagnosticCode`
- **AND** 运维人员 MUST 能仅通过该码区分前置条件、L1、L2、上下文准入和幂等跳过
- **AND** 任意诊断字段均 MUST NOT 包含 Query、Owner Scope、记忆 ID、记忆正文、模型消息、mutation 值或原始异常

### Requirement: Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection

当 Hook 返回合法结果时，`HOOK_INVOKED.outcome` MUST 记录该 invocation 的真实 Hook 控制结论，包括改变 request lifecycle 的 `DENY`、`BLOCK` 和 `PEND`。消费者 MUST 先确认 `status: "SUCCESS"`，再使用 `outcome` 识别 Hook 返回的控制结论。非成功 invocation MUST 按 `Every hook invocation produces a timeline-only observability fact` 省略 `outcome`。Runtime MUST NOT 发布单独的 `HOOK_OUTCOME_APPLIED` event；`HOOK_INVOKED` 是 Hook invocation evidence 的单一事实来源。

`HOOK_INVOKED` MUST NOT 默认映射成新的用户可见 `StreamEventType`。对于 `PEND`，`USER_INPUT_REQUIRED` event MUST 携带 `pendingInputId` 供下游关联。

**需求类别**：功能性需求

#### Scenario: Deny is recorded in HOOK_INVOKED without a separate event

- **WHEN** 某个 Hook 合法返回 `DENY` 并改变请求生命周期
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "DENY"`
- **AND** 系统 MUST NOT 新增单独的 `HOOK_OUTCOME_APPLIED` event
- **AND** 系统 MUST NOT 新增对应的用户可见 stream event type

#### Scenario: Block is distinguishable from deny in HOOK_INVOKED

- **WHEN** 某个 Hook 合法返回 `BLOCK` 并改变请求生命周期
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "BLOCK"`
- **AND** 消费者 MUST 能通过 `outcome` 区分 `BLOCK` 与 `DENY`

#### Scenario: Pending is recorded in HOOK_INVOKED with USER_INPUT_REQUIRED correlation

- **WHEN** 某个 Hook 合法返回 `PEND` 并导致请求进入等待用户输入状态
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "PEND"`
- **AND** Runtime MUST 发出携带 `pendingInputId` 的 `USER_INPUT_REQUIRED` event
- **AND** 下游 MUST 能通过 `hookInvocationId` 关联 `HOOK_INVOKED` 与 `USER_INPUT_REQUIRED`

#### Scenario: Pending answer reception reuses existing client-visible input events

- **WHEN** 某个由 lifecycle Hook 触发的 pending input 被正式回答
- **THEN** Runtime MUST 继续沿用既有 `USER_INPUT_RECEIVED` 与 canonical timeline 事实
- **AND** 系统 MUST NOT 为 Hook 恢复路径新增专用的用户可见 stream event type

### Requirement: Hook execution must not create silent degradation or truth ambiguity

当 hook 执行、pending input 创建、观测输出或下游写出失败时，系统 MUST 显式暴露失败或降级结果。系统 MUST NOT 产生“既未继续、也未失败、也未挂起”的不一致状态。

#### Scenario: Pending creation failure does not masquerade as successful suspension

- **WHEN** hook 返回 `PEND`，但后续 pending input 无法被正式创建
- **THEN** 系统显式暴露该失败或降级结果
- **AND** 不把请求伪装成已成功挂起

#### Scenario: Observability sink failure does not rewrite hook truth

- **WHEN** hook invocation 的日志、指标或审计下游写出失败
- **THEN** hook 的 lifecycle 结果仍以 runtime 已成立的控制结果为准
- **AND** 系统留下最小可诊断证据

### Requirement: System output redaction guard protects final client-visible content

内置 `system.output-redaction-guard` SHALL 是运行于 `BEFORE_AGENT_TERMINAL` 的 `SYSTEM` lifecycle hook，并使用 `effects=["TRANSFORM","CONTROL"]`、`failureMode=FAIL`、明确的 system order、`configSchema` 和仅启动期执行的 `configure(config)`。

该 hook SHALL 检查最终 client-visible `finalContent`，在可安全替换时脱敏有界的 credential-like pattern、手机号和本地/内部路径，并对 private key 这类高风险内容返回 `BLOCK`。该 hook MUST NOT 因 IPv4 或 IPv6 地址形态改写或阻止 `finalContent`。该 hook MUST NOT 作为 `AFTER_MODEL_RESULT` 的替代实现，也 MUST NOT 记录 raw finding 或 raw final content。

**需求类别**：系统质量属性

**质量属性**：安全、可测试性
**适用范围**：该 Function

#### Scenario: 脱敏 guard 在 final-content event 前改写受保护内容

- **WHEN** 最终内容包含 credential-like pattern、手机号或本地/内部路径中的至少一种可脱敏文本
- **THEN** terminal stage MUST 消费 `AgentTerminalMutation.finalContent`
- **AND** 发出的最终内容 MUST 使用脱敏后的内容

#### Scenario: 业务 IP 内容保持原文

- **WHEN** 最终内容包含任意 IPv4 或 IPv6 地址，且不包含其他命中终态保护策略的内容
- **THEN** `system.output-redaction-guard` MUST 返回不含 `finalContent` mutation 的 `PASS`
- **AND** 发出的最终内容 MUST 保留 IP 地址原文

#### Scenario: IP 与其他受保护内容同时出现

- **WHEN** 最终内容同时包含 IP 地址和至少一种其他命中终态保护策略的内容
- **THEN** `system.output-redaction-guard` MUST 仅改写或阻止其他命中内容
- **AND** 产生的 `finalContent` mutation MUST 保留 IP 地址原文

### Requirement: Capability 结果后边界提供同次调用的有效输入

每个 `AFTER_CAPABILITY_RESULT` boundary MUST 包含该次 runtime Capability 调用实际使用的 `arguments: JsonObject`。该字段 MUST 是 `BEFORE_CAPABILITY_INVOKE` 的合法 mutation 应用后、Capability executor 接收的有效输入；Hook 对收到的嵌套值执行原地修改，MUST NOT 改变已经完成的 Capability 调用、持久化事实或其他 Hook 看到的边界。

`arguments` MUST 只提供给当前 accepted Agent 已激活的 `AFTER_CAPABILITY_RESULT` Hook。Runtime MUST NOT 因该字段自动新增日志、metric、trace、audit、safe error、Web API、stream、timeline 或 terminal projection。Hook 主动产生的结果或开发诊断 MUST 继续分别遵守其已批准的输出契约；本 Requirement 不扩大任何 Hook 输出权限。

**需求类别**：系统质量属性

**质量属性**：安全、可测试性
**适用范围**：该 Function

#### Scenario: 结果后 Hook 取得 executor 实际使用的输入

- **GIVEN** `BEFORE_CAPABILITY_INVOKE` Hook 已将 Bash `arguments.command` 替换为包含 `action.py` 的字符串
- **WHEN** 该 Bash 调用完成并进入 `AFTER_CAPABILITY_RESULT`
- **THEN** 结果后 boundary 的 `arguments.command` MUST 是替换后的有效字符串
- **AND** 不得提供被替换前的输入作为匹配依据

#### Scenario: 结果后输入不扩散到其他输出面

- **WHEN** `AFTER_CAPABILITY_RESULT` boundary 包含 `arguments`
- **THEN** Runtime MUST NOT 自动把该字段写入日志、metric、trace、audit、safe error、Web API、stream、timeline 或 terminal projection
- **AND** 未显式返回 `resultSummary` 的 Hook invocation MUST NOT 因该字段产生结果输出

#### Scenario: Hook 原地修改结果后输入不改变已成立事实

- **WHEN** Hook 原地修改收到的 `arguments` 嵌套值且未通过任何合法结果字段返回 replacement
- **THEN** 已完成的 Capability 调用输入和结果 MUST 保持不变
- **AND** 后续 Hook 看到的结果后 boundary MUST 保持 stage 入口的有效输入

### Requirement: Northbound output normalization Hook 仅匹配目标 Bash action

系统 MUST 提供 `hookId="northbound-output-normalization-hook"` 的 `CUSTOM` transform lifecycle Hook。部署方 MUST 通过既有 Agent Hook activation 的 `config.matchText` 提供用于匹配的非空字符串；显式提供空字符串、仅包含空白或缺少必填字段的 config MUST 在 activation materialization 时失败。没有 activation config 的基础 Hook executable MUST 保持 inert 并返回 `SKIP`。该 Hook MUST 只支持 `AFTER_CAPABILITY_RESULT`，MUST 使用 `effects=["TRANSFORM"]` 和 `failureMode="CONTINUE"`，并且只有在当前 Agent 显式激活后才能执行。

该 Hook MUST 按以下完整条件表决定结果；字符串包含判断 MUST 区分大小写，并以该插件实例配置的连续子字符串 `matchText` 为唯一匹配文本：

| `capabilityId` | `arguments.command` | `arguments.args` | Hook 结果 |
|---|---|---|---|
| 精确等于 `Bash` | string 且包含 `matchText` | 任意合法值或缺失 | `PASS`，并提供 `resultSummary` 和 `mutation: { structuredPayload }` |
| 精确等于 `Bash` | 不包含 `matchText` 或不是 string | array 且至少一个 string 元素包含 `matchText` | `PASS`，并提供 `resultSummary` 和 `mutation: { structuredPayload }` |
| 其他全部组合 | 任意值 | 任意值 | `SKIP`，并省略 `resultSummary` |

当 `command` 和 `args` 同时命中时，Hook MUST 仍只返回一个 `HookResult`。该 Hook MUST NOT 匹配 `description`、`env`、Capability 结果或其他字段中的 `matchText`，MUST NOT 返回 control outcome、pending intent、safe reason 或 error；命中时 MUST 同时返回 `resultSummary` 和 `mutation: { structuredPayload }`。

**需求类别**：功能性需求

#### Scenario: Bash command 命中配置字符串

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，且有效 `arguments.command` 为 `python workspace/actions/northbound-entry.py --site 001`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "PASS"`
- **AND** MUST 提供恰好一个 `resultSummary` 和 `mutation: { structuredPayload }`

#### Scenario: Bash args 命中同一配置字符串

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，有效 `arguments.command` 为 `python`，且 `arguments.args` 至少包含字符串 `workspace/actions/northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "PASS"`
- **AND** MUST 提供恰好一个 `resultSummary` 和 `mutation: { structuredPayload }`

#### Scenario: 大小写不同不命中

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，但 `command` 和全部 `args` 字符串都不包含区分大小写的连续文本 `northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 非 Bash Capability 不命中

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 不等于 `Bash`，即使其 `arguments.command` 或任一 `arguments.args` 字符串包含 `northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 旧固定字符串不会覆盖插件配置

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成 Bash 调用的有效 `arguments.command` 只包含 `action.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 空白检查字符串配置失败

- **WHEN** Agent Hook activation config 显式提供空字符串、仅包含空白或缺少必填 `matchText`
- **THEN** activation materialization MUST 失败
- **AND** MUST NOT 产生会匹配所有 Bash 输入的 Hook

### Requirement: Northbound Hook 原样返回已批准的 Bash 结构化结果

当 `northbound-output-normalization-hook` 命中目标 Bash action 时，Hook MUST 把当前 `AFTER_CAPABILITY_RESULT` boundary 的完整 `structuredPayload` 作为 `HookResult.resultSummary` 和 `HookResult.mutation.structuredPayload` 返回，并保持 JSON 语义等价。该 Hook 是“Hook 结果输出必须由 Hook 明确负责 timeline 安全性”和“Hook 结果输出必须满足请求终态公开边界”中禁止复制通用 Capability 输出规则的唯一显式受控例外；例外只适用于当前 Owner Scope 与 Agent Scope 的匹配 Bash action 结果。

Hook MUST NOT 解析、筛选、重命名、转换、排序、裁剪、脱敏、补全或合并 `structuredPayload`。当 boundary 缺少 `structuredPayload` 时，Hook MUST 返回 `SKIP` 并省略 `resultSummary`。当完整 Hook invocation fact 或 terminal Hook 结果快照不满足既有 JSON 或容量边界时，系统 MUST 按既有 Hook 非法结果语义拒绝整个 `resultSummary`，MUST NOT 返回部分、截断或改写的 Bash 结果；transform Hook 的该失败 MUST NOT 改变 Bash 调用结果或请求 truth。

**需求类别**：系统质量属性

**质量属性**：安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 匹配结果按 JSON 语义原样进入 HookResult

- **GIVEN** 匹配 Bash action 的 `structuredPayload` 为 `{ "stdout": "ok", "stderr": "", "exitCode": 0, "stdoutTruncated": false, "stderrTruncated": false }`
- **WHEN** `northbound-output-normalization-hook` 执行完成
- **THEN** `HookResult.resultSummary` 和 `HookResult.mutation.structuredPayload` MUST 与该 `structuredPayload` 保持 JSON 语义等价
- **AND** 同一请求终态 Hook 结果快照 MUST 按既有契约提供同一结果对象

#### Scenario: 缺少结构化结果时跳过

- **WHEN** 调用身份和输入满足匹配条件，但 `AFTER_CAPABILITY_RESULT` boundary 缺少 `structuredPayload`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 结果超过既有容量边界时不部分输出

- **WHEN** Hook 返回的完整 Bash `structuredPayload` 使既有 Hook invocation fact 或 terminal Hook 结果快照超过容量边界
- **THEN** 系统 MUST 拒绝整个 `resultSummary`
- **AND** MUST NOT 截断、筛选或改写 Bash 结果
- **AND** Bash 调用结果和请求 truth MUST 保持不变

### Requirement: Northbound Hook 作为未激活插件资产随本地运行包交付

每个 backend-capable 本地运行包 MUST 在 `config/plugins/northbound-output-normalization-hook/` 包含可由既有 plugin loader 加载的 `plugin.json` 和 `index.js`。`plugin.json` MUST 声明 `pluginId="northbound-output-normalization-hook"`，`main="./index.js"` 和 `artifactType="esm-bundle"`。

打包流程 MUST NOT 因交付该资产而自动向包内 system config 添加 plugin entry，MUST NOT 自动向任何 packaged Agent 添加 Hook activation。未通过 Agent Hook activation 提供 `matchText` 的插件 Hook MUST 保持 inert，并在被执行时返回 `SKIP`；显式提供空字符串或仅包含空白的 `matchText` MUST 继续失败。

**需求类别**：功能性需求

#### Scenario: Backend-capable 包包含 Northbound Hook 插件资产

- **WHEN** 打包流程生成 `backend-only` 或 `with-frontend` 本地运行包
- **THEN** candidate MUST 包含 `config/plugins/northbound-output-normalization-hook/plugin.json`
- **AND** candidate MUST 包含 `config/plugins/northbound-output-normalization-hook/index.js`
- **AND** 该插件资产 MUST 可由既有 plugin loader 加载

#### Scenario: 随包交付不自动声明或激活 Hook

- **WHEN** 打包流程把 Northbound Hook 插件资产写入 candidate
- **THEN** 包内 system config MUST NOT 因该资产新增 `northbound-output-normalization-hook` plugin entry
- **AND** packaged Agent MUST NOT 因该资产新增 `northbound-output-normalization-hook` activation

#### Scenario: Frontend-only 包不包含后端 Hook 资产

- **WHEN** 打包流程生成 `frontend-only` artifact
- **THEN** artifact MUST NOT 包含 `config/plugins/northbound-output-normalization-hook/`

### Requirement: Hook invocation requestContextId MUST stay within timeline field length limits

Runtime 在构建 Hook execution scope 时生成的 `requestContextId` MUST 不超过 timeline event inline payload 字段长度限制。当 `stageOccurrenceKey` 拼接后的 `requestContextId` 可能超过限制时，runtime MUST 使用确定性短哈希压缩该值，使生成的 `requestContextId` 保持唯一性同时远低于限制长度。

**需求类别**：系统质量属性

**质量属性**：可靠性、可测试性

#### Scenario: 长 stageOccurrenceKey 被压缩为短 requestContextId

- **WHEN** Hook invocation 的 `stageOccurrenceKey` 格式为 AFTER_CAPABILITY_RESULT:round:0:tool:<toolCallId>:after，拼接后超过 64 字符
- **THEN** runtime MUST 使用短哈希压缩生成 `requestContextId`
- **AND** 生成的 `requestContextId` MUST 远低于 timeline 字段长度限制
- **AND** `HOOK_INVOKED` 事件 MUST 成功写入 timeline store

#### Scenario: 短哈希保持唯一性

- **WHEN** 两个不同的 `stageOccurrenceKey` 各自生成短哈希
- **THEN** 生成的 `requestContextId` MUST 在实际使用场景中保持区分性
- **AND** 哈希碰撞不会导致 timeline 事件写入失败

### Requirement: Hook 结果可以直接携带执行后结果输出

`HookResult` MUST 允许 Hook 在任一合法 `PASS`、`SKIP`、`DENY`、`BLOCK` 或 `PEND` 结果中省略或提供一个 `resultSummary: JsonObject`。这里的 `resultSummary` MUST 表示 Hook 显式返回的执行后结果对象，不是 Runtime 生成的摘要。

省略时系统 MUST 保持当前 Hook 控制、mutation、pending 和观测行为，并且 MUST NOT 合成默认值。提供时，系统 MUST 只校验该值是可序列化的 JSON object，并保证包含该对象的完整 `HOOK_INVOKED.inlinePayload` 的 UTF-8 JSON 编码不超过 `49_000 bytes`。显式 `null`、数组、非 JSON 值、循环引用或容量超限 MUST 使整个 `HookResult` 成为非法结果。

除上述 JSON 边界和容量校验外，Runtime MUST NOT 对 `resultSummary` 执行摘要生成、字段筛选、字段重命名、值转换、排序、裁剪、脱敏、补全或业务解释。通过校验的对象 MUST 按 JSON 语义原样进入 event。`resultSummary` MUST NOT 改变 `outcome`、mutation、pending input、failure mode、Agent loop、模型上下文、Capability 调用或 request terminal result。

**需求类别**：功能性需求

#### Scenario: Hook 返回的结果对象被原样接受

- **WHEN** Hook 返回合法 `outcome`，并携带可序列化且使完整 `HOOK_INVOKED.inlinePayload` 不超过 `49_000 bytes` 的 `resultSummary`
- **THEN** 系统 MUST 接受该 `HookResult`
- **AND** 系统 MUST 保留 `resultSummary` 的全部 JSON 字段、嵌套结构、数组、标量和 `null` 值
- **AND** 系统 MUST 继续仅按 `outcome`、mutation 和 pending input 解释 lifecycle 行为

#### Scenario: Hook 可以省略结果输出

- **WHEN** Hook 返回不含 `resultSummary` 的合法 `HookResult`
- **THEN** 系统 MUST 保持既有 Hook 行为
- **AND** 系统 MUST NOT 合成 `resultSummary`

#### Scenario: 非法结果输出使整个 Hook 结果无效

- **WHEN** `resultSummary` 本身是 `null`、数组、包含非 JSON 值或循环引用，或者包含该对象的完整 `HOOK_INVOKED.inlinePayload` 的 UTF-8 JSON 编码超过 `49_000 bytes`
- **THEN** 系统 MUST 将整个 `HookResult` 判定为非法
- **AND** 系统 MUST NOT 应用同一结果中的 mutation、control outcome 或 pending input intent
- **AND** 系统 MUST 按 `Hook failure handling is explicit and bounded by failure mode` 处理该非法结果

### Requirement: Hook 结果输出必须由 Hook 明确负责 timeline 安全性

`resultSummary` 是 Hook 主动提供给内部 timeline 的结果输出。Hook MUST 只把允许进入 `HOOK_INVOKED` 的结果数据放入该字段，MUST NOT 放入 prompt、模型输入输出、Capability 输入输出、Hook input、完整 boundary、mutation 值、Owner Scope、credential、authentication token、附件内容或原始异常。不能保证该边界的 Hook MUST 省略 `resultSummary`。

Runtime MUST NOT 从 Hook input、boundary、mutation、pending input、safe reason、error details 或处理后的 boundary 补充、展开或反推 `resultSummary`。该字段不改变 `HOOK_INVOKED` 的 timeline-only 可见性。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Runtime 不从其他 Hook 数据合成结果输出

- **WHEN** 合法 `HookResult` 未提供 `resultSummary`，但 mutation、pending input、safe reason、error details 或 boundary 包含处理信息
- **THEN** 系统 MUST 省略 `HOOK_INVOKED.inlinePayload.resultSummary`
- **AND** 系统 MUST NOT 将上述数据复制、摘要或编码到 `resultSummary`

#### Scenario: Runtime 不改写 Hook 提供的结果输出

- **WHEN** 合法 `HookResult` 提供满足边界要求的 `resultSummary`
- **THEN** Runtime MUST NOT 因字段名称或字段值执行额外的内容处理
- **AND** timeline 中的 `resultSummary` MUST 与 Hook 返回对象保持 JSON 语义等价

### Requirement: Hook 结果输出必须满足请求终态公开边界

当 Hook 在 `HookResult.resultSummary` 中提供执行后结果时，该对象 MUST 只包含允许返回给当前 Owner Scope 与 Agent Scope 调用方的数据。同一 request/run 形成合法请求终态快照时，系统 MUST 使用与 `HOOK_INVOKED.inlinePayload.resultSummary` JSON 语义等价的对象。不能保证该公开边界的 Hook MUST 省略 `resultSummary`。

Runtime MUST NOT 从 Hook input、boundary、mutation、pending input、safe reason、error details 或处理后的 boundary 补充、展开或反推 `resultSummary`。除既有 JSON 与容量校验外，Runtime MUST NOT 对其执行摘要生成、字段筛选、字段重命名、值转换、排序、裁剪、脱敏、补全或业务解释。`HOOK_INVOKED` event 本身的 timeline-only 可见性 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: Hook 结果进入同一请求终态快照

- **WHEN** Hook 为当前 request/run 返回合法且允许公开的 `resultSummary`
- **THEN** 系统 MUST 保留该对象作为对应 `HOOK_INVOKED` 的结果事实
- **AND** 请求终态快照包含该 invocation 时 MUST 使用与该对象 JSON 语义等价的 `resultSummary`
- **AND** `HOOK_INVOKED` event 本身 MUST NOT 因此进入公开 stream vocabulary

#### Scenario: Hook 省略结果时不合成输出

- **WHEN** Hook 未提供 `resultSummary`
- **THEN** 对应 invocation 的请求终态快照条目 MUST 省略 `resultSummary`
- **AND** 系统 MUST NOT 从其他 Hook 或运行数据补充该字段

#### Scenario: Runtime 不替 Hook 执行内容处理

- **WHEN** Hook 提供字段名、字段值和嵌套结构均合法的 `resultSummary`
- **THEN** Runtime MUST 按 JSON 语义直接复制完整对象
- **AND** Runtime MUST NOT 因内容语义修改该对象
