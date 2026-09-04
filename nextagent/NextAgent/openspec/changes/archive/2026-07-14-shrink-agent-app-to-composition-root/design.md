## 背景和现状（Context）

`agent-app` 当前承担唯一 composition root 职责，但实际代码已经包含多类 owner package 应拥有的行为：memory extraction LLM strategy 和候选解析、workflow LLM prompt/model/capability adapter、runtime log 到 observation 的解析、sandbox/tool request preparation、context summary generator 包装、health/readiness 业务检查和推荐问题相关服务。`packages/agent-app/src/composition/create-app.ts` 的体量和依赖面说明它已经从 wiring 层膨胀为业务实现聚合点。

稳定架构要求 `agent-app` 通过 public factory 显式装配 runtime、channel、context、core、model、capability、gateway、attachment、memory 和 observability。它可以拥有 app config、Agent package source selection、startup plugin loading、product entrypoint 和 server lifecycle，但不应拥有 request-time 或 domain policy。

相关方：
- `agent-app`: 保留配置加载、依赖注入、服务启动。
- `agent-memory`: 接收 memory extraction/aging/revival 策略 factory。
- `agent-workflow`: 接收 workflow runtime adapter factory。
- `agent-observability`: 接收 runtime log/observation mapping factory。
- `agent-context-engine`: 接收 context summary 和 prompt/model selection helper。
- `agent-capability`: 接收 sandbox/tool dependency preparation 和 provider/tool business composition。
- `agent-session`: 接收 suggested/frequent question generation、category question catalog read model、pin/high-frequency merge 和 association 排序实现，作为 conversation-derived assist service。
- `agent-runtime`、`agent-channel-web`、gateway packages: 行为不变，只消费迁移后的 owner public APIs。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 将 `agent-app` 明确收敛为三职责：配置加载、依赖注入、服务启动。
- 把当前 `agent-app` 中的 owner-owned business behavior 迁回对应 package 的 public factory。
- 迁移后 `agent-app` 不再解析 domain output、不再实现 owner policy、不再构造 provider-specific request、不再从 runtime logs 手写 structured observation，也不实现 suggested/frequent question 业务服务。
- 保持外部行为兼容：startup readiness、capability availability、memory tool availability、workflow availability、health/readiness safe diagnostics、shutdown 行为和 public contracts 不变。
- 增加 architecture 和 characterization tests，防止职责再次膨胀。

**非目标：**
- 不改变 request lifecycle、scheduler、same-session lane、cancellation、checkpoint、terminal commit 或 canonical timeline。
- 不改变 Web API、stream event、runtime command、gateway schema、model invocation contract 或 capability invocation contract。
- 不引入 runtime DI container、service locator、hidden global registry、dynamic plugin loading、hot reload 或 remote implementation loading。
- 不重新设计 app config schema、AgentAssembly contract、model profile contract、capability catalog contract、gateway contracts 或 observability public contracts。
- 不拆分新的横向 `agent-app-composition-*` package；owner 行为必须回到 owner package。

## 设计决策（Decisions）

1. `agent-app` 三职责作为硬边界

`agent-app` 只保留：
- `config/`：读取、校验、冻结 config 和 safe evidence。
- `assembly/`：app-owned Agent package source selection、parse/compile、registry publication。
- `entrypoints/`、`server/`、`composition/create-app.ts`：调用 public factories、传递窄依赖、注册 channel/server、start/close lifecycle handles。
- `packaging/`、`release/`：产品打包和 release qualification。

不保留在 `agent-app` 的内容包括 domain parser、runtime path policy、model prompt strategy、capability/tool execution details、memory lifecycle decision、workflow execution adapter semantics、observability event semantics、question recommendation prompt/output parsing 和 frequent question merge/ranking semantics。

2. Owner package 暴露窄 factory，不反向依赖 `agent-app`

每个迁移点由 owner package 提供 public factory，factory 入参只包含 owner 需要的窄依赖：

| 当前 app 内逻辑 | 目标 owner | 目标 public factory |
|---|---|---|
| memory extraction LLM strategy、candidate parsing、safe error mapping | `agent-memory` | `createMemoryExtractionLlmStrategy(...)` |
| memory aging/revival diagnostic projection helper | `agent-memory` | `createMemoryLifecycleDiagnostics(...)` |
| workflow runtime capability resolver、model config resolver、LLM prompt preparation | `agent-workflow` | `createWorkflowRuntimeAdapters(...)` |
| runtime log entry 到 observation event mapping | `agent-observability` | `createRuntimeObservationBridge(...)` |
| request-scoped summary generator/model profile selection | `agent-context-engine` | `createRequestScopedSummaryGenerator(...)` |
| sandbox execution request preparation、Python temp script preparation、tool-safe sandbox error mapping | `agent-capability` | evolve existing `createWorkspaceBackedSandboxExecutionPort(...)`; optional `createSandboxToolExecutionAdapter(...)` export MUST delegate to the same implementation |
| suggested question prompt/model request/output parsing | `agent-session` | `createSuggestedQuestionService(...)` |
| frequent question list/pin/association merge and category question catalog semantics | `agent-session` | `createFrequentQuestionService(...)`、`createCategoryQuestionCatalog(...)` |
| model/gateway/capability health probe business checks | corresponding owner package | `create<Model|Gateway|Capability>HealthProbe(...)` |

这些 factory 可以依赖 `agent-common`、owning `agent-contracts/*` subpath、本 package public/internal implementation 和必要第三方库。它们不得 import `agent-app`、app-private config DTO、app composition modules 或其它 implementation package。

Cross-owner dependencies MUST use one of these shapes:
- stable public contracts from `agent-contracts/*` or `agent-common`;
- a structural callback/port declared inside the owning package, with `agent-app` adapting another package's implementation to that local shape;
- package public factory return values consumed only by `agent-app` composition.

Target packages MUST NOT import another implementation package only to reuse a TypeScript type. If the dependency is not already a stable `agent-contracts/*` contract, the target package defines a local structural interface and `agent-app` performs the adapter wiring.

The sandbox migration MUST NOT create a second sandbox execution path. `agent-capability` already has `createWorkspaceBackedSandboxExecutionPort(...)`; this change evolves that implementation until it covers the app-owned `runSandbox(...)` behavior, then removes the app-local helper. A `createSandboxToolExecutionAdapter(...)` name is allowed only as a public alias or thin facade over the same implementation, not as a parallel adapter.

Suggested/frequent question behavior is conversation-derived assist behavior. It is based on existing session/message/run/timeline/user-question facts and helps the user continue or start conversation, so it belongs in `agent-session` rather than a new package. `agent-session` owns the implementations behind existing `agent-contracts/runtime` ports. This change MUST NOT add or change `SuggestedQuestionPort`、`FrequentQuestionPort` or Web DTO contracts. Category question catalog semantics and question hash helpers currently under `agent-capability/local` move to `agent-session`; `agent-capability` MUST NOT remain the owner of question catalog semantics after the move.

This intentionally shrinks the `agent-capability` public export surface for category-question helpers. `@nextagent/agent-capability` MUST stop exporting the current category-question symbols from `local/category-question-model` and `local/category-question-discovery`: `QuestionEntry`, `CategoryL2`, `CategoryL1`, `CategoryQuestionCatalog`, `computeQuestionHash`, `createQuestionEntry`, `CategoryQuestionReadinessOutcomeCode`, `CategoryQuestionReadinessEvidence`, `CategoryQuestionDiscoveryOptions`, `CategoryQuestionResourceDiscovery` and `normalizeLocale`. Any equivalent category-question read model or helper needed after the move belongs to `agent-session` under session-owned naming/export rules; app composition consumes it from `agent-session`, not from `agent-capability`.

This does not expand `agent-session` into a model, capability or app-composition owner. `agent-session` MAY depend on `agent-contracts` public subpaths for injected `ModelInvocationService`、`CapabilityCatalog`、`AgentAssemblyRegistry` and gateway read ports, but MUST NOT import `agent-model`、`agent-capability`、`agent-context-engine`、`agent-runtime` implementation、`agent-channel-web` implementation or `agent-app`. App composition remains responsible for trusted config/resource loading and passes only narrow question catalog sources or already-built catalog ports to `agent-session`.

The category question catalog handoff is a dependency boundary, not a filesystem ownership move. `agent-session` owns question catalog semantics and MAY define `CategoryQuestionCatalogPort` / `CategoryQuestionCatalogSource` structural types, but it MUST NOT import `agent-capability/local`、`AgentPackageSourceLocator` implementation、raw app config path helpers or app-private resource loaders. `agent-app` remains responsible for trusted Agent package root containment and resource source construction, then injects the narrow category question catalog dependency.

3. Public factory shape is narrow and startup-built

Each new or moved factory has a minimal public shape:

| Factory | Input shape | Output shape | Failure / cancellation semantics |
|---|---|---|---|
| `createRuntimeObservationBridge(...)` | owner scope provider, allowlisted runtime log event mapping options, projector host attachment callback | bridge with `attach(projectorHost)` and logger mapper | malformed runtime log input produces no observation or safe fallback; no prompt/model output is emitted |
| `createMemoryExtractionLlmStrategy(...)` | memory config projection, `agent-contracts/model` model invocation service, memory-local prompt assembly callback, assembly/profile selector callback, memory-owned category rules | `MemoryExtractionLlmStrategy` | abort returns memory-safe canceled error; model/prompt failures return memory-owned safe error |
| `createMemoryLifecycleDiagnostics(...)` | memory diagnostic projection options, owner/agent scope resolver, observation sink callback | diagnostic projection functions for extraction/aging/revival | diagnostics are safe-only and exclude prompt, memory content, raw paths, credentials and raw provider/storage errors |
| `createWorkflowRuntimeAdapters(...)` | model profile selector callback, workflow-local prompt assembly callback, capability resolver factory over `agent-contracts/capability`, workflow catalog/read ports | workflow runtime adapter object consumed by workflow execution service | prompt/profile/capability failures surface existing workflow safe errors |
| `createRequestScopedSummaryGenerator(...)` | assembly lookup callback, model profile selector callback, `agent-contracts/model` model invocation service, context-engine-owned prompt assembler, diagnostic logger | traceable summary generator compatible with existing context-engine summary contract | abort/model/prompt failures keep existing context-engine safe paths |
| `createWorkspaceBackedSandboxExecutionPort(...)` / optional `createSandboxToolExecutionAdapter(...)` | sandbox gateway adapter, workspace file port, risk policy evaluator, runtime logger | `SandboxExecutionPort` | unsupported executable, unsafe path, cancellation and unavailable gateway map to existing capability safe errors; temp files are cleaned up |
| `createSuggestedQuestionService(...)` | model invocation service, assembly/profile selector callback, capability catalog read port, run/message/timeline read ports | `SuggestedQuestionPort` | abort or non-completed terminal state returns empty result; model failure returns empty result; no timeline write |
| `createFrequentQuestionService(...)` | category question catalog port, assembly registry, question activity gateway, frequency threshold and pin limit | `FrequentQuestionPort` | gateway safe errors degrade to available static/empty results according to existing behavior |
| owner health probe factories | owner-specific read-only readiness dependencies | owner-local structural probe objects adapted by `agent-app` to `agent-observability` `HealthProbe` | failures produce safe component health status only |

These are package public exports, not new `agent-contracts` contracts. They are stable enough for `agent-app` composition and tests, but they do not create catch-all app service contracts.

4. `agent-app` 只传 frozen projection，不传完整 `DefaultSystemConfig`

Owner package factory 不接收完整 `DefaultSystemConfig`。`agent-app` 负责把配置裁剪成 owner-owned options，例如：
- memory factory 接收 memory config projection、model invocation service、memory-local prompt assembly callback、gateway memory ports、identity/agent scope provider；`agent-memory` 不 import `agent-context-engine`。
- workflow factory 接收 model profile selector callback、workflow-local prompt assembly callback、capability resolver factory、catalog port；`agent-workflow` 不 import `agent-context-engine` 或 `agent-capability` implementation。
- observability factory 接收 owner scope provider、projector host、runtime logger wrapper options。
- session question factories 接收 model invocation service、assembly/profile selector callback、capability catalog read port、gateway read ports、category question catalog port 和 question activity gateway。`agent-session` 不接收完整 app config、raw config root 或 app-private path。
- health probe factories 接收 owner-specific read-only dependencies；owner package 返回 structural probe objects，不 import `agent-observability`。`agent-app` 负责把这些 objects 适配给 `createHealthEvaluator(...)`。

`DefaultSystemConfig` 继续是 `agent-app` 内部完整配置事实，下游只消费冻结后的窄投影或 typed registry。

5. Current baseline -> minimal delta

| Current baseline | Delta in this change |
|---|---|
| `packages/agent-app/src/composition/create-app.ts` defines `runtimeObservationFromLogEntry(...)` and related runtime log observation mappers | move mapping to `agent-observability` `createRuntimeObservationBridge(...)`; app keeps logger wiring only |
| `create-app.ts` defines memory extraction strategy, parser, safe error and memory diagnostic observation helpers | move to `agent-memory` factories; app injects model/prompt/gateway dependencies only |
| `create-app.ts` defines workflow runtime capability/model/prompt helpers | move to `agent-workflow` factory; app injects adapter object into workflow service only |
| `create-app.ts` defines request-scoped summary generator wrapper while context-engine already owns `createDefaultTraceableSummaryGenerator(...)` | move wrapper to `agent-context-engine`; app passes callbacks/dependencies only |
| `agent-capability` already exports `createWorkspaceBackedSandboxExecutionPort(...)`, while `create-app.ts` still has a parallel `runSandbox(...)` path | evolve the existing capability port to cover app behavior; delete app sandbox helper; no second adapter |
| `create-app.ts` defines `createAppHealthProbes(...)` for gateway/model/capability checks | move probe creation to corresponding owner packages; app calls probe factories and passes probes to `createHealthEvaluator(...)` |
| `packages/agent-app/src/composition/suggested-question-service.ts` implements prompt/model/output parsing for `SuggestedQuestionPort` | move implementation to `agent-session`; app only composes the port |
| `packages/agent-app/src/composition/frequent-question-service.ts` implements frequent question merge/pin/association semantics and consumes question catalog helpers from `agent-capability` | move service and question catalog helpers to `agent-session`; app only composes the port |
| `packages/agent-app/src/composition/precomputed-suggested-questions.ts` precomputes static/suggested question data for app wiring | move precompute/read-model behavior into `agent-session` question assist factories or session-owned helpers; app keeps only factory wiring |
| `packages/agent-app/src/composition/category-question-service.ts` loads category question resources and adapts capability-local discovery helpers | move category question catalog semantics into `agent-session`; app only constructs trusted narrow resource source/port and no longer imports category-question helpers from `agent-capability` |

6. 迁移以 characterization-first 顺序执行

实施顺序固定为：
1. 增加 architecture/size/ownership guard 和 startup characterization tests。
2. 迁移 observability runtime log mapping。
3. 迁移 memory extraction/aging/revival 策略。
4. 迁移 workflow runtime adapters。
5. 迁移 context summary helper。
6. 迁移 capability sandbox/tool preparation by evolving the existing capability sandbox port。
7. 迁移 question services and category question helpers to `agent-session`。
8. 迁移 health probe business checks to owner probe factories。
9. 收尾删除 `agent-app` 中已迁出 helper，更新 roadmap/onepage 状态和验证。

该顺序先移动低业务风险的 mapping，再移动后台 memory/workflow 策略，最后移动 capability execution-adjacent 代码，降低 request path 回归风险。

7. 不用 source size 作为唯一完成标准

`create-app.ts` 变小是结果，不是验收核心。验收以 owner boundary 为准：迁出逻辑在 owner package 有测试，`agent-app` 只调用 public factory，architecture lint 能防止反向依赖和 private import。

放弃方案：
- 放弃“只把 `create-app.ts` 拆成多个 `agent-app/composition/*` 文件”：这只能降低文件体量，不能修复 ownership。
- 放弃新增通用 DI container：会引入隐藏依赖和调试复杂度，违背 explicit composition。
- 放弃一次性重写 app composition：风险高，难以证明外部行为兼容。

8. `createComposedApp` 主流程必须是显式分阶段装配，禁止内联 owner-owned 构造与散落 mutable 回填

task 13-15 通过的 guard 只断言 `create-app.ts` 行数 ≤1000、4 个 helper 名字不在文件内、10 个 `compose-*` import 字符串存在；它无法检测 `createComposedApp`（约 537 行函数体）内部仍混合 layer 调用、内联构造与 mutable 闭包回填。本决策把"主流程只表达装配阶段"从口号收紧为可验证约束。

- 8.1 区分真假循环依赖。真循环（workflow↔capability、capability↔request-runtime、lifecycleHook↔runtime）用**单一集中式 `CompositionDeferredBindings` holder** 承载：固定字段、`get*()` + `bind*()`、单次 bind，是 explicit typed binding 而非 DI container / service locator（符合决策 5）。假循环（`workflowModelInvocation = observedModel`）通过**重排序**消除——`observedModel` 在 `projectorHost` 之后、`composeWorkflowExecutionLayer` 之前构建并直接注入，删除对应 `let` 与 getter。
- 8.2 禁止在 `create-app.ts` 内联以下 owner-owned 构造：`createObservationEvent(` 调用、`diagnosticObserver:`/`auditObserver:` 闭包、attachment runtime 构造、health probe 构造、memory tool port aging observer、capability provider 解析回调。这些必须落在职责命名的 composition module。
- 8.3 消除 memory aging observer 第二套实现。`memoryToolPort`（create-app 内联）与 aging scheduler（memory-maintenance-composition）当前各自手写 `createAgingDiagnosticObservation`/`createAgingAuditObservation` + try/catch + agentScope 查找，是禁止的第二套实现。必须由 memory composition 单点产出 `createMemoryAgingObservers(...)`，两处共用，create-app 只注入。
- 8.4 guard 升级。`workspace.test.ts:257` 必须从"看行数+import 字符串"升级为断言 create-app.ts 不含上述内联模式，且 mutable 回填集中到 `CompositionDeferredBindings`；需有 negative fixture 实际触发失败。

9. agent-app 内部结构：业务回归、装配分层、子目录依赖分区

复审三个方向的延续：(1) 业务逻辑还给业务模块；(2) 各业务模块装配集中到独立 `compose*Layer` 文件，create-app 只编排+跨模块注入；(3) agent-app 子目录间依赖限制。本决策只落地符合现有依赖方向、不引入 owner 反向依赖的部分；涉及跨包依赖方向变更的项 deferred 到后续 OpenSpec change。

- 9.1 业务回归边界。领域语义/决策/策略/校验规则归 owner package；选哪个 factory、注入什么窄依赖、装配顺序留 composition。禁止把接线推入业务模块（会反转为 owner→composition 依赖）。memory config 数值边界归 `agent-memory`，app-lifecycle 的 APP_START/APP_SHUTDOWN shaping 归 observability adapter；这两项可在本 change 落地。
- 9.2 装配分层 scoping rule。内聚子系统装配抽成 `compose*Layer`（observability 基础设施、agent assembly discovery/runtime-facing registry、lifecycle hook startup materialization、model service 选择、prompt template 装配）；纯 1 行依赖交接（riskPolicyEvaluator、modelProfiles、clipCommandRunner、lifecycleModel 等）留 create-app 作编排胶水，不为 1-liner 单建文件。目标：`createComposedApp` 只剩 `compose*Layer` 序列 + deferred bind + return + 少量 trivial 赋值。不得把 memory tool opt-in、lifecycle hook materialization、prompt template 装配等不同 owner/lifecycle 的对象合并进单个 "assembly layer"。
- 9.3 子目录依赖。修复 `config → composition` 逆向（`createDefaultProductOptions` 当前在 `config/system-config.ts` 但返回 composition 的 options 类型，形成 config→composition type back-edge）：把 `createDefaultProductOptions` 移出 config，删 system-config.ts 对 composition 的 import，加 depcruise 规则防回归。`composition → server` 允许（server 是叶子，无反向依赖）。`assembly → plugin`（type-only）软性 tolerated。完整 subdir DAG 作为 agent-app 内部架构不变量 deferred。
- 9.4 guard 覆盖面。forbidden-fragment 约束从 create-app.ts 扩展到职责命名的 `composition/*-composition.ts`（含显式 exception allowlist 和原因），防止业务逻辑"下沉一层"到 composition module 再次泄漏；新增 create-app body 形态断言（`compose*` 调用 + deferred bind + return + 有上限的 trivial 赋值）。guard 不应禁止 composition module 调用 owner public factory 或做窄依赖适配；只禁止手写 owner-owned shaping/strategy/algorithm。
- 9.5 composition 依赖方向。当前 13 个 composition module 反向 `import type` create-app.ts 的共享词汇（`AppGatewayStores`/`CreateComposedAppOptions`/`RagRetrievalBinding`/`AgentScope` 等），形成 root↔module 循环；且 module 间存在值依赖（`findDuplicateProviderId`、`trustedAgentPromptRoot`），绕过 create-app 编排。修复：抽中性 `composition/composition-contracts.ts`，仅承载跨 composition module 共享的 type-only 词汇（含 `AgentScope`、factory/option 类型，以及确需跨多个 module 共享的 composition 返回类型）；create-app 与所有 module 都从 contracts 导入共享类型。单个 layer 自己的返回 interface 若只被该 module 与 create-app 使用，可留在本 module export，不强制集中到 contracts。module 不得 `import` create-app.ts；不得 value-import sibling composition module（type 经 contracts 共享 OK）。`findDuplicateProviderId` 这类值 helper 不进 contracts，移入 `app-composition-helpers.ts` 或 owner module；`trustedAgentPromptRoot` 归 prompt-template-composition 或由 create-app 调用后作入参传入。此为 18.2-18.6 的前置，让新 module 诞生在干净依赖基线。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner scope、agent scope、secret resolver 和 path containment 仍由现有 trusted config/channel/runtime 边界提供。迁移不得让 owner package 读取 raw config、process.env、client input 或 app-private DTO 来扩权。 | architecture tests；owner package negative tests；secret/path leakage tests |
| 性能/容量 | 迁移不新增 request path hop，不引入 runtime reflection/DI container。Factory 在 startup 构造，request path 继续调用已冻结对象。 | startup characterization tests；相关 package unit tests；`npm run build` |
| 可靠性/恢复 | request lifecycle、terminal commit、runtime recovery、scheduler ownership 不变。后台 memory/workflow lifecycle 由 owner factory 返回 handle，`agent-app` 只 start/stop。 | runtime characterization tests；memory/workflow lifecycle tests；shutdown tests |
| 可维护性 | 业务策略回到 owner package，`agent-app` 依赖面收缩为 public factory 和 typed projections。`create-app.ts` 作为 bounded composition facade，app-local gateway/channel/assembly/capability/workflow/context/memory/lifecycle helper 逻辑拆到职责命名的 composition module；主流程只表达阶段化装配和依赖交接；新增 architecture guard 阻止再次膨胀。 | `npm run lint:architecture`；dependency-cruiser rule；code review checkpoint |
| create-app 装配阶段可读性 | request runtime、session-facing services、product channel/server 继续拆入对应 module composition。`createComposedApp(...)` 只保留配置事实加载后的阶段编排、跨模块依赖注入和 lifecycle 返回值组装，不展开 runtime listener、question assist service 或 channel registration 细节。 | `npx tsc -b`；architecture source guard；code review checkpoint |
| 可测试性 | 迁出逻辑在 owner package 单测覆盖，app composition 只保留 wiring integration tests。先写 characterization tests 固定现有黑盒行为。 | package unit tests；app composition integration tests；contract tests |
| 审计/可追溯性 | observation shaping 归 `agent-observability`，`agent-app` 只装配 projector host 和 sinks；safe diagnostic 输出保持兼容。 | observability mapping tests；safe diagnostic snapshot tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `agent-app` 只承担三职责 | 1.1, 7.1 | architecture source test；code review checkpoint |
| owner package 不反向依赖 `agent-app` | 1.2, 7.2 | `npm run lint:architecture` |
| 迁移不改变 startup/readiness/availability 外部行为 | 1.3, 7.3 | app composition characterization tests |
| observability mapping 归 `agent-observability` | 2.1-2.3 | observability unit tests；app wiring tests |
| memory extraction/aging/revival 策略归 `agent-memory` | 3.1-3.4 | memory unit/contract tests；app composition tests |
| workflow runtime adapter 归 `agent-workflow` | 4.1-4.3 | workflow unit tests；app wiring tests |
| context summary helper 归 `agent-context-engine` | 5.1-5.2 | context-engine tests；app wiring tests |
| capability sandbox/tool preparation 归 `agent-capability` | 6.1-6.3 | capability tests；sandbox negative tests |
| question services 归 `agent-session` | 7.1-7.4 | session question service tests；app wiring tests |
| health probe business checks 归 owner packages | 8.1-8.3 | health tests；app characterization tests |
| `create-app.ts` 不回到超大文件或第二套 helper 实现 | 13.1-13.3 | architecture source test；`npx tsc -b`；code review checkpoint |
| `createComposedApp(...)` 主流程只表达装配阶段，不展开 capability/workflow/context/memory/lifecycle 细节 | 14.1-14.2 | architecture source test；`npx tsc -b`；code review checkpoint |
| 真循环用集中 deferred binding，假循环靠重排序消除 | 16.1, 16.2 | `npx tsc -b`；guard 断言 `createComposedApp` 内 `let` 仅出现在 deferred holder |
| memory aging observer 单点产出，消除第二套实现 | 16.3 | `rg "createAgingDiagnosticObservation" packages/agent-app/src/composition/create-app.ts` 无结果 |
| attachment/health/model-diag/gateway/capability-provider 内联构造下沉 | 16.4-16.8 | guard 断言 create-app.ts 不含对应 factory 直接调用 |
| guard 编码"主流程只表达装配阶段"且含 negative fixture | 16.9 | `npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` |
| config→composition 逆向修复并防回归 | 18.1 | depcruise 规则；`Select-String system-config.ts "composition"` 无结果 |
| composition 依赖方向修正（抽 type-only composition-contracts，消除 module→create-app 与 sibling composition value import） | 18.0 | depcruise 规则；composition module 源码不含 `from "./create-app.js"`，无 sibling composition value import |
| observability/assembly/lifecycle/model/prompt 内联子系统装配下沉到 compose*Layer | 18.2-18.6 | `npx tsc -b`；guard 断言 create-app.ts 不含对应 factory 直接调用 |
| session question catalog 小收口 | 18.7 | `npx tsc -b`；create-app.ts 不再内联 `createCategoryQuestionCatalog` |
| memory config bounds 回归 agent-memory | 18.8 | memory configuration contract tests；validation.ts 不再硬编码 memory lifecycle 数值边界 |
| app-lifecycle shaping 下沉 observability adapter | 18.9 | `npx tsc -b`；app-lifecycle-composition.ts 不含 `createObservationEvent(` |
| forbidden-fragment 扩到职责命名 composition module + create-app body 形态断言 | 18.10 | `npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；negative fixture 触发失败 |
| OpenSpec delta 和 roadmap/onepage 一致 | 10.1-10.3 | `openspec validate --all --strict`；doc review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-backend-architecture/spec.md` 主承载 `agent-app` 三职责和禁止项。
- 架构和跨模块设计：`openspec/designs/architecture/ts-backend-architecture.md` 主承载 composition root 与 owner package 协作边界。
- 模块设计：
  - `openspec/designs/modules/agent-app.md` 主承载 `agent-app` 职责、非职责和验证关注点。
  - `openspec/designs/modules/agent-memory.md` 主承载 memory strategy factory 归属。
  - `openspec/designs/modules/agent-workflow.md` 主承载 workflow runtime adapter 归属。
  - `openspec/designs/modules/agent-observability.md` 主承载 observation mapping 归属。
  - `openspec/designs/modules/agent-context-engine.md` 主承载 summary/prompt helper 归属。
  - `openspec/designs/modules/agent-capability.md` 主承载 sandbox/tool adapter 归属。
  - `openspec/designs/modules/agent-session.md` 主承载 suggested/frequent question conversation-derived assist ownership。
- ADR：无新增 ADR。该选择是既有 composition root 原则的收紧，不需要独立长期决策记录。
- 导航：`openspec/designs/spec-to-design-map.md` 更新 `ts-backend-architecture` 到相关 module design 的映射。

## 风险与取舍（Risks / Trade-offs）

- [风险] owner package factory 入参过宽，变相复制 app config。 -> 只允许 frozen projection 或 callback，code review 和 tests 检查不得传完整 `DefaultSystemConfig`。
- [风险] 迁移 memory/workflow 后出现双实现。 -> 每个迁移 task 必须删除 app 内旧 helper，并通过 `rg`/architecture test 检查唯一实现。
- [风险] observability safe diagnostic 文案变化影响运维。 -> 增加 snapshot/characterization tests，允许内部 source owner 改变，不允许 safe reason code 和可见字段无规格变化。
- [风险] 为了快速迁移新增横向 helper 包。 -> 本 change 明确禁止；只能回 owner package 或留在 app 三职责内。
- [风险] `agent-session` 因 question service 迁入而膨胀为 model/capability/app 聚合点。 -> 只允许承载 conversation-derived assist semantics；不得承载 Web route、runtime lifecycle、model provider implementation、capability lifecycle、context assembly、app config/resource loading 或 future generic product features。
- [风险] sandbox 迁移产生双路径。 -> 只能演进 existing `createWorkspaceBackedSandboxExecutionPort(...)`，任何 `createSandboxToolExecutionAdapter(...)` 必须委托到同一实现。
- [风险] app composition tests 过度绑定私有实现。 -> characterization tests 断言外部可见 startup/readiness/availability/safe diagnostics，而不是私有 helper 名称。
- [风险] `CompositionDeferredBindings` 被误认为 DI container。 -> holder 字段固定、单次 bind、无动态注册/字符串键；决策 8.1 显式声明其为 explicit typed binding，guard 断言 `createComposedApp` 内 `let` 仅出现在 holder，防止散落回填回流。

## 迁移计划（Migration Plan）

实施以小批次提交，任一批次失败可回滚到前一批次，因为 public contracts 和配置文件不改变。

1. 建立 characterization 和 architecture guard。
2. 按 owner package 逐个迁移 factory，迁移一个 owner 后立即运行对应 package tests 和 app wiring tests。
3. 先在 `agent-session` 迁移 question tests，再替换 app wiring，避免 Web route 行为变化。
4. 删除 `agent-app` 中已迁出 helper、类型别名和 imports。
5. 运行完整验证门禁。

发布策略：本 change 不改变外部部署和配置；可作为普通后端版本发布。若某个 owner 迁移引发回归，回滚该 owner 迁移 commit，不需要数据迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-backend-architecture/spec.md`: 合并 `[TS] App Composition Root 三职责边界`。
- `openspec/designs/architecture/ts-backend-architecture.md`: 提炼三职责、owner factory 协作和不引入 DI container 的架构事实。
- `openspec/designs/modules/agent-app.md`: 更新职责/非职责为配置加载、依赖注入、服务启动。
- `openspec/designs/modules/agent-memory.md`: 补充 memory extraction/aging/revival strategy factory ownership。
- `openspec/designs/modules/agent-workflow.md`: 补充 workflow runtime adapter ownership。
- `openspec/designs/modules/agent-observability.md`: 补充 runtime log observation mapping ownership。
- `openspec/designs/modules/agent-context-engine.md`: 补充 summary/prompt helper ownership。
- `openspec/designs/modules/agent-capability.md`: 补充 sandbox/tool execution adapter ownership。
- `openspec/designs/modules/agent-session.md`: 补充 suggested/frequent question conversation-derived assist ownership。
- `openspec/designs/spec-to-design-map.md`: 更新 `ts-backend-architecture` 导航和验证入口。

## 待确认问题（Open Questions）

以下项涉及跨包依赖方向变更或内部架构不变量，deferred 到后续 OpenSpec change，不在本 change 范围：

- **observation adapter 归属**：`agent-observability/runtime/app-observation-adapters.ts`（478 行）当前作 adapter host 硬编码领域 operation 名（`MEMORY_CONFIG_EVALUATED`/`MODEL_PROFILE_EXCLUDED` 等）。是保持 observability 作 host 并按领域拆文件，还是把"何时发什么 operation"还给领域 owner（需确认 domain→observability 依赖方向被允许）？需独立 design 决策。
- **plugin-loader 边界**：`plugin/plugin-loader.ts`（369 行）实现 README 声明为"非职责"的动态插件加载，且内嵌 plugin SDK 业务语义（policy shape 校验/semver/host externals）。需单独 OpenSpec change 定 agent-app 与 agent-plugin-sdk 的边界。
- **agent-app 完整子目录 DAG**：本 change 只修复 config→composition 逆向。完整的 agent-app 子目录依赖分区（config/assembly/composition/entrypoints/server/auth/packaging/release/plugin 间的 DAG）作为内部架构不变量需独立 design 决策与 depcruise 规则集。
