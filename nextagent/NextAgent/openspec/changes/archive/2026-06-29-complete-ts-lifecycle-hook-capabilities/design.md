## 目标上下文（Context）

Lifecycle hook 是 runtime-owned request lifecycle 的治理扩展点。它必须在固定 stage 上运行，由 app composition 在启动期注册并冻结，由 accepted run 的 `agentId` 决定 Agent 级生效范围，由 runtime 统一解释 outcome、应用 mutation、创建 pending input、输出观测事实。

本 change 的 `PEND` outcome 和 pending input creation/resume 行为必须建立在已归档的 `refine-ts-pending-input-contracts` contract 之上。实施不得在 pending input 三对象、answer shape、runtime pause outcome、gateway fact query 或 resolve idempotency 上创建平行 DTO、Record、status 或 control signal。

完整 hook 设计需要同时满足四类目标：

- stage 覆盖：developer-facing `LifecycleHook` interface / `defineLifecycleHook(...)` helper、startup composition hook registry、`agent.yaml.hooks`、runtime executor、恢复入口和测试使用同一份 9 stage vocabulary。
- 开发者入口：开发者通过 `defineLifecycleHook(...)` 定义一个满足 `LifecycleHook` interface 的 hook implementation object，identity、effects、支持 stage、失败策略、可选配置校验、可选装配期 `configure` 和 `execute` 同处一个对象；现有 Agent package 配置只表达启用、关闭、stage 收窄、相对定位、timeout 和 config。
- 副作用模型：`OBSERVE`、`TRANSFORM`、`CONTROL` 是可组合的 effect 集合，执行策略完全由 effects 派生；`OBSERVE` 可以承载有界、幂等、不影响当前流程的观察/通知类副作用。
- 治理结果：runtime 只接受 canonical outcome、stage-specific mutation 和 pending intent，并为失败、降级、控制结果和 mutation summary 产生安全证据。

这个 change 的相关方包括：

- `agent-contracts/runtime`：拥有 hook effects、outcome、boundary/mutation 和 invocation event vocabulary。
- `agent-runtime`：拥有 lifecycle hook executor、控制结果解释、pending input、timeline-only evidence 和 stage invocation API，但不拥有所有 stage 的物理触发位置，也不依赖 stage owner implementation packages。
- `agent-core`：在 agent loop 内拥有 `BEFORE_PLANNING`、capability 和 `BEFORE_AGENT_TERMINAL` 的触发位置，提供 stage facts，并消费 runtime 返回的 effective boundary。
- `agent-model`：拥有所有 provider invocation 前后的 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` 触发位置，确保任何模型调用路径都经过同一个 model hook boundary；只允许通过 `agent-contracts/runtime` 的 hook stage invocation contract 协作，不导入 runtime implementation 或 runtime state contracts。
- `agent-context-engine`：拥有 context compaction 真实执行边界，负责在 summary generation 前触发 `BEFORE_CONTEXT_COMPACT`，并在 summary draft 生成且通过基础校验后、`commitCompaction` 持久化之前触发 `AFTER_CONTEXT_COMPACT`；只允许通过 `agent-contracts/runtime` 的 hook stage invocation contract 协作，不导入 runtime implementation 或 runtime state contracts。
- `agent-app`：唯一启动期 hook registry 与 Agent package assembly owner，负责接收 app/plugin composition 已装配的 hook objects、`agent.yaml` hooks parser / compiler、frozen snapshot，并把 `agent-runtime` hook executor implementation 注入给各 stage owner 消费的 hook invocation contract。
- `agent-observability` / app composition：从 timeline-only `HOOK_INVOKED` 投影安全日志、指标和审计。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让 runtime contract、startup composition hook registry、stage invocation API、各 stage owner 和测试都完整支持 9 个 stage。
- 明确 developer-facing `LifecycleHook` interface、`defineLifecycleHook(...)` helper、单一 hook implementation object、`agent.yaml.hooks` 和系统默认绑定的开发者可见边界。
- 引入唯一 hook effects 模型：`OBSERVE`、`TRANSFORM`、`CONTROL`，同一个 hook 可以声明多个 effect。
- 让执行策略由 effects 决定：只有 observe-only hook 并行观察，任何包含 `TRANSFORM` 或 `CONTROL` 的 hook 串行影响型执行。
- 补齐 stage-specific mutation 的安全校验和 runtime-owned 应用路径。
- 明确 `PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND` 的 outcome 语义。
- 强化 `SYSTEM` hook fail-closed 校验。
- 保持 hook code startup-composed、frozen snapshot 和 runtime-owned lifecycle boundary 不变。

**非目标：**

- 不引入远端 hook、脚本 hook、shell hook、非 TypeScript hook runtime、模型生成 hook 或运行期热加载。
- 不引入 hook 目录配置、manifest 或运行期目录扫描；开发者实现 hook 后如何贡献到系统由后续 plugin composition change 定义。
- 不新增 `agent-contracts/hook` owning surface。
- 不让 hook code 直接拥有 RequestRun、checkpoint、terminal commit、channel projection、gateway persistence、owner scope 或 agent scope。
- 不把 risk policy 改造成 lifecycle hook；risk policy 仍由独立 change 和 port 管理。
- 不为并行 `TRANSFORM` / `CONTROL` 定义合并规则。
- 不新增 hook invocation 查询 API；本 change 只要求日志、指标和可选 audit sink 消费。
- 不实现异步、延迟、fire-and-forget effect hook 或由 hook 承载业务命令通道；`OBSERVE` 仅覆盖当前 stage 内有界等待的、幂等的、非流程影响观察/通知类副作用。

## 设计决策（Decisions）

### D-1. Current State And Minimal Delta

当前代码基线已经存在一版薄 hook 能力：

- `openspec/specs/ts-core-contracts/spec.md` 的 frozen hook / pending baseline 仍以 `HookExecutionMode`、`HookDecision`、`AgentHookBinding`、`HookInput.config`、`HookInvocationEvent.decision`、单独的 `HOOK_OUTCOME_APPLIED` 和 “SYSTEM hook 不可被 Agent binding 禁用”作为稳定语义。本 change 必须作为 core contract refinement 显式修改该 baseline，而不是只在 lifecycle hook change 内部覆盖。
- `agent-contracts/runtime` 暴露 `LifecycleHookDefinition`、`AgentHookBinding`、`LifecycleHookPort`、`HookExecutionMode = BLOCKING | NON_BLOCKING`、`HookDecision = NO_OPINION | APPROVE | REJECT | PEND`、`HookInput.config` 和 `HookInvocationEvent.decision`。
- `agent-app` 当前存在一条临时目录加载路径：从目录 manifest / `hook.json` 读取 `executionMode` 和 `bindings`，再从本地模块中抽取 `invoke(input, signal)`，并在启动期生成 `LifecycleHookDefinition`、`AgentHookBinding` 和 `RegisteredLifecycleHookPort`。
- `agent-app` configuration boundary 仍派生 `hooksRoot`，`create-app.ts` 仍调用 hook directory loader，`testing.ts` 仍导出 `loadHookDirectoryForSystemConfig`，长期设计 `configuration-boundary.md` 仍把 `hooksRoot` 描述为 trusted product hook source root。
- 当前 `agent.yaml` parser / AgentAssembly compiler 不拥有 lifecycle hook activation，`AgentAssembly` 也没有 runtime-facing `hooks` activation facts。
- 当前 `agent-core` 的 `default-agent` 已有若干临时 stage 触发：`BEFORE_PLANNING` 只覆盖初始 planning round，`BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` 在 core 内围绕模型调用触发，`BEFORE_CONTEXT_COMPACT` / `AFTER_CONTEXT_COMPACT` 在 core render / checkpoint 路径触发，正常退出分支直接发送 final-content event。这些实现只能作为迁移前状态；目标实现必须把触发点迁移到本 design 定义的 owner 和 protected operation 边界。
- 当前 hook 调用入口挂在 `AgentRunStatePort.invokeLifecycleHook?` 上，适合 runtime/core 临时接线，但不能作为 `agent-model` / `agent-context-engine` 的跨 owner contract。目标实现必须抽出独立 `LifecycleHookInvocationPort` 并由 app composition 注入。

本 change 不与上述旧模型并存。实施必须做最小替换：

- 修改 `ts-core-contracts` frozen baseline：`HookExecutionMode` / `HookDecision` / independent `AgentHookBinding` / 单独的 `HOOK_OUTCOME_APPLIED` 不再是目标核心契约，`SYSTEM` hook 可以被当前 Agent 显式关闭。
- 用 `HookEffect[]` 和 effects-derived execution strategy 替换 `HookExecutionMode`。
- 用 `HookOutcome = PASS | SKIP | DENY | BLOCK | PEND` 替换 `HookDecision`，并将 `HookResult.decision`、旧 `HookInvocationEvent.decision` 和 runtime lifecycle result 中的 decision 字段更新为 outcome 语义；hook invocation evidence 统一进入 `HOOK_INVOKED` timeline event。
- 用 `AgentAssembly.hooks` entry 替换独立 `AgentHookBinding`，hook activation scope 来自 containing `AgentAssembly`，不再在每条 entry 上携带 `bindingId`、`agentId`、`agentVersion` 或 `agentAssemblyRef`。
- 从 runtime `HookInput` 删除装配期 `config`；config 只在启动期经 `configSchema` 校验后传给 `configure(config)` 或等价 closure creation。
- 移除临时目录加载路径作为产品 hook 贡献路径；本 change 的 app composition 只接收显式提供的 `LifecycleHook` implementation objects，并把后续 plugin composition 贡献的 hooks 视为 already-composed startup inputs。
- 移除目录 manifest 语义和目录扫描路径；hook 本体语义只来自 `LifecycleHook` implementation object，Agent activation 只来自 `agent.yaml.hooks`。
- 清理 `hooksRoot` / `configRoot/hooks` 派生配置、hook directory loader 产品代码、`loadHookDirectoryForSystemConfig` / `HookDirectoryLoadResult` 测试导出、`create-app.ts` loader 接入、`hook.json` manifest loading 语义和 configuration-boundary 长期描述；配置层不得再把 hook 实现目录作为 trusted source root。

### D0. Hook 本体使用 interface + helper，runtime 内部分离 Definition 和 Executable

选择：开发者通过 `defineLifecycleHook(...)` 定义一个满足 `LifecycleHook` interface 的 hook implementation object，identity、effects、支持 stage、失败策略、可选配置校验、可选装配期 `configure` 和 executable 同处一个对象；现有 Agent package 配置通过 `agent.yaml.hooks` 表达该 Agent 如何启用、关闭、收窄、定位或配置 hook。app composition 在启动期接收系统内置 hook objects 和后续 plugin composition 已装配的 hook objects，并 materialize 为 runtime 内部的 code registration 和 `LifecycleHookDefinition`；Agent assembly compiler 将 `agent.yaml.hooks` 编译为 `AgentAssembly.hooks`。

- `LifecycleHook` interface 是开发者可见的结构化 contract；`defineLifecycleHook(...)` 是 canonical authoring helper，负责保留 literal type、推导 config 类型、统一字段名和触发启动期静态 shape 校验，并返回满足 `LifecycleHook` interface 的 hook implementation object。产品路径中的 hook 定义必须经该 helper 进入 composition；测试直连的 `LifecycleHook` object 也必须经过同一 validator。
- developer-facing `LifecycleHook` interface 只保留有明确消费者的字段：`hookId`、`kind`、`effects`、`supportedStages`、`failureMode`、`execute`，并 MAY include `order`、`timeoutMs`、`configSchema` and `configure`。`SYSTEM` hook MUST include explicit `order` because framework-owned system hooks do not derive order from Agent enablement sequence.
- `hookId` 是唯一稳定身份、绑定键、注册键、诊断标签和同序兜底排序键；不再引入 `name`。如后续出现明确 UI 展示消费者，再由独立 change 增加 display field。
- hook 来源、物理路径或 plugin/source 诊断信息是 app composition 的内部诊断事实，不进入 developer-facing `LifecycleHook` interface 或 runtime definition。
- `execute` 形态为 `(input: HookInput, signal?: AbortSignal) => HookResult | Promise<HookResult>`，其中 `HookInput` 只包含运行期 boundary 和安全运行事实，不包含装配期 config。
- `configure` 形态为 `(config: JsonObject) => LifecycleHookExecutable`，只在启动期由 app composition / assembly 路径调用，用于把已校验 config 闭包进 executable。未提供 `configure` 时使用原始 `execute`。
- `LifecycleHookExecutable` 只承载 canonical `execute`；`configure(config)` 不得返回新的 identity、effects、kind、supported stages、failure mode 或 order。
- developer-facing hook types MUST provide stage-indexed inference rather than leaving stage-specific boundary/mutation narrowing to ad-hoc runtime checks. The public runtime contract MUST define a stage map equivalent to:

```ts
type LifecycleHookStage =
  | "BEFORE_REQUEST_ACCEPT"
  | "BEFORE_PLANNING"
  | "BEFORE_MODEL_INVOKE"
  | "AFTER_MODEL_RESULT"
  | "BEFORE_CAPABILITY_INVOKE"
  | "AFTER_CAPABILITY_RESULT"
  | "BEFORE_CONTEXT_COMPACT"
  | "AFTER_CONTEXT_COMPACT"
  | "BEFORE_AGENT_TERMINAL";

interface HookBoundaryByStage {
  BEFORE_REQUEST_ACCEPT: RequestAcceptBoundary;
  BEFORE_PLANNING: PlanningBoundary;
  BEFORE_MODEL_INVOKE: ModelInvokeBoundary;
  AFTER_MODEL_RESULT: ModelResultBoundary;
  BEFORE_CAPABILITY_INVOKE: CapabilityInvokeBoundary;
  AFTER_CAPABILITY_RESULT: CapabilityResultBoundary;
  BEFORE_CONTEXT_COMPACT: ContextCompactBeforeBoundary;
  AFTER_CONTEXT_COMPACT: ContextCompactAfterBoundary;
  BEFORE_AGENT_TERMINAL: AgentTerminalBoundary;
}

interface HookMutationByStage {
  BEFORE_REQUEST_ACCEPT: never;
  BEFORE_PLANNING: PlanningMutation;
  BEFORE_MODEL_INVOKE: ModelInvokeMutation;
  AFTER_MODEL_RESULT: ModelResultMutation;
  BEFORE_CAPABILITY_INVOKE: CapabilityInvokeMutation;
  AFTER_CAPABILITY_RESULT: CapabilityResultMutation;
  BEFORE_CONTEXT_COMPACT: ContextCompactBeforeMutation;
  AFTER_CONTEXT_COMPACT: ContextCompactAfterMutation;
  BEFORE_AGENT_TERMINAL: AgentTerminalMutation;
}
```

`HookInput<S>` MUST be a discriminated union keyed by `input.stage`, where `input.boundary` is `HookBoundaryByStage[S]`. `HookResult<S>` MUST bind `mutation` to `HookMutationByStage[S]` for `PASS + TRANSFORM`; stages whose mutation type is `never` must reject mutation at compile time and runtime. The canonical narrowing pattern for multi-stage hooks is `switch (input.stage)`, after which TypeScript narrows both `input.boundary` and the legal mutation shape. Boundary objects do not need an independent `boundary.stage` duplicate for developer ergonomics; if an internal implementation carries one, it MUST be derived from and equal to `input.stage` and MUST NOT be a second authority.
- `defineLifecycleHook(...)` MUST use const-generic or equivalent literal-preserving typing for `supportedStages`. A hook declared with `supportedStages: ["BEFORE_MODEL_INVOKE"] as const` gets `execute(input)` typed only as `HookInput<"BEFORE_MODEL_INVOKE">`, so `input.boundary.messages` and `ModelInvokeMutation` are available without casts. A multi-stage hook gets a union over exactly the declared stages, not the full 9-stage union. Stage narrowing in `AgentAssembly.hooks` may reduce runtime activation but MUST NOT widen the developer hook's supported stage type.
- runtime 内部 `LifecycleHookDefinition` 从开发者 hook implementation object 剥离 executable 后生成，承载 hook identity、支持 stage、hook kind、hook effects、执行策略、失败模式、order、timeout 和可选 config validation。
- `LifecycleHookInvocationPort` 是 `agent-contracts/runtime` 暴露给 stage owner 的独立 hook invocation contract，不属于 `AgentRunStatePort`。其 shape 为 `invoke(request: LifecycleHookInvocationRequest, signal?: AbortSignal): Promise<LifecycleHookInvocationResult>`。`LifecycleHookInvocationRequest` MUST include the stage, accepted run coordinates (`requestRunId`、`sessionId`、`requestId`、`agentId`、`agentVersion`、`agentAssemblyRef`), trusted owner scope reference, stage occurrence / operation coordinate used for idempotency, and the stage-safe immutable boundary. boundary 是 hook 可见的只读 contract，必须避免暴露 stage owner 内部可变对象引用；实现可以用 immutable projection、refs/summaries、structural sharing 或 copy-on-write，不要求每次全量 deep clone。`LifecycleHookInvocationResult` MUST be a discriminated union: `CONTINUE` with the effective boundary, or `INTERRUPT` with the shared lifecycle hook control-interruption signal.
- 当前 `AgentRunStatePort.invokeLifecycleHook?` 只能作为迁移前实现形态。目标实现必须从 `AgentRunStatePort` 的跨 owner public surface 移除该方法，或把它收敛为 `agent-runtime` implementation 内部 adapter；`agent-core`、`agent-model`、`agent-context-engine` 都必须通过 injected `LifecycleHookInvocationPort` 调用 hook，而不是通过 run state port。
- `agent.yaml.hooks` 是新增的 Agent package 权威配置 key。它与现有 `capabilityBindings` 同级，但使用更短的 developer-facing 名称；Agent assembly compiler 在启动期校验并透传为 runtime-facing `AgentAssembly.hooks`。
- `AgentAssembly.hooks` 只声明当前 Agent 如何启用、关闭、收窄或定位 hook：`hookId`、`enabled?`、`disabled?`、`stages?`、`order?`、`timeoutMs?`、`config?`；`agentId`、`agentVersion` 和 `agentAssemblyRef` 来自 compiled assembly，不在每条 entry 中重复作为独立权威输入。`CUSTOM` hook entry MAY provide `order`; `SYSTEM` hook entry MUST NOT override system hook order.
- `config` 是 Agent 对该 hook 的 per-Agent 装配配置。若 hook 定义提供 `configSchema`，assembly compiler MUST 在启动期按该 schema 校验对应 `config`，否则只做 safe JSON object 校验。validated config MUST be consumed only by `configure(config)` during startup materialization and MUST NOT be passed through `HookInput` at runtime。
- `defineLifecycleHook(...)` 不负责注册 hook、不扫描目录、不读取 Agent 配置、不创建 Agent activation；registration、definition materialization、config validation 和 configured executable creation 仍由 app composition / assembly compiler 在启动期完成。
- `configure(config)` 生成的 configured executable 与 definition、AgentAssembly hooks facts 一起冻结，并且必须按 containing AgentAssembly 隔离。相同 `hookId` 被不同 AgentAssembly 使用不同 config 配置时，startup materialization 必须生成彼此隔离的 configured executable；runtime 必须按 accepted run 固化的 `agentAssemblyRef` 选择 executable，不能只按全局 `hookId` 复用最终 executable。runtime 执行时只调用 configured executable 的 `execute(input, signal)`，不得重新解释 config、不得从 config 合成 outcome、mutation、stage 或启用状态。
- `CUSTOM` hook 只有被当前 run 固化的 `agentId` / `agentVersion` / `agentAssemblyRef` 对应 AgentAssembly 显式绑定且未禁用时才生效。
- `SYSTEM` hook 默认对所有 Agent 生效，不需要每个 Agent 显式绑定；开发者可以在当前 Agent 的 `agent.yaml.hooks` 中通过 `enabled=false` 或 `disabled=true` 显式关闭该系统 hook。Agent hooks entry 不得改写系统 hook 的 kind、effects、failure mode 或支持边界。
- 可关闭的 `SYSTEM` hook 仍然是 lifecycle hook default，不是不可绕过的安全不变量。必须强制执行的治理约束应由 runtime guard、risk policy、gateway、sandbox 或 app composition boundary 承载，而不是依赖可被当前 Agent 显式关闭的 lifecycle hook。
- runtime 只使用 accepted run 上固化的 `agentId`、`agentVersion`、`agentAssemblyRef` 和 `AgentAssembly.hooks` 解析 effective hooks，不按默认 Agent、全局配置、hook manifest binding 或请求体重新选择 hook 生效范围。

放弃方案：

- 让所有 custom hook 全局生效：配置简单但违反 Agent Scope，容易让客户系统集成 hook 泄漏到无关 Agent。
- 要求系统 hook 在每个 Agent 上显式绑定：可见但冗余，容易遗漏治理 hook。
- 让 hook manifest 或目录配置携带 Agent activation：会另起一套 Agent 配置入口，绕过 `agent.yaml` 作为 Agent package 权威配置的既有设计。
- 把 hook 本体拆成开发者必须分别维护的 definition 和 executable：实现清楚但开发体验差，容易造成声明和执行逻辑漂移。
- 只接受未命名的裸对象而没有 `LifecycleHook` interface / helper：短期代码少，但类型推导、字段规范、config 类型、静态校验和工具提示都弱，容易把实施细节暴露给开发者。
- 让 Agent binding 也携带 executable：开发体验短期简单，但会复制 hook 本体、破坏启动期 code registration 和复用边界。
- 让 binding 定义处理逻辑：会把配置变成 DSL，绕过 hook code registration 和可测试边界。

### D1. Hook effects 成为唯一副作用权限集合

选择：在 `LifecycleHookDefinition` 增加 `effects: readonly HookEffect[]`，其中 `HookEffect = "OBSERVE" | "TRANSFORM" | "CONTROL"`。`effects` 必须非空、去重，并由该集合决定 hook 允许的副作用。

- `OBSERVE`：允许产生日志、指标、trace、审计、诊断观测事实，以及有界、幂等、不影响当前流程的外部观察/通知类副作用。该副作用结果不得被当前 lifecycle stage 读回并影响 protected operation、effective boundary、pending input、terminal commit、checkpoint 或 runtime-owned truth。
- `TRANSFORM`：允许在 `PASS` outcome 下返回当前 stage 允许的 mutation。
- `CONTROL`：允许返回 `DENY`、`BLOCK`、stage-limited `PEND` 控制 protected operation。
- 所有 hook 都可以返回 `PASS` 或 `SKIP`；`SKIP` 表示不适用且不得携带 mutation 或 pending intent。
- 只有声明 `TRANSFORM` 的 hook 可以携带 mutation；只有声明 `CONTROL` 的 hook 可以返回 `DENY` / `BLOCK` / `PEND`。
- 若同一个 hook 同时声明 `TRANSFORM` 和 `CONTROL`，`PASS + legal mutation` 合法；`DENY` / `BLOCK` / `PEND` 与 mutation 同时出现时控制结果优先，mutation 不应用并记录 diagnostic。
- 对 observe-only hook，runtime MUST 在 `HookInput` 和 `HOOK_INVOKED` 中提供稳定 idempotency key。该 key 对同一 hook 和同一 lifecycle stage occurrence 的恢复重试保持稳定，对合法的新 stage occurrence 保持区分，用于外部观察/通知副作用幂等写入。key 直接使用 `stageOccurrenceKey + ":" + hookId`；`stageOccurrenceKey` 本身不得包含 prompt、model/tool/attachment payload、credential、path 或外部副作用 payload。

`LifecycleHookInvocationCoordinates` 保留完整身份字段供 executor 内部使用，但不再包含 `stageOperationKey`。`HookInput` 顶层暴露 `sessionId`、`requestId`、`requestRunId`、`agentId`、`agentVersion` 和 `agentAssemblyRef`；stage boundary 只包含 stage-specific 字段，不再通过 `RequestScopedHookBoundary` 重复携带身份。`hookInvocationId` 是单次执行尝试的观测 id，恢复重试时可以变化；idempotency key 是同一 stage occurrence 的副作用幂等坐标，恢复重试时必须保持不变。未来如需 per-assembly-config 隔离，可追加稳定 config 版本标识。

stage occurrence key 不是 runtime 全局递增 counter，也不再配套单独的 stage operation key。每个 stage owner 必须传入可从 checkpoint、durable operation id 或当前 lifecycle truth 重建的 occurrence coordinate，且不得依赖恢复后会丢失的进程内自增计数。推荐坐标如下：

| Stage | Replay-stable occurrence coordinate |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | pre-acceptance submit idempotency key、channel request coordinate 或 runtime acceptance attempt id；同一 submit retry 稳定，新 submit 区分 |
| `BEFORE_PLANNING` | planning step id + round index；round index 必须来自可恢复的 agent loop state / checkpoint |
| `BEFORE_MODEL_INVOKE` | step id + round index + model invocation ordinal，或 provider invocation id；同一次 provider call retry 稳定，新模型调用区分 |
| `AFTER_MODEL_RESULT` | same model invocation coordinate + result phase |
| `BEFORE_CAPABILITY_INVOKE` | `toolCallId` + `invocationId` 或可恢复 capability invocation ordinal |
| `AFTER_CAPABILITY_RESULT` | same capability invocation coordinate + result phase |
| `BEFORE_CONTEXT_COMPACT` | compaction operation id、summary idempotency key 或 context compaction idempotency coordinate + before phase |
| `AFTER_CONTEXT_COMPACT` | same real compaction coordinate + after phase；skipped/no-op compaction 没有 after occurrence |
| `BEFORE_AGENT_TERMINAL` | step id + terminal attempt coordinate；hook 返回 toolCalls 后继续 loop，后续 normal-exit attempt 必须使用新 occurrence |

如果 stage owner 不能为当前 stage occurrence 提供可恢复且可区分的 occurrence / operation coordinate，runtime executor 必须 fail closed before executing observe side-effect-capable hooks, because the idempotency contract cannot be satisfied.

放弃方案：

- 使用单一阻塞/非阻塞开关表达所有语义：无法区分 transform 和 control，审查和测试语义薄。
- 使用单一 `OBSERVE` / `TRANSFORM` / `CONTROL` 枚举：会错误地假设三种作用互斥，无法表达同一个 hook 同时观察、修改和控制。
- 引入独立 purpose 与 execution mode 两套枚举：对 TS 当前目标过重，容易出现 purpose/mode 非法组合。

### D2. 执行策略从 effects 派生，不作为可覆盖 binding

选择：runtime 根据 effects 将 hook 分为 observation group 和 serial impact group。

```text
stage hooks
  ├─ observation group: effects == [OBSERVE]
  │    ├─ Promise.allSettled bounded by per-hook timeout
  │    └─ never changes request truth
  └─ serial impact group: effects contains TRANSFORM or CONTROL
       ├─ SYSTEM group before CUSTOM group
       ├─ SYSTEM group: explicit framework order
       ├─ CUSTOM group: Agent declaration sequence, optional priority, optional before/after constraints
       ├─ hookId tie-breaker
       └─ mutation/control applied one-by-one
```

`SYSTEM` hook 整体优先于 `CUSTOM` hook。这个分组优先级不是 Agent 配置项，`CUSTOM` hook 的 `order` 不得把 custom hook 移到 system hook 之前。

`SYSTEM` 组内顺序必须由框架内置 hook 定义显式声明。`SYSTEM` hook definition MUST provide `order.priority`，其中 `priority` 是有界整数，lower value runs earlier。system hook definition MAY additionally use `order.before` / `order.after` 指向同 stage 的 system hook，以表达局部依赖。system hook definition 不得依赖注册顺序作为组内顺序。

`CUSTOM` 组内默认顺序使用当前 Agent `hooks` 数组启用声明顺序。`CUSTOM` hook entry 的 `order` 是可选对象，支持：

- `priority?: integer`：绝对顺序，lower value runs earlier；
- `before?: hookId | hookId[]`：相对定位到同 stage custom hook 之前；
- `after?: hookId | hookId[]`：相对定位到同 stage custom hook 之后。

custom order resolution MUST first use priority when present, then Agent declaration sequence, then apply same-stage `before` / `after` constraints with stable topological sort, and finally use `hookId` as a deterministic tie-breaker. Unknown target、target disabled、target not effective in the same stage、cross-kind target、cycle or contradictory constraints MUST fail closed. `order` MUST NOT accept bare numbers or enum slots; absolute order MUST be expressed as `order.priority`.

`AgentAssembly.hooks` 只能覆盖 `stages`、`order`、`timeoutMs`、`config`，不得覆盖 effects、kind、failureMode 或 execution strategy。

`order.before` / `order.after` targets MUST stay within the same effect group: an observe-only hook's order targets MUST reference other observe-only hooks, and an impact hook's order targets MUST reference other impact hooks. Cross-effect-group order targets MUST fail closed at assembly compile time. This constraint exists because observe-only hooks execute in bounded parallel and have no execution ordering guarantee; an order constraint crossing into the serial impact group would be silently ignored at runtime, misleading the developer. Observe-only hooks' order constraints MAY be recorded on observe invocation evidence for diagnostics, but MUST NOT influence execution order. This model intentionally excludes three dependency patterns: (1) observe-only hooks that need to see impact mutations — such hooks MUST declare `TRANSFORM` and enter the serial impact group; (2) impact hooks that need to consume observe-only results — observe-only results do not flow back into the effective boundary, so such hooks MUST be merged or restructured; (3) observe-only hooks that require serial execution among themselves — such hooks MUST use idempotency keys for external side effects or be restructured as impact hooks. This trade-off keeps the effect model simple (observe = parallel and isolated, impact = serial and boundary-connected) and is acceptable for telecom governance scenarios where observation and impact are typically cleanly separated.

放弃方案：

- 让配置或 Agent activation 显式选择 `parallel` / `serial`：会让 hook 作者绕过副作用约束，把有影响 hook 放进并行组。
- 所有 hook 都串行执行：安全但不能满足“仅记录 hook 并行”目标，也会给审计和指标 hook 增加主路径延迟。
- 暴露裸数字 `order`：短期灵活，但会在多 hook 场景形成魔法数字和稀疏排序约定；使用 `order.priority` 显式命名绝对顺序，并配合 `before` / `after` 能减少误配置。
- 只使用 `EARLY` / `NORMAL` / `LATE` 枚举：配置简单，但无法表达同一分组内多个自定义 hook 的局部依赖，容易退化成命名约定或重复调整数组顺序。

### D3. 影响型 hook 串行归约，observe-only hook 并行隔离

选择：每个 stage 从 startup-materialized `AgentHookSnapshot` 查找 effective hooks，再用 stage entry boundary 启动 observe-only group，随后立即执行 serial impact group。主流程必须等待 serial impact group 结束；stage 返回前必须等待 observe-only group settle-or-timeout。observe-only group 使用有界等待，不得无限拖住主流程。runtime 在 stage 内收集 observe promises，并在 group timeout 后对未完成 invocation 记录 timeout evidence。

并行 observe-only hook 的失败、超时、非法控制输出只产生 `HOOK_INVOKED` 和观测降级，不写 `HOOK_OUTCOME_APPLIED`，不创建 pending input，不改变 effective boundary。observe-only hook 可以在该有界 invocation 内写外部审计、通知、合规追踪、诊断采样、异步分析索引或缓存类观察事实，但必须使用 runtime 提供的 idempotency key 保证恢复重试和重复执行不会产生不可控重复副作用；这些外部副作用的结果不参与当前流程分支判断。声明 `OBSERVE` 且同时声明 `TRANSFORM` 或 `CONTROL` 的 hook 不进入 observe-only group，必须作为 serial impact hook 执行。

Recovery 的 hook 重执行语义以保存的 recoverable lifecycle coordinate 为准。恢复只从该 coordinate 指向的 `nextLifecycleStage` 或 stage occurrence 重新接入；已经完成且不在恢复路径上的早期 stage 不回放。例如从 planning round 2 恢复时，不重新执行 round 1 的 `BEFORE_PLANNING`。如果恢复落点仍位于某个 protected operation 之前，例如 round 1 的 `BEFORE_MODEL_INVOKE`，则该 stage 的 enabled hooks 按 startup-materialized `AgentHookSnapshot` 重新执行，runtime 不缓存、复用或重放上一次 `TRANSFORM` / `CONTROL` hook 的返回结果。

`TRANSFORM` / `CONTROL` hook 必须被视为可重试的 impact hook。runtime 只保证同一恢复坐标使用同一 frozen hook snapshot、同一 stage boundary 构造规则和同一 mutation/control 解释规则；runtime 不为 `TRANSFORM` / `CONTROL` 提供 observe side-effect idempotency key，也不保证外部读取结果一致。hook 作者如果在 impact hook 中读取外部配置、策略或客户系统状态，必须自行通过 frozen config、版本化引用、hook-managed cache 或幂等/确定性读取保证恢复重执行不会破坏流程一致性。需要外部副作用幂等写入的能力应建模为 observe-only hook 或 hook 自己管理的幂等机制，不能依赖 runtime 对 impact hook 做结果去重。

放弃方案：

- observe fire-and-forget：延迟最低，但请求结束时可能丢失 hook evidence，恢复和审计不可控。
- observe 完全阻塞到所有完成：会让仅记录 hook 影响主路径容量和 tail latency。
- 持久化并回放 `TRANSFORM` / `CONTROL` hook 返回结果：可以避免重执行带来的外部读取差异，但会把 hook output 变成新的 request truth / recovery fact，扩大持久化、脱敏和版本兼容范围；首版保持 owner recovery coordinate + frozen snapshot 重执行模型。

### D4. Stage mutation 由 runtime contract 定义，应用由 stage owner 消费

选择：`agent-contracts/runtime` 保留所有 stage-specific mutation 类型，runtime executor 做通用校验和归约，具体消费点由 stage owner 应用：

| Stage | Owner | Mutation | Developer-visible transform target |
|---|---|---|---|
| `BEFORE_REQUEST_ACCEPT` | runtime | none | none |
| `BEFORE_PLANNING` | agent-core planning turn | `PlanningMutation` | effective planning-turn input before model request construction |
| `BEFORE_MODEL_INVOKE` | agent-model provider boundary | `ModelInvokeMutation` | effective model invocation request / safe provider options |
| `AFTER_MODEL_RESULT` | agent-model provider boundary | `ModelResultMutation` | effective normalized model result projection consumed downstream |
| `BEFORE_CAPABILITY_INVOKE` | agent-core tool loop | `CapabilityInvokeMutation` | effective capability invocation input / safe invocation options |
| `AFTER_CAPABILITY_RESULT` | agent-core tool loop | `CapabilityResultMutation` | effective `CapabilityInvocationResult` consumed by the tool loop |
| `BEFORE_CONTEXT_COMPACT` | agent-context-engine compaction boundary | `ContextCompactMutation.before` | effective target budget for the current compaction operation |
| `AFTER_CONTEXT_COMPACT` | agent-context-engine compaction boundary | `ContextCompactMutation.after` | effective compaction result before persistence |
| `BEFORE_AGENT_TERMINAL` | agent-core loop | `AgentTerminalMutation` | effective agent-loop terminal decision: final content or continuation tool calls |

runtime executor 负责校验 mutation kind 与 stage、effects 匹配，并通过单一通用 `reduceBoundaryMutation` 归约为该 stage 的 effective boundary，同时生成 mutation summary；stage owner 负责把 effective boundary 映射到实际 planning input、model request/result、capability invocation/result、context compaction 或 agent terminal decision。

字段级 mutation 使用 closed object contract 和单一字段替换语义。`reduceBoundaryMutation` 对所有 stage 使用同一规则：mutation 中出现的字段完整替换当前 effective boundary 的同名字段，未出现字段保持不变；hook 要表达追加、删除或过滤时，基于当前 boundary 计算并返回完整替换后的字段值。stage-specific 逻辑只负责 mutation schema、allowed fields 和字段安全 invariant validation。首版字段范围：

| Mutation | Allowed fields |
|---|---|
| `PlanningMutation` | `flowVariables`、`capabilityGeneratedMessages`、`capabilityContextPatch`、`maxRounds`、`maxCalls` |
| `ModelInvokeMutation` | `messages`、`tools`、`commonOptions`、`providerOptions`、`timeoutMs` |
| `ModelResultMutation` | `content`、`reasoning`、`toolCalls` |
| `CapabilityInvokeMutation` | `arguments`、`timeoutMs` |
| `CapabilityResultMutation` | `structuredPayload`、`generatedMessages`、`contextPatch` |
| `ContextCompactMutation.before` | `targetBudgetUnits` |
| `ContextCompactMutation.after` | `content` |
| `AgentTerminalMutation` | `finalContent`、`toolCalls` |

这些字段只修改当前 stage 的 effective boundary。字段值必须通过 stage owner 的现有 schema、size、redaction 和安全 invariant 校验；未知字段、越界值、owner/agent override、credential、local path、除 stage contract 明确允许字段之外的 raw prompt/model/tool/attachment content 或 runtime state mutation 都必须 fail closed。mutation summary 必须记录 mutation kind、replaced field names，以及每个替换字段的 safe size/count/digest，不记录字段值。

`BEFORE_MODEL_INVOKE` 是一个有意暴露完整 model request boundary 的例外：因为 `ModelInvokeMutation.messages` 允许 hook 完整替换当前 `ModelInvocationRequest.messages`，该 stage 的 hook code 必须能够在内存中读取当前 effective `messages`，其中可能包含完整 prompt、对话历史、系统指令和 context assembly 结果。`HOOK_INVOKED`、mutation summary、logs、metrics、audit 和 safe diagnostics 的 redaction 规则仍然禁止输出 raw prompt / messages；但这些规则不限制被 startup-composed、当前 Agent 启用并执行到该 stage 的 hook implementation 在进程内访问 boundary 内容。这个访问面必须通过 hook registration、AgentAssembly activation、SYSTEM/CUSTOM kind、code review、权限治理和 no dynamic loading 约束控制，不能被误表述为 observability redaction 可以阻止 hook code 读取 messages。

`messages` boundary 也有明确性能成本。大 context 下，`ModelInvocationRequest.messages` 可能达到数十 KB 或更大；`BEFORE_MODEL_INVOKE` 每次 provider invocation 都把 effective messages 暴露给 hook boundary，会增加对象投影、readonly view / structural sharing、validation 和 replacement detach 的开销。首版接受这个成本作为 `TRANSFORM` 语义的必要代价：要让 hook 可靠改写 model request，就必须给 hook 当前 effective request。实现应避免不必要 full-boundary deep clone，优先使用 readonly projection / structural sharing，并只对 accepted `messages` replacement 做 detach/canonical clone、size validation 和安全 invariant validation。

跨 stage 的间接影响通过 stage owner 的正常执行链路自然传递，runtime 不维护跨 stage boundary 继承或全局 effective boundary 缓存。stage owner 消费当前 stage 的 effective boundary 后，后续业务对象和后续 stage boundary 必须由该 owner 的真实执行结果重新构造。例如 `BEFORE_PLANNING` 修改 `flowVariables` 后，context assembly 使用 modified planning input 生成新的 model request，`BEFORE_MODEL_INVOKE` 看到的是该新请求的 `messages`；`BEFORE_MODEL_INVOKE` 修改 `messages` 后，provider 输出变化，`AFTER_MODEL_RESULT` 看到的是基于该 provider 输出归一化后的 result。实现不得复用 mutation 前的旧 boundary 快照构造后续 stage。

HookBoundary 是提供给 hook 的只读 stage context，不是可被 patch 的对象。boundary 字段必须按 readonly contract 暴露，且不得暴露 stage owner 内部可变对象引用；对大对象优先使用 immutable projection、stable ref、digest、count 或 safe summary。TypeScript `readonly` 只是开发期类型约束，不是运行期不可变保护。每个 stage owner 在调用 `LifecycleHookInvocationPort` 前必须完成 boundary finalization，并为每个暴露字段选择一种明确的运行期策略：

| Strategy | Use case | Runtime requirement |
|---|---|---|
| immutable projection | 暴露 hook 需要读取的结构化字段，例如 model messages、tool descriptors、context patch projection | 构造新的 projection object / array graph，且不得复用 owner-owned mutable object reference；实现可以 shallow/focused clone 到暴露深度，并在测试或生产中 freeze exposed graph |
| stable ref / digest / count / safe summary | hook 不需要完整内容、只需要识别或统计事实 | boundary 只暴露不可反向读取 raw object 的 ref、digest、count 或 summary |
| structural sharing | 源对象已由 owner 声明为 immutable value，或已通过 finalization 变成 immutable projection | 共享对象不得被 owner 后续原地修改；如果 owner 仍持有可变引用，则不能 structural share |
| copy-on-write / lazy projection | 大字段需要避免立即全量复制 | hook 可见对象必须表现为 immutable；任何 accepted replacement 仍必须 detach/canonical clone 后再应用 |

boundary finalization 的最低验收是：hook 对 received boundary 的原地修改不会改变 stage owner 内部对象、当前 effective boundary 或后续 protected operation input；stage owner 在 hook invocation 之后对自身 mutable objects 的修改也不会回写到已经交给 hook 的 boundary snapshot。实现可以在开发/测试路径使用 `Object.freeze` / deep freeze / proxy guard 发现违规，在生产路径使用 immutable projection、stable refs、structural sharing 或 copy-on-write；不要求对整个 boundary 做 full deep clone。

hook 若要基于 boundary 修改某个字段，必须构造新的 mutation replacement value，不能原地修改 boundary 或依赖对象引用副作用。runtime reducer 和 stage owner 只需要对 accepted mutation 中出现的 replacement fields 做 detach/canonical clone、schema validation 和安全 invariant validation；未修改字段可以 structural sharing，不要求全量复制。accepted mutation replacement 必须在应用前 canonicalize 到 owner-owned value，例如通过 schema parse、structured clone、field-specific projector 或 typed DTO constructor，且后续 hook 对原 replacement object 的修改不得影响 applied effective boundary。BoundaryMutation 只能表达当前 stage owner 允许的 effective boundary delta，不能覆盖 boundary 中的事实字段。尤其是 context compact：

- `BEFORE_CONTEXT_COMPACT` 的 boundary 可以暴露安全预算事实、source counts、covered refs summary 和 compaction reason；mutation 只能调整 context engine 当前 compaction operation 的目标预算，不得改写预算证据、raw message sources、active context version、owner/agent scope 或持久化 compaction truth；
- `AFTER_CONTEXT_COMPACT` 在 summary draft 生成并通过基础校验后、`commitCompaction` 持久化之前触发；mutation 可以调整将被提交的 effective summary draft `content`，使 hook 有机会补充压缩遗漏的关键上下文。该 mutation 仍由 context-engine owner 应用，不得直接写 DB，不得改写 source/retained refs、summary idempotency key、active context version、compression evidence、checkpoint 或 terminal truth。

`agent-context-engine` 的 hook 接入需要一个明确的 composition 依赖入口。`DefaultContextEngineDependencies`（或等价 context engine factory dependencies）MUST accept an injected `LifecycleHookInvocationPort` from `agent-contracts/runtime`. `agent-app` MUST pass the `agent-runtime` executor adapter when composing `createDefaultContextEngine(...)`; tests or no-hook compositions MAY pass an explicit no-op implementation, but `agent-context-engine` MUST NOT import `agent-runtime`, read a global runtime singleton, or call `AgentRunStatePort`. `assemble-context` MUST carry that port into the summary compression path, and `runSummaryCompression(...)` / the summary compression orchestrator dependencies MUST accept it explicitly alongside `summaryGenerator` and `commitCompaction`.

The compaction orchestrator insertion point is:

1. Build the compaction operation coordinate from the current context assembly request, source active context version, covered/retained refs and the compaction idempotency coordinate.
2. Invoke `BEFORE_CONTEXT_COMPACT` before summary generation consumes the target budget, consume the effective `targetBudgetUnits`, and then call `TraceableSummaryGenerationPort.generate(...)` with the effective budget.
3. Validate the generated `TraceableSummaryDraft` using context-engine draft invariants.
4. Invoke `AFTER_CONTEXT_COMPACT` after draft validation and before building the final persisted summary message / calling `commitCompaction`.
5. Apply `ContextCompactMutation.after.content` by replacing the effective draft content, then build the `SessionMessage` / `SessionMessageRecord` from that mutated effective draft.
6. Call `commitCompaction` with the mutated summary message and the original retained-tail / active-context CAS facts.

The current `default-agent.render` / checkpoint-adjacent compact hook is migration state only. `CONTEXT_COMPACTED` checkpoint or runtime timeline evidence observes the result after context-engine compaction; it is too late to apply `AFTER_CONTEXT_COMPACT` content mutation and MUST NOT remain the target trigger point.

依赖方向必须保持现有架构防火墙：

- `agent-runtime` 可以拥有 hook executor、pending creation、`HOOK_INVOKED` timeline evidence 和 runtime contract，但不得导入 `agent-core`、`agent-model`、`agent-context-engine` 或其它 stage owner implementation package；
- `agent-core` 已允许依赖 `agent-contracts/runtime`，因此可直接消费 injected `LifecycleHookInvocationPort`，但仍不得依赖 `agent-runtime` implementation；
- `agent-model` 和 `agent-context-engine` MAY import `agent-contracts/runtime` only for lifecycle hook stage invocation symbols: stage vocabulary, hook boundary/mutation/result types, `LifecycleHookInvocationPort` / request / result types, and the shared lifecycle hook control-interruption signal used to propagate `DENY` / `BLOCK` / `PEND` back to the runtime lifecycle boundary. They MUST NOT consume `AgentRunStatePort`、checkpoint writer/query types、timeline writer/query types、terminal commit types、runtime command/session ports、RequestRun store facts or any runtime state mutation contract；
- `agent-model` 和 `agent-context-engine` MUST NOT import `agent-runtime` implementation package；runtime executor implementation 只能由 `agent-app` composition 作为 `LifecycleHookInvocationPort` 注入给 `agent-core`、`agent-model` 和 `agent-context-engine`。`agent-app` 可以把同一个 runtime executor adapter 注入给多个 stage owner；stage owner 不得自行构造 executor 或从 global runtime singleton 获取 executor；
- dependency-cruiser contract subpath allowlist MAY be updated to include `runtime` for `agent-model` and `agent-context-engine`, but architecture/source-level assertions MUST enforce the symbol-level restriction above；
- capability hook 首版不下沉到 `agent-capability`。`BEFORE_CAPABILITY_INVOKE` / `AFTER_CAPABILITY_RESULT` 的 owner 仍是 `agent-core` tool loop，因为它们保护的是 agent loop 中的 capability invocation、effective `CapabilityInvocationResult` consumption、model-visible payload generation 和 loop continuation，而不是 capability implementation 自身生命周期。

stage 触发位置必须贴近真实 owner，而不是全部集中在 runtime 外层：

- `BEFORE_REQUEST_ACCEPT` 由 `agent-runtime` 在 request acceptance 边界触发；
- `BEFORE_PLANNING` 由 `agent-core` 在 agent loop 内每个 planning turn 调用模型之前触发，位置必须在请求/技能路由和 routing constraints 已解析、当前 planning turn 的工具结果/上下文输入已确定之后，且在 context assembly / model request construction 之前；boundary MUST expose the round index, step id, effective step limits and current-run planning inputs including request-local capability effects accumulated from previous rounds. It MUST follow the common boundary immutability rule and MUST NOT include speculative round-N outputs that have not yet been produced. It cannot replace the model provider boundary `BEFORE_MODEL_INVOKE`；
- `BEFORE_MODEL_INVOKE` 由 `agent-model` 在每一次 provider invocation 前触发，位置必须在 `ModelInvocationRequest` 已构造、provider SDK 尚未调用之间；agent loop、fallback、context/prompt、评估或后续其他模型调用路径不得绕过该边界；
- `AFTER_MODEL_RESULT` 由 `agent-model` 在 provider result normalization 后、返回 caller 前触发；agent loop 之外的模型调用路径不得绕过该边界；
- `BEFORE_CAPABILITY_INVOKE` 由 `agent-core` tool loop 在 tool call 已解析为 capability id、descriptor / routing constraints / subagent guard 已通过、具体 `CapabilityInvocationRequest` 已构造之后触发，位置必须在 `CAPABILITY_BEFORE_CALL` checkpoint、`CAPABILITY_STARTED` event 和 `capabilityInvocation.invoke(...)` 之前；hook 返回的 effective boundary 是本次调用的 `arguments` / `timeoutMs`；
- `AFTER_CAPABILITY_RESULT` 由 `agent-core` tool loop 在 `capabilityInvocation.invoke(...)` 返回 raw result 且 basic `CapabilityInvocationResult` envelope validation 通过之后触发，位置必须在 effective result validation、status-specific handling、request-local result effects、`buildModelVisibleCapabilityPayload(...)`、capability result message append 和 capability completion event 之前；hook 返回的 effective boundary 是 tool loop 后续消费的 `CapabilityInvocationResult` 可变字段；
- `BEFORE_CONTEXT_COMPACT` / `AFTER_CONTEXT_COMPACT` 由 `agent-context-engine` 的真实 compaction 边界触发；`BEFORE_CONTEXT_COMPACT` 在 summary generation 前调整目标预算，`AFTER_CONTEXT_COMPACT` 在 summary draft 生成后、commitCompaction 持久化前调整 effective compaction result，不覆盖 skipped/no-op 路径；
- `BEFORE_AGENT_TERMINAL` 由 `agent-core` 在 agent loop 判断当前 accepted run 可以正常退出、没有来自模型的待执行 tool calls、最终 agent output 已形成之后触发，位置必须在 agent-core 发送任何 final-content user-visible event 之前，也必须在 agent loop 完成返回之前；该 stage 的 effective boundary 初始 `toolCalls` 为空。hook-mutated `finalContent` MUST be the content emitted by agent-core's final event, so the runtime-owned run output collected from that event becomes the terminal commit input. hook-mutated non-empty `toolCalls` 表示本次 terminal decision 被替换为 continuation decision：agent-core MUST NOT emit the final-content event for that attempt, and MUST route those tool calls through the existing tool loop before continuing the next planning/model round. `toolCalls` MUST pass the same capability descriptor, routing constraints, subagent guard, input schema, `maxCalls` and remaining round-budget validation as model-produced tool calls, and MUST still pass `BEFORE_CAPABILITY_INVOKE` / `AFTER_CAPABILITY_RESULT`. 非空 `toolCalls` 与 `finalContent` replacement MUST NOT appear in the same mutation result. 该 hook 的 mutation 不得修改 final event type、`final` flag、terminal status、terminal message id、terminal commit metadata、run status 或任何 runtime terminal truth。该 hook 不要求修改 `Agent.execute(...)` 返回契约，也不要求 agent-core 额外返回 effective handoff 给 runtime。runtime terminal commit、cancel、supersede 或 runtime failure terminal path 不拥有该 hook，旧 `BEFORE_AGENT_TERMINAL` vocabulary 和 terminal-commit 触发点必须移除。

因此，当前 runtime 在 `agent.execute()` 前触发的旧 `BEFORE_MODEL_INVOKE` 只能作为迁移前状态；目标实现必须移除这个外层 pre-agent hook 调用，不能用它同时代表 `BEFORE_PLANNING` 和 `BEFORE_MODEL_INVOKE`。当前 `default-agent` 内的 core-level 临时触发也必须按 owner 迁移：planning hook 扩展为每个 planning turn 的 core boundary，model invoke/result hook 下沉到 `agent-model` provider boundary，context compact hook 下沉到 `agent-context-engine` compaction boundary，terminal hook 插入 normal-exit final-content event 之前。

放弃方案：

- executor 直接改 model request / capability result / context assembly 对象：会让 runtime 拥有 core/context 业务语义，破坏 owner 边界。
- 使用 generic JSON Patch：灵活但不可审计，容易泄漏和破坏安全字段。

### D5. Hook outcome 使用 `PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND`

选择：hook contract 使用 `HookOutcome` 表达 hook 执行结果。`PASS` 表示 hook 已执行且允许继续；`SKIP` 表示 hook 已进入但自行判断不适用于当前 run；`DENY` 表示治理拒绝，映射到 policy/security/validation denied 类 safe failure；`BLOCK` 表示条件不满足或执行保护阻断，映射到 blocked/precondition/unavailable 类 safe failure；`PEND` 表示可恢复等待并创建 pending input。

`PEND` 只允许在可以安全暂停、等待外部输入后从同一 frozen run 恢复、且 protected operation 尚未执行的 before-stage 使用。首版支持 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL`。`BEFORE_REQUEST_ACCEPT` 不支持 `PEND`，因为 run 尚未 accepted，pending input 不应混入 admission。`BEFORE_PLANNING` 是独立 agent-core hook point，但首版暂不开放 `PEND`，因为 planning pause/resume checkpoint、回答后继续位置和可见状态尚未被本 change 单独定义。`AFTER_MODEL_RESULT`、`AFTER_CAPABILITY_RESULT`、`BEFORE_CONTEXT_COMPACT` 和 `AFTER_CONTEXT_COMPACT` 不支持 `PEND`，因为它们要么发生在受保护操作之后，要么属于内部容量/上下文维护边界。若后续 change 定义 planning pause/resume 语义，可再增量开放 `BEFORE_PLANNING` 的 pending 语义。

跨 owner 的 control 传播必须使用 `agent-contracts/runtime` 中的共享 lifecycle hook control-interruption signal，而不是把 `PEND` 或 `DENY` / `BLOCK` 扩展进各 owner 的业务返回类型。runtime hook invocation port 返回 discriminated result：`CONTINUE` 携带 effective boundary，`INTERRUPT` 携带 safe control signal。对 `PEND`，runtime executor 必须先通过 runtime-owned pending input contract 创建 pending input、写出必要 evidence 和恢复坐标；创建成功后才返回 `INTERRUPT`。如果 pending input 创建失败，executor 必须 fail closed，不能返回一个没有 pending truth 的 `PEND` signal。

stage owner 收到 `INTERRUPT` 后必须停止该 protected operation，并把同一个 control signal 原样传播到 request lifecycle owner。对于 `agent-model`，`ModelInvocationService.complete(...)` / `stream(...)` 的业务返回类型保持 `ModelFinalResult` / stream result，不新增 `PEND` variant；`BEFORE_MODEL_INVOKE` 返回 `INTERRUPT` 时，`agent-model` MUST NOT call the provider SDK and MUST throw the shared lifecycle hook control-interruption signal unchanged. `agent-core`、fallback consumer、evaluation consumer 或其它带 accepted run context 的 model caller MUST NOT 把该 signal 包装成 model safe error、provider error、fallback miss 或普通 exception；它们必须继续向上抛给 runtime lifecycle boundary。runtime lifecycle boundary 是唯一把该 signal 解释为 paused / denied / blocked request outcome、terminal evidence 或 pending resume state 的 owner。

放弃方案：

- 只使用单一拒绝 outcome：无法表达 deny/block 区分，也不利于审计和恢复诊断。
- 把 `SKIP` 和 `PASS` 合并：无法区分 hook 明确允许通过和 hook 自行判断不适用于当前 run。
- 让 `agent-model` 直接消费 `AgentRunStatePort` 创建 pending：会反转 runtime state 依赖并让 model owner 拥有 request lifecycle truth。
- 给 `ModelFinalResult` 增加 `PEND` variant：会把 lifecycle control 混入模型业务结果，使所有模型 consumer 都必须理解 runtime pause 语义。
- 把 `PEND` 包装成 provider/model safe error：会破坏恢复语义，且会让 caller 误触发 fallback 或错误处理路径。

### D6. Hook contribution source is startup composition, not a directory contract

选择：本 change 不定义 hook 目录配置、manifest 或目录扫描作为 hook 贡献路径。hook identity、kind、effects、supported stages、failure mode、order、timeout、config schema、configure 和 execute 只来自 `defineLifecycleHook(...)` 返回的 `LifecycleHook` implementation object。runtime 执行策略必须由该 hook object 的 `effects` 派生。

app composition 必须按以下规则校验 startup hook registry input：

- startup hook registry input MUST be explicit `LifecycleHook` implementation objects from system-owned composition or already-composed plugin contributions；
- this change MUST NOT define plugin discovery, plugin loading, plugin activation, plugin filesystem layout, plugin manifest, remote plugin, script hook, or dynamic hook loading；
- `SYSTEM` hook object 必须 `failureMode=FAIL` 且必须声明显式 `order.priority`；
- `supportedStages` 使用完整 9 stage vocabulary；
- duplicate `hookId`、unknown stage、invalid effects、invalid system order、invalid system failure mode or non-canonical hook object MUST fail startup closed；
- Agent activation 只能来自 `agent.yaml.hooks` 编译出的 `AgentAssembly.hooks`。

放弃方案：

- 保留 hook 目录配置或 manifest 作为贡献路径：会把 plugin composition 之前的临时目录加载固化为产品接口，形成第二套 extension mechanism。
- 让 manifest 显式声明执行模式：会和 effects 派生策略形成两套权威来源。
- 让 manifest 声明 effects、stage、failure mode 或 order：会和 `defineLifecycleHook(...)` hook 本体形成双权威，并让开发者重复维护元数据。
- 允许 binding 覆盖 effects：会破坏 definition/binding 分离。
- 保留 hook manifest `bindings`：会把 Agent 启用配置分散到 hook implementation source，和现有 Agent package assembly 设计冲突。

### D6a. Hook 启用复用 Agent package assembly 配置面

选择：在现有 Agent 配置中增加 `hooks`，与 `capabilityBindings` 同级。`agent.yaml` 是 Agent package 的权威业务装配输入；hook 启用、禁用、stage 收窄、相对定位、timeout 和 config 都必须写在该 Agent 的 `agent.yaml.hooks` 中。Agent assembly compiler 在启动期校验 hook entry shape、安全 id、stage vocabulary、重复 entry、enabled/disabled 冲突、relative order constraints、config schema、`maxHooksPerStage` 和 override 边界，并将结果发布为 runtime-facing `AgentAssembly.hooks`。

`maxHooksPerStage` 是 framework-owned startup setting，默认值为 16。它不是 Agent 配置项，不支持 per-Agent 或 per-stage override。assembly compiler MUST 在发布 AgentAssembly 前，按当前 Agent 的每个 lifecycle stage 计算 effective hook 总数；计数包含默认生效且未被当前 Agent disable 的 `SYSTEM` hook，也包含当前 Agent 显式 enabled 的 `CUSTOM` hook；disabled hook 和 stage narrowing 后不在该 stage 生效的 hook 不计入。任一 stage 超过 `maxHooksPerStage` 时，该 Agent assembly MUST fail closed。runtime 不得对超限 hook 集合做截断、降级或只取前 N 个。

示例：

```yaml
hooks:
  - hookId: custom.ran-context-base
    enabled: true
    stages: [BEFORE_MODEL_INVOKE]
  - hookId: custom.ran-context-patch
    enabled: true
    stages: [BEFORE_MODEL_INVOKE]
    order:
      priority: 20
      after: custom.ran-context-base
    timeoutMs: 300
    config:
      playbookRef: ran-alarm-diagnosis-playbook
  - hookId: system.risk-guard
    disabled: true
```

规则：

- `CUSTOM` hook 必须在当前 Agent 的 `hooks` 中显式 enabled 才生效；
- `SYSTEM` hook 无 binding 时默认对当前 Agent 生效；
- 当前 Agent 对 `SYSTEM` hook 的 hooks entry 只能做 allowed overrides 或显式关闭，不得覆盖 system hook order；
- `enabled` 省略表示该 entry 启用；`enabled=false` 和 `disabled=true` 都表达关闭；`enabled=true` 与 `disabled=true` 冲突时 assembly compile fail closed；
- entry 不携带 `agentId`，因为所在 `agent.yaml` 和 compiled `AgentAssembly` 已经提供 Agent Scope；
- 同 stage 的串行影响型 hook 先执行 system group，再执行 custom group；system group 按框架内置 definition 的显式 order 执行；custom group 默认按当前 Agent hooks 启用声明顺序执行，配置 `order.priority`、`order.before` 或 `order.after` 时，resolver 在 custom group 内解析绝对和相对顺序，最后以 `hookId` 兜底；
- assembly compiler 必须在发布 `AgentAssembly` 前使用 frozen hook registry 校验 hook entry 指向的 hookId、definition、code registration、stage narrowing、relative order targets、safe JSON config、config schema、`maxHooksPerStage` 和 override 边界。缺失 hook definition、缺失 code registration、config schema 校验失败或任一 stage effective hook 总数超过 `maxHooksPerStage` 都必须 startup fail closed；runtime 只处理启动后已注册 hook 在 invocation 时不可用、超时、抛错或返回非法结果的故障。

放弃方案：

- 在 hook manifest、plugin manifest 或系统配置里声明 per-Agent hook activation：会形成第二套 Agent activation 配置，并让 hook 作者替 Agent owner 决定启用范围。
- 在系统配置里声明 per-Agent hook activation：会绕过 Agent package 权威配置，也不利于多 Agent package 的本地化治理。
- 在 request path 动态传入 hook activation：违反 accepted run frozen Agent Scope。

### D6b. 推荐首个 SYSTEM hook：`system.output-redaction-guard`

选择：本 change 的推荐首个内置系统 hook 是 `system.output-redaction-guard`，声明为 `kind=SYSTEM`、`supportedStages=["BEFORE_AGENT_TERMINAL"]`、`effects=["TRANSFORM","CONTROL"]`、`failureMode=FAIL`，并使用框架定义的显式 system order。该 hook SHOULD provide `configSchema` 和 `configure(config)`，让不同 Agent 通过 `agent.yaml.hooks[].config` 定制额外 pattern、分类阈值、redaction token 或 block policy；配置只在 startup / AgentAssembly materialization 阶段校验并闭包成当前 AgentAssembly 隔离的只读策略快照，运行期 `HookInput` 不携带 config，也不重新解释 config。它默认对所有 Agent 生效，当前 Agent 可按 system hook disable 规则显式关闭；因此它是 lifecycle hook default，不是替代 gateway、sandbox、runtime guard 或企业 DLP 的不可绕过安全边界。

该 hook 在 agent-core 判断当前 accepted run 可以正常退出、没有来自模型的待执行 tool calls、最终 `finalContent` 已形成之后运行，位置仍在 final-content user-visible event 发送之前。它只读取 `AgentTerminalBoundary.finalContent` 和 terminal decision safe facts，并只通过两种结果影响当前流程：

- 可确定安全脱敏的发现项，例如 credential-like pattern、内部 IP 段、客户标识、手机号或本地/内部路径，通过返回完整替换后的 `AgentTerminalMutation.finalContent` 生效；
- 无法安全脱敏、存在高风险泄漏或脱敏会破坏输出完整性时，返回 `BLOCK`，agent-core 不发送本次 final-content event，runtime 记录 safe control evidence。

该 hook 放在 `BEFORE_AGENT_TERMINAL` 而不是 `AFTER_MODEL_RESULT`，因为模型结果边界会覆盖中间轮次和非 agent-loop 模型调用；中间轮次输出可能只是 tool-use 驱动、上下文构造或内部推理输入，不等同于客户端可见最终答复。最终输出防泄漏的 protected operation 是 final-content event emission，所以 `BEFORE_AGENT_TERMINAL` 是最贴近真实保护点的位置。

该 hook 不要求修改 `Agent.execute(...)` 返回契约。`finalContent` mutation 通过 agent-core 即将发送的 final-content event 生效，runtime terminal commit 继续从该 effective final event 收集 run output。`BLOCK` 时 mutation 被忽略，final-content event 不发送，终止/失败/等待投影仍由 runtime 对 control outcome 的既有解释负责。

实现约束：

- 不记录 raw `finalContent`、raw finding、路径、credential、手机号或客户标识；`HOOK_INVOKED` / logs / metrics / audit 只输出类别、数量、safe digest、redaction/block reason code 和 bounded diagnostics。
- 检测与脱敏必须 bounded、deterministic，并避免 request path 上的远程网络调用；内置默认规则和 per-Agent 扩展规则必须通过 `configSchema` 校验后由 `configure(config)` 生成本地只读策略快照，或者由 framework-owned 本地只读策略快照进入 hook。
- per-Agent config 只能表达 pattern/policy data，例如额外敏感词模式、客户标识格式、redaction token、block severity threshold 或启用/关闭某类检测；不得把 config 解释为脚本、表达式 DSL、远程策略 URL、owner/agent scope override、hook outcome 或 mutation payload。
- 脱敏替换必须返回完整 `finalContent` 字段，并重新经过 terminal output limit 与 completeness validation。
- `BLOCK` reason 必须是安全可展示/可审计文本，不能包含被阻断的原始敏感内容。
- 该 hook 不使用 `toolCalls` 作为业务复核机制；需要业务流程退出校验的 Agent 可另行启用 custom terminal hook 返回 `toolCalls`，两者仍按 system-before-custom 顺序执行。

放弃方案：

- 在 `AFTER_MODEL_RESULT` 做最终输出脱敏：会处理过早，且会覆盖非最终、非客户端可见的模型结果。
- 在 runtime terminal commit 做最终输出脱敏：位置过晚，已经脱离 agent-core final-content event emission，无法验证 pre-final-event mutation 和 BLOCK 阻断发送的语义。
- 通过 channel projection 层做脱敏：只能影响某个 transport 的投影，不是 accepted run 的 agent-loop final output boundary。

### D7. 不新增持久化表

选择：删除独立 `HookInvocationEvent` contract 和 listener 机制。每次 invocation 写入 timeline-only `HOOK_INVOKED`，observability 从 timeline projection 消费。`DENY` / `BLOCK` / `PEND` 等 lifecycle-changing outcome 也记录在同一条 `HOOK_INVOKED` evidence 中，不再保留单独的 `HOOK_OUTCOME_APPLIED` event。并行 observe 的失败或降级写入 `HOOK_INVOKED`，不写 lifecycle-changing event。

放弃方案：

- 为 hook invocation 新增查询表：超出本 change 范围，且会引入 retention、索引和 owner-scope 查询契约。

### D8. Hook 输入使用 canonical contract

选择：developer-facing hook contract 使用 canonical `HookEffect[]`、`HookOutcome`、`BoundaryMutation` 和 `execute` 字段。startup composition / direct composition validation MUST validate canonical fields before runtime execution, and MUST fail closed when hook definition or hook result cannot be interpreted safely.

校验原则：

- hook object MUST use `execute` as the executable function field。
- hook result MUST use `outcome` as the control result field。
- execution strategy MUST be derived only from `effects`。
- 不能安全解释为非空 `OBSERVE` / `TRANSFORM` / `CONTROL` effects 集合、stage mutation owner 或 canonical outcome 的输入 MUST fail closed。
- 对开发者可见输入的收窄必须能追溯到安全、恢复、审计或执行确定性收益；不能只因为内部实现更方便而收窄。

放弃方案：

- 完全复制多枚举组合：会重新引入非法组合，并与 TS 当前 effects-driven execution strategy 重叠。
- 接受多个同义输入字段：会扩大开发者接口面，并把非目标语义带入 runtime contract。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | hook input 仍只包含 stage-safe boundary；`BEFORE_MODEL_INVOKE.messages` 是显式例外，enabled hook code 可在内存中读取完整 model messages 以支持 request transform；redaction 保护 `HOOK_INVOKED` / logs / metrics / audit / diagnostics，不阻止 hook code 读取 boundary；boundary runtime immutability 依赖 per-field finalization，不依赖 TS `readonly` 本身；hook output 不能覆盖 owner scope、agent scope、RequestRun、checkpoint、terminal truth、channel projection 或 gateway persistence；mutation 使用 closed union 和 stage 校验；`SYSTEM` hook 默认启用且非法定义 fail closed，显式 Agent disable 可审计。 | negative tests for illegal mutation / system failure mode；contract tests；redaction tests；boundary immutability tests；`npm run lint:architecture` |
| 性能/容量 | `OBSERVE` hook 并行执行并有 per-hook timeout 和 group timeout；`TRANSFORM` / `CONTROL` 串行，避免并行合并复杂度。主路径新增开销只来自当前 stage 的 bounded hook group；`BEFORE_MODEL_INVOKE.messages` boundary 可能随大 context 增长，必须依赖 readonly projection / structural sharing / copy-on-write 和 replacement-only detach 降低复制成本；外部观察/通知类副作用必须用 idempotency key 去重，失败只作为观测降级。 | lifecycle hook parallel timing tests；timeout tests；observe side-effect idempotency tests；main-path characterization；model messages boundary copy tests |
| 可靠性/恢复 | recovery 继续从可恢复 `nextLifecycleStage` / stage occurrence 接入并使用 `AgentHookSnapshot`；恢复点之前完成的 stage 不回放，恢复落点尚未完成 protected operation 时该 stage hook 重新执行；observe failure 不改变 request truth；impact hook mutation 要么完整应用到 effective boundary，要么按 failure mode 处理，不允许部分应用。 | pending/recovery tests；mutation validation failure tests；terminal commit tests |
| 可维护性 | effects 集合表达副作用权限，避免 purpose/mode 双枚举组合爆炸，也避免把三类作用误建模为互斥枚举；runtime executor 只做分组、排序、校验和控制解释，stage owner 应用业务 boundary。 | architecture review；dependency-cruiser；module-focused tests |
| 可测试性 | 每类能力都有黑盒测试入口：observe 并行、transform 串行归约、control deny/block、9 stage startup composition、非法 mutation、system fail closed。 | `tests/agent-kernel/lifecycle-hook-execution-*.test.ts`、startup composition tests、contract tests |
| 审计/可追溯性 | 每次 invocation 产出 `HOOK_INVOKED`，包含 kind、effects、execution strategy、status、outcome、diagnostic、mutation summary；mutation summary 只记录 safe kind/field，不记录敏感值。 | observability projection tests；redaction assertions；audit sink characterization |
| 输入校验 | developer-facing hook 使用 canonical contract；不支持的输入形式或非法组合 fail closed 并输出 safe diagnostic。 | contract validation tests；startup composition validation tests；direct composition negative tests |

Stage-level 验收不能只依赖 executor 单元测试。每个 lifecycle stage 必须有 stage-owner integration coverage，证明三类 effect 在该 stage 的真实 owner 位置生效：

- `OBSERVE`：hook 在目标 owner / protected operation 边界触发，看到该 stage 的安全 boundary；observe failure、timeout 或 observe side-effect failure 不改变该 stage 的 protected operation、effective boundary、pending input、terminal commit、checkpoint 或 runtime-owned truth；
- `TRANSFORM`：有 mutation 的 stage 必须证明合法 mutation 被 stage owner 消费并影响后续 protected operation 或 downstream projection；无 mutation 的 `BEFORE_REQUEST_ACCEPT` 必须证明 transform mutation fail closed；
- `CONTROL`：每个 stage 必须证明 `DENY` / `BLOCK` 阻止该 stage 后续影响型 hook 和 protected operation 或 downstream consumption；`PEND` 只在 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE`、`BEFORE_AGENT_TERMINAL` 做正例，其它 stage 做 fail-closed 负例。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| developer-facing `LifecycleHook` interface + `defineLifecycleHook(...)` helper；runtime 内部 definition、executable registry、AgentAssembly hooks activation 分离；custom 显式绑定、system 默认全 Agent 生效且可显式关闭 | 1.0, 1.6, 2.5, 3.0 | contract tests、agent assembly tests、startup composition tests、runtime resolution tests |
| frozen `ts-core-contracts` hook / pending baseline 被显式 refinement：effects/outcome/AgentAssembly.hooks/HOOK_INVOKED 取代 executionMode/decision/binding/单独 HOOK_OUTCOME_APPLIED | 1.0a, 1.0b, 3.4, 5.3 | contract tests、core contract grep assertions |
| hook contract 增加 effects、`PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND`、完整 9 stage vocabulary | 1.1, 1.2 | `npm run build`、`npm run test:contract` |
| startup hook registry object 支持 9 stage，非法 hook object 组合 fail closed；不引入 filesystem / manifest loading | 2.1, 2.2 | startup composition tests、contract tests |
| hook descriptor/result 使用 canonical fields，unsupported inputs fail closed | 1.5, 2.4, 3.7 | contract tests、startup composition tests、runtime validation tests |
| `SYSTEM` hook 默认启用、可被当前 Agent 的 `agent.yaml.hooks` 显式关闭，且 failureMode 必须为 `FAIL` | 1.3, 1.6, 2.2, 3.5 | agent assembly tests、startup registry negative tests、runtime direct composition tests |
| `maxHooksPerStage` 限制当前 Agent 单个 stage 的 effective hook 总数，超限 assembly fail closed | 1.6, 2.5 | agent assembly tests、startup composition negative tests |
| `OBSERVE` hook 并行、有界、失败不改 truth | 3.1, 3.2 | lifecycle hook parallel / timeout tests |
| `TRANSFORM` / `CONTROL` 串行稳定顺序和相对定位 fail-closed | 3.3 | lifecycle hook core ordering tests |
| stage mutation 按 stage / effects 校验并由 owner 应用 | 1.4, 4.1-4.7 | mutation tests for model/capability/context/terminal |
| 每个 lifecycle stage 都有 observe / transform / control 的 stage-owner integration coverage，且 `PEND` 按 stage 许可覆盖正负例 | 4.8, 6.2 | stage-effect coverage matrix；lifecycle hook core / pending / terminal / main-path tests |
| `DENY` 和 `BLOCK` 产生不同 safe failure / timeline evidence | 3.4 | terminal/control tests、timeline assertions |
| observe ignored control output 可诊断但不写 lifecycle truth | 3.2, 5.1 | observability tests、timeline negative assertions |
| `HOOK_INVOKED` 不泄漏 raw prompt/model/tool/attachment/secret/path | 5.1, 5.2 | redaction tests、observability tests |
| runtime/core/app/channel 边界不被破坏 | 6.1 | `npm run lint:architecture`、source-level architecture assertions |
| 旧 hook directory product path 被移除，配置层不再暴露或派生 `hooksRoot` 作为 hook source root | 2.0, 6.1 | source grep assertions、configuration-boundary design update、architecture tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/lifecycle-hook-execution/spec.md` 主承载 9 stage、effects、execution strategy、mutation、control result、failure mode 和 observability 行为。
- 架构和跨模块设计：
- `openspec/designs/architecture/core-contracts.md` 主承载 hook contract vocabulary 和不新增 `agent-contracts/hook` 的边界。
  - `openspec/designs/architecture/configuration-boundary.md` 主承载不再以 `hooksRoot` / hook directory 作为 product hook source root 的配置边界。
  - `openspec/designs/architecture/runtime-boundaries.md` 主承载 lifecycle stage 执行位置、串行/并行分组、控制结果和 mutation owner。
  - `openspec/designs/architecture/observability.md` 主承载 `HOOK_INVOKED` timeline projection、mutation summary 和 redaction 规则。
- 模块设计：
  - `openspec/designs/modules/agent-runtime.md` 主承载 executor 职责、排序、并行 observe、串行 impact、failure handling。
  - `openspec/designs/modules/agent-core.md` 主承载 agent loop 内 planning-turn `BEFORE_PLANNING` / `BEFORE_AGENT_TERMINAL` 触发、core stage boundary 事实和 effective boundary 消费。
  - `openspec/designs/modules/agent-model.md` 主承载 provider invocation boundary 的 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` 触发、model request/result mutation 消费和所有模型调用路径覆盖。
  - `openspec/designs/modules/agent-context-engine.md` 主承载 context compaction hook 触发位置和 `AFTER_CONTEXT_COMPACT` summary draft 后、持久化前限定。
  - `openspec/designs/modules/agent-app.md` 主承载 startup hook registry 和 frozen snapshot composition。
- ADR：新增 `openspec/designs/adr/lifecycle-hook-effect-isolation.md`，记录“effect 决定执行策略、observe 与 impact 严格隔离、cross-effect-group order fail closed”的长期取舍理由和被排除的依赖模式。
- 导航：`openspec/designs/spec-to-design-map.md` 更新 `lifecycle-hook-execution` 的设计和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] `OBSERVE` 并行但仍有 group timeout，低质量 observe hook 可能带来 tail latency。-> 缓解方式：per-hook timeout + group timeout，默认 group timeout 不超过最长 resolved hook timeout，并记录 timeout evidence。
- [风险] `OBSERVE` hook 被用于外部观察/通知副作用时，恢复重试或重复 stage occurrence 可能造成重复写入。-> 缓解方式：HookInput / `HOOK_INVOKED` 提供稳定 idempotency key，测试覆盖同一 stage occurrence 重试键稳定、不同 occurrence 键区分，失败只记录观测降级。
- [风险] `BEFORE_MODEL_INVOKE` 为支持 `messages` transform 暴露完整 effective model messages，hook code 可以读取 prompt / 对话历史 / context assembly 结果；大 context 也会增加 boundary 投影和 validation 开销。-> 缓解方式：该能力只对 startup-composed 且当前 Agent 启用的 hook 生效，禁用动态加载；`HOOK_INVOKED` / mutation summary / diagnostics 严格 redaction；实现使用 readonly projection、structural sharing、copy-on-write 和 replacement-only detach，测试覆盖 raw messages 不进入观测输出。
- [风险] `TRANSFORM` / `CONTROL` hook 在 recovery 落点重执行时读取外部状态，可能得到与崩溃前不同的 mutation / control result。-> 缓解方式：runtime 明确不缓存或回放 impact hook result，hook 作者必须用 frozen config、版本化引用、hook-managed cache 或确定性/幂等读取保证恢复一致性；测试覆盖恢复点之前 stage 不回放、恢复落点 stage hook 重新执行。
- [风险] stage mutation 增加 core/runtime 协作复杂度。-> 缓解方式：runtime executor 只校验和归约 boundary，stage owner 应用业务对象，避免 runtime 拥有 core 语义。
- [风险] `defineLifecycleHook(...)` required `effects` 使 hook 作者必须显式声明副作用。-> 缓解方式：启动 fail closed 优于静默降级。
- [风险] `AFTER_CONTEXT_COMPACT` 被误放在 `commitCompaction` 之后，导致只能观测不能修正压缩结果。-> 缓解方式：任务和 negative test 明确证明 `AFTER_CONTEXT_COMPACT` 在 summary draft 生成后、持久化前触发，skipped/no-op 不触发 after hook。

## 实施顺序（Implementation Order）

1. 定义 canonical contract 和测试 fixture：`LifecycleHook` interface、`LifecycleHookExecutable`、`defineLifecycleHook(...)`、`HookEffect`、`HookOutcome`、`AgentAssembly.hooks`、stage mutation 和 `HOOK_INVOKED`。
2. 实现 app startup hook registry 和 Agent assembly schema：系统内置 hook 与后续 plugin composition 已装配的 hooks 都以 `defineLifecycleHook(...)` object 进入 registry；`agent.yaml.hooks` 进入 `AgentAssembly.hooks`；两者都 fail closed 校验非法组合。
3. 实现 runtime executor：effects 分组、observe group 并行、serial impact 稳定排序、outcome 解释和 diagnostics。
4. 逐个 stage 接入 mutation 应用：agent-core loop 内 planning / terminal、agent-model provider boundary、capability、agent-context-engine compaction。
5. 补齐观测、redaction、architecture 和全局验证。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：同步完整 hook 行为契约。
- `openspec/overview.md`：按需补充完整 hook 治理扩展点的长期背景。
- `openspec/designs/architecture/core-contracts.md`：提炼 hook effects、outcome 和 mutation vocabulary。
- `openspec/designs/architecture/runtime-boundaries.md`：提炼 stage execution、observe/impact 分组、mutation owner 和 recovery 关系。
- `openspec/designs/architecture/observability.md`：提炼 `HOOK_INVOKED` timeline projection 和 safe mutation summary。
- `openspec/designs/modules/agent-runtime.md`：提炼 executor 设计。
- `openspec/designs/modules/agent-core.md`：提炼 agent loop 内 planning / agent terminal stage boundary 和 effective boundary 消费设计。
- `openspec/designs/modules/agent-model.md`：提炼 provider invocation boundary 的 model hook 和 effective model request/result mutation 消费设计。
- `openspec/designs/modules/agent-context-engine.md`：提炼 context compaction hook owner、真实压缩触发条件和 effective context mutation 消费设计。
- `openspec/designs/modules/agent-app.md`：提炼 startup hook registry、Agent assembly `hooks` parser/compiler 和 startup validation。
- `openspec/designs/spec-to-design-map.md`：更新导航和验证入口。

## 待确认问题（Open Questions）

无。
