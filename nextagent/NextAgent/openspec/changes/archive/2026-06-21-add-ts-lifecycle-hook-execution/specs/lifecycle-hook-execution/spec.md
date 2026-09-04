## ADDED Requirements

### Requirement: Lifecycle hooks execute only at runtime-owned lifecycle stages

系统 SHALL 只在 runtime-owned request lifecycle 的固定治理边界上执行 lifecycle hook。首版强制支持的 stage MUST 至少包括：

- `BEFORE_REQUEST_ACCEPT`
- `BEFORE_PLANNING`
- `BEFORE_MODEL_INVOKE`
- `AFTER_MODEL_RESULT`
- `BEFORE_CAPABILITY_INVOKE`
- `AFTER_CAPABILITY_RESULT`
- `BEFORE_CONTEXT_COMPACT`
- `AFTER_CONTEXT_COMPACT`
- `BEFORE_TERMINAL_EVENT`

hook MUST 由主流程推进到对应 lifecycle stage 时同步触发，不得通过后台补采、日志回放、离线任务或独立调度器补建。

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

### Requirement: Hook definitions and Agent bindings remain separate and bounded

系统 SHALL 将 lifecycle hook code registration、hook definition 与 Agent hook binding 视为分离边界：

- hook code registration 由 app composition 在启动期显式接入并冻结，将 `hookId` 绑定到可调用 TypeScript hook code；
- hook definition 定义稳定属性、支持 stage、执行模式、失败模式和来源边界；
- Agent binding 只允许启用或收窄 `stages`、`order`、`timeoutMs` 和传给 hook code 的 `config`；
- Agent binding MUST NOT 改写 `kind`、`executionMode`、`failureMode`、`source` 或 hook 支持边界。

配置 MUST only declare when and how a registered hook code is attached to an Agent lifecycle stage. Runtime MUST NOT interpret binding `config` as a business-rule DSL and MUST NOT create hook decisions or mutations from configuration without executing the registered hook code.

Hook code MUST be TypeScript backend code composed at startup. The first release MUST NOT support Python, Java, shell, Wasm, remote hook code, script files, model-generated code, or runtime hot loading as lifecycle hook implementations.

TypeScript hook implementation MUST be explicitly registered by app composition during startup and frozen before request execution. Runtime MUST NOT scan directories, dynamically import files from configuration paths, or load hook code from Agent package directories.

Hook execution failures MUST fail open in the first release. Timeout, throw, unavailable, or invalid hook result evidence MUST NOT block the request main path, regardless of hook source or declared failure mode.

After startup composition completes, the effective hook code registration, hook definitions, and Agent hook bindings MUST be frozen for request execution. Runtime MUST NOT reread hook configuration or change the effective hook set in the middle of a request.

`SYSTEM` hook MUST 先于 `CUSTOM` hook 执行。`SYSTEM` hook 不得被 Agent binding 禁用，且其 `failureMode` MUST 为 `FAIL`。

#### Scenario: Binding can narrow stages but cannot change hook kind

- **WHEN** 某个 Agent 对已存在的 hook definition 建立 binding
- **THEN** binding 可以收窄执行 stage 或覆盖 timeout / order / config
- **AND** 不会把 `SYSTEM` hook 改成 `CUSTOM`

#### Scenario: System hook remains enabled even if Agent tries to disable it

- **WHEN** 某个 Agent binding 试图禁用一个 `SYSTEM` hook
- **THEN** 该 hook 仍保持生效
- **AND** runtime 不接受该禁用结果作为有效 binding 语义

#### Scenario: Binding attaches registered code but does not define processing logic

- **WHEN** an Agent binding references a registered `hookId`
- **THEN** runtime uses the binding only to resolve stage, order, timeout and config
- **AND** runtime executes the app-composed hook code for processing logic
- **AND** runtime does not synthesize decision or mutation from the binding config itself

#### Scenario: Missing hook code registration is not silently skipped

- **WHEN** a binding references a hook definition whose code is not registered by app composition
- **THEN** runtime treats the hook as unavailable for that invocation
- **AND** records the failure evidence and continues the main path

#### Scenario: Hook execution failures do not block the main path

- **WHEN** any hook invocation times out, throws, is unavailable, or returns an invalid result
- **THEN** timeout, throw, unavailable, or invalid hook result evidence does not terminate the request main path
- **AND** runtime records the failure evidence and continues execution

#### Scenario: Hook configuration is frozen after startup

- **WHEN** app startup composition has completed
- **THEN** runtime uses the frozen hook registration / definition / binding snapshot for request execution
- **AND** runtime does not reload hook configuration during an active request

#### Scenario: Hook registration is frozen after startup composition

- **WHEN** app composition registers a lifecycle hook implementation
- **THEN** runtime uses the frozen startup registration for request execution
- **AND** runtime does not scan directories or import hook modules from configured paths

#### Scenario: Terminal output safety hook is composed by app startup registration

- **WHEN** app composition registers a `terminal-output-safety-check` hook implementation during startup
- **AND** a request reaches `BEFORE_TERMINAL_EVENT`
- **THEN** runtime invokes the registered TypeScript hook code with the terminal boundary
- **AND** if the hook returns `REJECT`, runtime stops terminal write and records `HOOK_DECISION_APPLIED`
- **AND** if the hook returns `APPROVE`, runtime continues terminal flow

### Requirement: Blocking hooks use a stable synchronous execution order

对每个 lifecycle stage，runtime SHALL 先解析生效 hooks，再按以下固定顺序执行所有 `BLOCKING` hook：

1. `SYSTEM` 先于 `CUSTOM`
2. 同 kind 内按 `order`
3. `order` 相同再按 `hookId`

首版 `BLOCKING` hook MUST 同步顺序执行并顺序归约。系统 MUST NOT 在首版引入会改变流程的并行 hook，也 MUST NOT 定义并行 decision / mutation 合并规则。

#### Scenario: Blocking hooks execute in deterministic order

- **WHEN** 某个 stage 同时存在多个 `BLOCKING` hook
- **THEN** runtime 按固定顺序执行它们
- **AND** 不因注册顺序、执行环境差异或下游消费者存在与否而改变顺序

#### Scenario: Later blocking hook sees the effective terminal boundary produced by prior mutation

- **WHEN** 前一个 `BLOCKING` hook 在 `BEFORE_TERMINAL_EVENT` 返回合法 mutation 并被 runtime 应用
- **THEN** 后一个 `BLOCKING` hook 看到的是更新后的 effective boundary
- **AND** 不是旧 boundary 的快照

### Requirement: Hook inputs are stage-scoped, minimal, and authority-safe

每次 hook 执行 SHALL 至少接收以下输入：

- `hookId`
- `bindingId?`
- `agentId`
- `agentVersion`
- 当前 `stage`
- 与该 stage 对应的 typed `HookBoundary`
- 可选的 binding `config`

hook input MUST 只携带当前 stage 已成立且允许暴露的边界事实。hook input MUST NOT 混入：

- `RequestRun` 全对象
- 通用 `requestContextId` 引用泄漏
- `tenantId` / `subjectId` 裸字段
- 未经当前 stage 明确定义的 payload
- raw prompt、raw model output、tool args/result、附件正文、secret 或 credential

#### Scenario: Hook receives only stage-specific boundary facts

- **WHEN** runtime 在某个 stage 调用 hook
- **THEN** hook input 只包含该 stage 的 boundary facts
- **AND** 不会把整个请求运行态对象直接交给 hook

#### Scenario: Hook execution does not require cross-owner probing

- **WHEN** hook 准备执行
- **THEN** runtime 只使用当前边界已知且可信的输入构造 hook input
- **AND** 不会为了补齐输入发起新的跨 owner 探测

### Requirement: Pending is allowed only at explicitly supported lifecycle stages

`decision=PEND` MUST be treated as a stage capability, not a universal hook outcome. In the first release:

- `BEFORE_CAPABILITY_INVOKE` MAY support `PEND`
- `BEFORE_TERMINAL_EVENT` MAY support `PEND`
- all other lifecycle stages MUST treat `PEND` as an invalid hook result unless a later OpenSpec change explicitly enables it

When a stage does not support `PEND`, runtime MUST record the returned `PEND` as invalid hook result evidence, continue the main path, and MUST NOT create pending input truth.

#### Scenario: Unsupported stage pend is rejected through failure mode

- **WHEN** a hook at `BEFORE_REQUEST_ACCEPT` returns `decision=PEND`
- **THEN** runtime treats the result as invalid for that stage
- **AND** does not create pending input truth
- **AND** records invalid result evidence and continues the main path

### Requirement: Hook code execution is app-composed and bounded

系统 SHALL 通过 app composition 接入 TypeScript hook code，并由 runtime hook executor 在绑定 stage 调用该 hook code。首版 MUST NOT 从配置文件、远端地址、脚本文件、Python/Java 类、shell 命令、Wasm module、模型输出或用户请求动态加载 hook code。

Hook code MUST receive only `HookInput` and MUST return only `HookResult`. Hook code MUST NOT directly own RequestRun lifecycle, checkpoint truth, terminal commit, channel projection, capability invocation, sandbox execution, gateway persistence, or risk policy execution.

#### Scenario: Hook code is invoked through the runtime executor

- **WHEN** runtime reaches a lifecycle stage with an enabled binding and registered hook code
- **THEN** runtime invokes that hook code with stage-scoped `HookInput`
- **AND** consumes only the returned `HookResult`

#### Scenario: Non-TypeScript hook implementations are outside the first-release loader path

- **WHEN** the system runs in the first-release startup-composed hook mode
- **THEN** request execution can only use the registered TypeScript `LifecycleHookPort`
- **AND** runtime has no loader path that executes Python, Java, shell, Wasm, remote, script-file, or model-generated hook implementation as a lifecycle hook

#### Scenario: Configuration does not execute as code

- **WHEN** hook configuration contains values under `config`
- **THEN** runtime passes those values to the registered hook code
- **AND** does not evaluate the configuration as script, expression, remote call, model instruction, or policy DSL

### Requirement: Stage-specific boundaries and mutations are minimal runtime contracts

系统 SHALL 将 stage-specific `HookBoundary` 与 `BoundaryMutation` 作为 `agent-contracts/runtime` owned contract 定义。系统 MUST NOT 新增 `agent-contracts/hook` owning surface，也 MUST NOT 将这些 boundary / mutation 归入 capability、channel、observability 或 gateway owning surface。

首版每个 stage 的 boundary MUST 只包含当前 stage 已成立的安全事实、稳定 refs、低敏 safe summary、计数、状态枚举或 policy-neutral flags。首版 stage / mutation 支持范围 MUST 保持以下最小清单：

| Stage | Mutation support |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | none |
| `BEFORE_PLANNING` | none |
| `BEFORE_MODEL_INVOKE` | none |
| `AFTER_MODEL_RESULT` | none |
| `BEFORE_CAPABILITY_INVOKE` | none |
| `AFTER_CAPABILITY_RESULT` | none |
| `BEFORE_CONTEXT_COMPACT` | none |
| `AFTER_CONTEXT_COMPACT` | none |
| `BEFORE_TERMINAL_EVENT` | `TerminalEventMutation` |

For stages whose mutation support is `none`, runtime MUST treat any returned mutation as invalid hook result evidence. In the first release, runtime MUST only consume `TerminalEventMutation` at `BEFORE_TERMINAL_EVENT`; other mutation vocabulary remains contract inventory for a later change and MUST be ignored by the current executor after recording failure evidence.

#### Scenario: Unsupported stage mutation is rejected

- **WHEN** a hook at `BEFORE_PLANNING` returns any mutation
- **THEN** runtime treats the result as invalid for that stage
- **AND** records invalid result evidence and continues the main path

#### Scenario: Boundary contracts stay in runtime surface

- **WHEN** implementation adds stage-specific hook boundary or mutation types
- **THEN** those contracts are exported from `agent-contracts/runtime`
- **AND** no `agent-contracts/hook` export surface is introduced

### Requirement: Runtime is the only authority that interprets decisions and applies mutations

hook 正常返回后，runtime SHALL 只按以下固定语义处理结果：

- `NO_OPINION`：继续流程
- `APPROVE`：继续流程
- `REJECT`：停止后续 `BLOCKING` hook 和主流程，并进入拒绝或失败路径
- `PEND`：停止后续 `BLOCKING` hook 和主流程，并创建 pending input

若 hook 返回 mutation，runtime MUST 先校验 mutation 是否与当前 stage boundary 匹配，只有合法 mutation 才能被应用。effective boundary MUST 由 runtime 产生，而不是由 hook 直接拥有。

若 `REJECT` 或 `PEND` 与 mutation 同时出现，runtime MUST 以控制信号为准，并忽略 mutation。

#### Scenario: Reject wins over mutation

- **WHEN** 某个 hook 同时返回 `REJECT` 和 mutation
- **THEN** runtime 停止主流程并进入拒绝/失败路径
- **AND** 不应用该 mutation

#### Scenario: Pending input is created only from a valid pending intent

- **WHEN** 某个 hook 返回 `decision=PEND` 且带有合法 `pendingInputIntent`
- **THEN** runtime 创建真正的 pending input
- **AND** pending input 可追溯到该次 hook invocation

#### Scenario: Answered pending input resumes from the saved recoverable stage

- **WHEN** 某个 hook 触发的 pending input 后续被正式回答
- **THEN** runtime 依据挂起前保存的 checkpoint 与 `nextLifecycleStage` 从最近的可恢复 lifecycle stage 恢复执行
- **AND** 不从请求起点重新接受或重放已完成的前序 lifecycle stage
- **AND** 恢复执行继续使用启动期冻结的 hook registration / definition / binding 快照

#### Scenario: Pending answer resumes the same run identity

- **WHEN** 某个 hook 触发的 pending input 被正式回答并恢复执行
- **THEN** runtime continues the same `requestRunId` and request identity
- **AND** does not create a new run or increment attempt only because of pending-input resume

### Requirement: Non-blocking hooks are observational only

`NON_BLOCKING` hook 只能观察当前边界。它们 MAY 产生观测结果，但 MUST NOT 控制流程或修改 boundary。

如果 `NON_BLOCKING` hook 返回 decision 或 mutation，runtime MUST 记录诊断并忽略这些控制结果。主流程 MUST 继续。

#### Scenario: Non-blocking decision is ignored

- **WHEN** 一个 `NON_BLOCKING` hook 返回 `REJECT`
- **THEN** runtime 记录该返回不合法的诊断
- **AND** 主流程继续

#### Scenario: Non-blocking mutation is ignored

- **WHEN** 一个 `NON_BLOCKING` hook 返回 mutation
- **THEN** runtime 不应用该 mutation
- **AND** 后续流程继续基于原 effective boundary 运行

### Requirement: Hook execution failures fail open with explicit evidence

当 hook 超时、抛错、不可用或返回非法结果时，runtime SHALL 统一按 fail-open 处理 hook 自身失败：

- 记录失败观测事实后继续主流程
- 不得因为这类执行失败终止请求

系统 MUST NOT 静默吞掉 hook 失败，也 MUST NOT 无限等待 hook 完成。

#### Scenario: Timeout leaves evidence and preserves flow

- **WHEN** 某个 `BLOCKING` hook 超时
- **THEN** runtime 记录 `TIMEOUT` 观测事实
- **AND** 主流程继续

#### Scenario: Exception leaves evidence and does not stop the request path

- **WHEN** 某个 `BLOCKING` hook 抛错
- **THEN** runtime 记录 `FAILED` 观测事实
- **AND** 当前请求继续主流程

### Requirement: Every hook invocation produces a structured observability fact

每次 hook invocation MUST 形成一条 `HookInvocationEvent`。它至少 MUST 能追溯：

- `requestRunId`
- `sessionId`
- `requestId` (the root user message id for the run)
- `hookId`
- `bindingId?`
- `agentId`
- `agentVersion`
- `stage`
- invocation `status`
- 时间信息
- `decision`
- `safeReason` 或 `error`
- `mutationSummary`

`HookInvocationEvent` 是结构化观测事实，不是 canonical timeline event，也不是业务真相对象。首版至少 MUST 输出结构化日志和 hook 指标；可以被 audit sink 消费，但不要求提供独立查询 API。

#### Scenario: Successful invocation emits a hook observability fact

- **WHEN** 某个 hook 正常完成
- **THEN** 系统形成一条 `HookInvocationEvent`
- **AND** 该事件可被日志和指标消费

#### Scenario: Failed invocation still emits a hook observability fact

- **WHEN** 某个 hook 超时、抛错或返回非法结果
- **THEN** 系统仍形成一条 `HookInvocationEvent`
- **AND** 其中包含安全的失败状态与诊断信息

### Requirement: Lifecycle-changing hook outcomes create timeline-only evidence without default client projection

只有当 hook 结果改变 request lifecycle 时，runtime SHALL 形成 timeline-only `HOOK_DECISION_APPLIED` evidence，例如：

- `REJECT` 导致请求失败或拒绝
- `PEND` 导致请求挂起等待用户输入

首版 `HOOK_DECISION_APPLIED` MUST NOT 默认映射成新的用户可见 `StreamEventType`。

#### Scenario: Reject creates lifecycle evidence but not a new client stream type

- **WHEN** 某个 hook 的 `REJECT` 改变了请求生命周期
- **THEN** runtime 写入 timeline-only `HOOK_DECISION_APPLIED`
- **AND** 不新增对应的用户可见 stream event type

#### Scenario: Pending creates lifecycle evidence tied to the waiting state

- **WHEN** 某个 hook 的 `PEND` 导致请求进入等待用户输入状态
- **THEN** runtime 写入 timeline-only `HOOK_DECISION_APPLIED`
- **AND** 下游可将该 evidence 与 pending input truth 关联

#### Scenario: Pending answer reception reuses existing client-visible input events

- **WHEN** 某个由 lifecycle hook 触发的 pending input 被正式回答
- **THEN** runtime 继续沿用既有 `USER_INPUT_RECEIVED` 与 canonical timeline 事实
- **AND** 不为 hook 恢复路径新增专用的用户可见 stream event type

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
