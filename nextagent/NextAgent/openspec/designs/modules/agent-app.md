# agent-app 模块设计

## 职责

唯一 composition root，读取内置 default-system/default-agent 配置、用户 `application.yaml` 覆盖层和 env secret override，冻结 `configRoot` / `workspaceRoot`，编译 runtime-safe `AgentAssemblyRegistry`，装配 runtime、channel、context engine、core、model runtime、capability subsystem、SQLite local gateway、lifecycle hook/checkpoint/audit provider、observability、runtime bootstrap config 和可选 local configured auth。它只承载跨模块 wiring、ready gate 和 owner package public factory 调用，不承载 provider/tool/Skill/Agent 业务清单。按可信 package/build profile 选择 `backend-only` 或 `with-frontend` 产品入口；在 `with-frontend` 下消费 `@nextagent/agent-web/hosting` 的 `resolveFrontendHostingManifest()`，并通过 `@nextagent/agent-app-frontend-hosting` 注册前端静态资源 route 和 SPA fallback。

本模块冻结 Tool、Skill 与 CLIP provider 的 disclosure mode，并把它作为 trusted composition fact 注入 capability 与 context engine；客户端、模型输出和 Skill metadata 不得覆盖该边界。

本模块装配 active Agent package `config/config.json` 中 `portal-ability-config` 的受信 effective config provider：推荐问题、AskUserQuestion 等待时长以及定时任务、长期记忆管理、知识导入和完整过程入口开关均在 app composition 侧解析；LOCAL 模式首次读取后缓存，REMOTE 模式按现有文件 fingerprint 在后续请求热更新。请求体、客户端 metadata、模型输出和 Capability 参数不得覆盖这些值。

本模块把 `agent-core` 的 directive normalizer 作为 accepted-input projector 注入唯一 request runtime composition；channel、context engine、workflow 与 gateway 不持有 parser。

本模块把已选的 local 或 remote `WorkflowExecutionService` 包装为 `WorkflowExecutionToolPort` 并注入 `Workflow` builtin Tool；模式选择复用 workflow execution mode/factory，不允许 Tool 直接选择远端地址、Agent Scope 或 provider。

## 非职责

不定义 Web API 业务语义、runtime state machine、gateway schema、Agent package 字段全集、动态插件加载、远端实现包加载、provider fallback 策略、capability provider 业务清单、Tool/Skill/Agent catalog 条目、长期记忆业务策略、前端页面行为、浏览器状态管理或前端路由设计。不把 raw config DTO、provider adapter config 或 AgentDefinition parser/compiler contract 暴露给 runtime/core/context/model/capability/session/gateway。不通过环境变量、配置文件、目录扫描、前端源码或 frontend-private path 推导前端托管配置；不从前端 build-time env、URL、localStorage 或 UI 状态读取产品路径 stream transport。

## 依赖

可以导入所有 package public exports；不得使用跨包 private paths、隐藏全局 DI 或启动副作用。`backend-only` 产品入口不得依赖 `@nextagent/agent-app-frontend-hosting` 或 `@nextagent/agent-web`；`with-frontend` 产品入口可以依赖 `@nextagent/agent-app-frontend-hosting` 和 `@nextagent/agent-web/hosting`。

Owner implementation package 不得反向 import `agent-app` 或 app-private composition module。专用 product/testing facade 可以调用 `agent-app` public export，但不得被 `agent-app` 反向 import，也不得被 owner implementation 调用。跨 package wiring 只通过 public package exports、`agent-contracts`、`agent-common` 或 owner-owned public API 完成。

## Capability 失败处置协作

App composition 通过既有 `createCapabilitySubsystem(...)` 装配 catalog、唯一 invocation port、frozen providers 和 startup validation/reporting hooks，并把同一个 governed port 注入 Agent、Workflow 与直接调用路径。composition 不接收或暴露 executor snapshots、独立 retry service、第二套 diagnostics 或 Tool-facing scope authority；完整装配不变量见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## 顶层 Composition Pipeline

`packages/agent-app/src/composition/create-app.ts` 是唯一 product factory/runner/core 入口。完整调用路径固定为：

```text
public / product / package / test facade
  -> runProductCompositionSync(...) 或 runProductCompositionAsync(...)
  -> prepareCompositionInputsSync(...) 或 prepareCompositionInputsAsync(...)
  -> PreparedCompositionInputs
  -> composeNextAgentApp(...)
  -> ProductCompositionOutcome
  -> optional async with-frontend finalization
  -> commit
```

`createNextAgentApp(...)`、`createNextAgentAppAsync(...)`、`createComposedApp(...)` 和 `createComposedAppAsync(...)` 只作为兼容 facade；它们不得互相 delegation 形成嵌套 runner、重复 preparation 或第二个 failure scope。`runProductCompositionSync(...)` 与 `runProductCompositionAsync(...)` 是仅有的两个 runner，每次调用只选择其中一个。二者创建当次唯一 `CompositionFailureScope`，产生同形 prepared input，调用同一个 `composeNextAgentApp(...)`，并分别执行 sync best-effort rollback 或 async awaited rollback。async runner 是完整能力路径，也是唯一可以执行 with-frontend commit 前 finalization 的位置。

preparation 的内部顺序固定为 identity/clock → bootstrap metrics → `loadAppCompositionConfiguration(...)` → plugin snapshot load/validation/freeze → product-host defaults → remaining sync/async preload。`systemConfig` 是唯一完整配置事实；显式注入 frozen config 时仍完成 capability reference validation 和 gateway sandbox runtime 两个窄 environment/reference projection，但不得再次读取配置文件。除 configuration entry 外，其他 composition entry 不得读取 config source 或 `process.env`。

`PreparedCompositionInputs` 是 app-private 的唯一 root state。它只包含：

| 字段组 | 稳定内容和直接消费者 |
|---|---|
| `identity` | credential resolver、trusted identity、monotonic clock；供 assembly、gateway、runtime/channel 等窄输入使用 |
| `configuration` | 唯一 `systemConfig`、capability provider reference validation、gateway sandbox runtime projection |
| `observability` | final metrics registry、optional metrics infrastructure/operational writer/runtime logger binding/trace projector、logger factories |
| `plugin` | 单一 frozen snapshot；hooks → lifecycle，policies → assembly/capability/request runtime，providers → capability，diagnostics → 既有安全诊断 |
| `attachment` | final upload config；runtime 与 cleanup 在后续 attachment entry 构造 |
| `model` | 冻结的 model provider profiles、credential resolver、可选 fetch 与 model-gateway provider contributions |
| `assemblyInput` | optional trusted Agent definition |
| `gatewayInput` | gateway providers/bindings、sandbox/maintenance/cron/RAG factories、optional injected sandbox/CLIP runner |
| `capabilityRuntimeInput` | risk evaluator、registered adapter types、SkillHub/background factories、cron id factory、`apiCallPort`（按 `deploymentMode` 选择 LOCAL `createLocalApiCallPort` 或 REMOTE `createRemoteApiCallPort`） |
| `lifecycleWorkflowInput` | lifecycle hooks/definitions/executor 和 workflow factory/mode/remote gateway |
| `channelInput` | channel auth profile、optional local-auth contribution、Web/extension/task registrations 和 protected prefixes |
| `cronInput` | frozen `DISABLED | LOCAL | REMOTE` selection 与 scheduler/callback 分支原始输入；不承载 readiness 结论 |

该类型不得包含 public options、rest-spread options 副本、`unknown` map、动态 key/lookup/setter、`hostKind`、`testMode` 或等价宿主 discriminator。只有两个 preparation entry 可以创建它，只有 `composeNextAgentApp(...)` 可以整体接收它；shared core 不复制或整体下传，所有 module entry 只接收窄 typed input。

shared core 与 preparation 形成 `architecture/ts-backend-architecture.md` 定义的八层 pipeline。core 直接呈现启动贡献、Agent 静态装配、平台基础设施、执行能力、应用服务、runtime/channel 和 app lifecycle/host handoff 七段连续代码；模块内部 selection、adapter construction、optional branch、job registration、diagnostic mapping 和领域结果处理留在权威 module entry 内。不得新增只转发的 stage wrapper、layer aggregate、通用 DI container、字符串 token、可变 service locator 或第二套 root/config type。

shared core 返回 package-private：

```text
ProductCompositionOutcome {
  app: NextAgentApp,
  hostFacts: {
    gatewayReadiness: {
      selectedProviderId,
      deploymentMode,
      gatewaySnapshotRef,
      bindingsReadinessRef
    },
    reportAppStartFailure(error: unknown): void
  }
}
```

`hostFacts` 是只读、安全且不拥有 cleanup 的 handoff，只供 local runtime package private start path 生成既有 provider/readiness proof 和安全 start-failure diagnostic。它不得包含 credential、路径、raw provider error、完整 config 或 closable handle；public factory、local-auth/with-frontend/testing facade、`NextAgentApp` 和 `agent-contracts` 不得暴露该类型。

## 权威 Module Composition Entries

每个 app-local module responsibility 只有一个 root 可调用的权威 entry family。复杂模块可以在同一 family 内按真实前后依赖暴露少量具名 entry；私有 helper 不得被 root 或其他模块当作竞争路径。入口先完成 validation/implementation selection，再创建有副作用或可关闭资源；optional 分支必须收敛为明确 absent/disabled/empty result；构造中途清理本阶段未交接资源，完整 result 返回后一次性交接具名 cleanup。

| 模块 | 权威入口与连续流程 |
|---|---|
| configuration | `configuration-composition.ts`：injected config 或 source evaluation → safe failure telemetry → ready/freeze → capability reference validation → gateway sandbox runtime projection |
| plugin | `plugin-composition.ts`：injected snapshot 优先 → empty/sync/async loader → frozen plugins/providers/policies/hooks/diagnostics；下游不得持有 loader 或 config root。同步和异步 composition 都默认创建 developer diagnostic artifact writer：调用方显式提供的 `developerDiagnosticArtifactWriterFactory` 优先，否则默认使用 `agent-log` 的 `createDeveloperDiagnosticArtifactWriter`，只传入冻结后的 `paths.logDirectory`，不读取 `deployment.mode` 决定能力启用 |
| observability | `observability-composition.ts`：config-failure registry → sync/async writer/metrics preload → projectors → gateway audit-backed completion |
| lifecycle hook | `lifecycle-hook-composition.ts`：definitions → per-assembly materialization → executor；model runtime 通过公开 lifecycle hook port 接入，不在 app 维护第二层 model wrapper |
| assembly | `assembly-composition.ts`：definition/source → compile/graph validation → registry/scopes → package/workspace resolver；baseRegistry 为可变引用，list 方法闭包委托，`readActiveAgentDefinitionFingerprint` 扫描 `agentsRoot` 顶层 agent 目录组合 fingerprint，active/require/list 调用时同步检测变化并重建，重建失败保留上一次有效集合 |
| prompt | `prompt-template-composition.ts`：trusted prompt root validation/registration → builtin templates → unique assembler |
| model | `model-composition.ts`：provider contributions → `createConfiguredModelRuntime(...)` → 单一 `catalog` 与 `invocationService`；provider registration、authorization、hook 和 SDK adapter 逻辑留在 `agent-model` |

Model composition 根据 build-scoped provider capability 注入 registration：默认模式注入 OpenAI-compatible registration；`model-gateway-only` 模式不注入。`agent-app` 只做配置加载、构建能力选择和依赖注入，不 import provider SDK，也不实现 provider 调用、request normalization 或 safe error mapping。
| gateway | `gateway-composition.ts`：provider binding selection → stores/sandbox/maintenance/cron gateway → memory/RAG/fork cleanup → observed sandbox/CLIP |
| memory | `memory-maintenance-composition.ts`：memory opt-in/config gate → tool/provider/diagnostics → LOCAL trajectory/aging/extraction handles；非 LOCAL 返回 empty handles |
| background | `background-task-composition.ts`：optional store → started/completion callbacks → typed runtime timeline proxy；缺 factory 返回 disabled result |
| workflow | `workflow-composition.ts`：node catalog/adapters → injected、REMOTE 或 LOCAL service 的唯一选择 → sub-recipe self-reference |
| capability | `capability-composition.ts`：provider reference preparation → external contributions → subsystem/maintenance → final assembly validation → catalog/invocation/workflow adapters；`createParameterExtractionPort`（包装 `ModelInvocationService.complete()` + agent assembly model profile 解析）和 `apiCallPort`（按 `deploymentMode` 从 `PreparedCompositionInputs.capabilityRuntimeInput` 选择 LOCAL/REMOTE 实现）注入到 `toolDependencies`，供隐藏 `ApiCall` tool 消费 |
| attachment | `attachment-composition.ts`：sync/async upload preload → diagnostics/staged/execution/summary/intake/cleanup runtime → periodic cleanup registration |
| session services | `session-services-composition.ts`：category/session/annotation/Session Activity → suggested/precomputed/category/frequent questions → share service |
| context | `context-engine-composition.ts`：large-content externalizer → fork resolver → summary generator → context engine/observed wrapper |
| health | `health-composition.ts`：session/model/capability probes → evaluator → observed/transition wrapper；composition 不执行 deep check |
| request runtime | `request-runtime-composition.ts`：risk evaluator → policy resolver → coordinator/stores/listeners/terminal/Activity callbacks → pending-timeout lifecycle/subagent targets → observed/tracked commands |
| channel | `channel-composition.ts`：server → trusted projection/resolvers → exactly one Web/auth branch → task registration；返回后 root 立即登记 server cleanup；注入 `AgentSelectionPolicy` 到 runtime，Web/task channel createSession 统一调用 |
| cron | `cron/cron-runtime-composition.ts`：selection + selected gateway → disabled/enabled capability union → LOCAL scheduler 或 REMOTE verifier/handler/route；不得导出独立 preflight |
| app lifecycle | `app-lifecycle-composition.ts`：只构造幂等 `start/close`；不在 composition 中调用 `start()` |
| with-frontend finalization | `entrypoints/with-frontend-finalizer.ts`：manifest resolve/version validation → awaited hosting registration；只由 async runner 在 commit 前调用 |

module entry 不得接收 `CreateNextAgentAppOptions`、`CreateComposedAppOptions` 或 `PreparedCompositionInputs`。module 不反向 import root，不 value-import 其他模块的 composition entry；确需跨模块共享的 deployment predicate 等纯函数位于非 composition helper。

## Product、Package、Test 与 Launcher Surfaces

Host surface 只准备其受信任事实并交给一个 runner，不复制 product core：

| surface | 唯一职责 | 明确禁止 |
|---|---|---|
| `composition/create-local-configured-app.ts` | 创建/选择字段固定的 local-auth contribution，选择 `LOCAL_CONFIGURED_AUTH + NONE`，把原 options/model/provider 交给 sync runner | 不读 auth config、不复制/capture options、不注册 route/plugin、不拥有 rollback |
| `composition/local-configured-auth-channel-contribution.ts` | `agent-app` 内唯一 local-auth 静态依赖点；在 channel invocation 时构造 auth/plugin 和 protected Web/extension registration | 不接收完整 options/config/server，不调用 app factory |
| `entrypoints/with-frontend.ts` | 只投影 `productVersion`、manifest resolver、index scripts、`useDefaultWorkbenchScripts` 和 `WITH_FRONTEND` selection，调用唯一 async runner | 不创建第三个 runner、第二套 local defaults或 post-return registration |
| `local-runtime-package/index.ts` | manifest/layout、一次 config fact、packaged Agent、writer → optional OTLP trace、dispatch/evidence/start/stop，并消费 private host facts | 不二次读 config、不重建 model/gateway/通用 observability、不在 runner 接受后重复 cleanup |
| `local-runtime-package/local-runtime-bindings.ts` | 动态提供窄 local gateway factories、protected prefixes、frontend scripts 和 workbench contribution | 不调用 app factory、不拥有 server/rollback |
| `composition/create-test-composition.ts` | 解释完整 test options、构造 isolated/default test facts、投影 production input、调用同一 runner | 不构造 prepared root、不调用 module entry、不注册 server/plugin、不拥有 failure scope |
| `testing.ts` | test wrappers、observation projection、成功 app 的 test lifecycle registration | 不形成第二个 preparation/core，不泄漏 test-only fields 到 production type |
| 三个 executable entrypoint | 选择公开 factory/profile并调用 `app.start()` | 不读取/规范化 app config、不构造 provider/default、不拥有 composition rollback |
| local gateway public/testing facade | 固定 local defaults且 explicit override 优先；testing 增加 audit/metrics capture | 不编排 module order，不创建第二个 product/test core |
| remote deployment host | 准备 remote contribution并调用一个 public facade，保留自身 start/stop/evidence | 不解释 app core 或 rollback |
| root process host | fatal boundary、start-failure safe log/close/exit status | 不参与 composition rollback |
| local dev / workflow demo host | dev 投影一次 local defaults；demo 通过 testing facade 并仅在 start 前添加既有 CORS hook | 不创建第二个 config/core；demo hook 不得成为产品 registration |

Local、Remote、Test 差异必须在 shared core 前消失。host 只决定 contribution/default，frozen config 决定 capability/deployment adapter；`PreparedCompositionInputs` 和模块 entry 不得分支宿主类型。

channel auth 与 frontend hosting 是两个正交 profile。`DEFAULT_WEB + custom Web` 只调用 custom registration且不调用 extension；`DEFAULT_WEB + no custom Web` 依次注册 builtin Web 和 extension；`LOCAL_CONFIGURED_AUTH` 忽略 caller custom Web，由 local-only contribution 在 protected scope 注册 builtin Web/auth/plugin/extension。三条路径之后都固定为 task → cron → optional frontend hosting，SPA fallback 最后注册。Web/auth/task/cron/frontend failure 终止 composition；只有 workbench unavailable 可以按既有 adapter contract 降级。

local runtime package 的 direct/dispatch LOCAL 路径必须复用同一个 `PreparedLocalRuntimePackageHost`，每次 start 只读取、resolve、validate 和 freeze config 一次。package preflight 先创建唯一 operational writer，再初始化 optional OTLP trace projector，并把两者作为 app-owned injected handles交给 runner；runner 接受前失败由 host cleanup，接受后由 failure scope/app lifecycle唯一关闭。backend-only 与 with-frontend 都调用同一个 async runner；后者只额外携带独立 `ProductHostCompositionInput`。

## Test Host 37 字段映射

`NextAgentTestAppOptions` 的 37 个顶层字段必须由 `create-test-composition.ts` 的 compile-time completeness map 全量消费，并投影为普通 production inputs：

| 字段组 | 字段 | 投影 |
|---|---|---|
| basic/config（11） | `serviceVersion`、`workspaceDir`、`agentDefinition`、`identity`、`channelPort`、`localAuthEnabled`、`modelProfiles`、`toolDisclosureMode`、`skillDisclosureMode`、`clipcDisclosureMode`、`capabilityProviders` | isolated validated config/default Agent、channel auth profile 与 production basic input |
| model（2） | `modelSteps`、`modelRequestSink` | deterministic model 与 request capture wrapper |
| observability（5） | `operationalLogWriter`、`observationLogger`、`metricsRegistry`、`metricsExporter`、`traceProjector` | explicit production observability input 或 test wrapper；ownership 服从下节 |
| lifecycle（4） | `lifecycleHooks`、`lifecycleHook`、`lifecycleHookDefinitions`、`hooks` | production lifecycle/Agent definition projection |
| gateway/runtime/capability（9） | `sandboxGateway`、`sandboxGatewayFactory`、`scheduledMaintenanceGatewayFactory`、`ragRetrievalFactory`、`backgroundTaskStoreFactory`、`riskPolicyEvaluator`、`clipCommandRunner`、`gatewayProviders`、`skillHubAccessFactory` | explicit override 优先，否则 local test defaults |
| cron（6） | `cronTaskGatewayFactory`、`cronTaskSchedulerFactory`、`cronTaskIdFactory`、`cronDeploymentMode`、`cronTriggerCallbackCredentialRef`、`cronTriggerCallbackRegistration` | cron config/default/override projection |

新增、删除或重命名字段时，completeness map、投影与行为测试必须同时更新；不得通过 `testMode` 分支、字段丢弃或第二条 test pipeline 兼容。

## Deferred Bindings

`createCompositionDeferredBindings()` 固定承载 lifecycle hook invocation、workflow capability invocation、workflow runtime adapters、runtime subagent execution 和 background runtime timeline 五类真实循环。每类只允许一次成功绑定，重复绑定 fail closed。未绑定时，lifecycle hook invocation 返回 `{ status: "CONTINUE", boundary }`，workflow capability/runtime adapters/subagent lookup 返回 `undefined` 并由实际必需消费者 fail closed，background runtime timeline 的 event emission 返回 typed failure。普通依赖必须通过有序参数传递，不得新增第六类 holder 字段、optional-chaining 静默丢事件或平行 mutable 回填，除非先由 OpenSpec 证明阶段重排无法消除循环。

## Composition Failure Ownership

只有 `runProductCompositionSync(...)` 和 `runProductCompositionAsync(...)` 可以创建、commit 或 rollback `CompositionFailureScope`。scope 只记录 `{ stage, cleanup }`，不保存 service、config、credential、token、retry 或 start policy。模块构造中途负责清理未交接的本阶段资源；完整 result 返回后，root 立即登记 app-owned cleanup。runner 接受前的 host failure 由 host 清理，一旦 runner 接受按既有 `NextAgentApp.close()` 契约归 app-owned 的 injected handle，host 不得再次关闭。

ownership 固定为：

| 类型 | commit 前 | commit 后 |
|---|---|---|
| operational writer、metrics infrastructure、completed projector host、gateway bindings、runtime logger binding | runner 接受或创建后立即登记 | app lifecycle flush/shutdown/close/unbind |
| scheduled maintenance、cron scheduler、trajectory worker、memory aging/extraction schedulers、RAG resources、cron store、request runtime、Fastify server、cron callback registration | module完整返回后按具名 handle 登记；构造中途由 module 清理 | app lifecycle 按现有顺序 stop/close |
| capability validation、Web/task readiness、RAG build callable、system config | 不登记 cleanup，只作为 start/read-only input 或 frozen fact | lifecycle只调用 validate/ready/build/read |
| model service、provider definitions/factories、metrics registry、identity/credential resolver、test sinks、channel contribution | 保持 caller-owned，无 app close contract，不伪造 cleanup | caller 继续拥有 |

`AppLifecycleCompositionInput` 的 exhaustive ownership map 当前必须覆盖：

- `APP_OWNED_CLEANUP`：`scheduledMaintenance`、`cronTaskScheduler`、`taskTrajectoryWorker`、`memoryAgingSchedulers`、`memoryExtractionSchedulers`、`cronTriggerCallbackRegistration`、`runtime`、`server`、`projectorHost`、`ragRetrieval`、`ragKnowledgeGovernance`、`gatewayBindings`、`closeCronTasks`、`operationalLogWriter`、`runtimeLoggerProviderBinding`、`metricsInfrastructure`。
- `START_READINESS_ONLY`：`capabilitySubsystem`、`webChannelRegistration`、`taskChannelRegistration`、`ensureRagKnowledgeBuilt`。
- `PURE_FACT`：`systemConfig`。

新增 lifecycle input 未分类时必须编译或 architecture validation 失败。optional field缺省或数组为空不登记 cleanup；存在值时逐项按既有 stop/close/unbind contract 登记。

rollback 按登记逆序且至多一次。sync rollback best-effort 触发并处理 thenable rejection但不等待；async rollback逐项等待 settle。cleanup error 不覆盖原始 safe failure，不得泄漏 raw config、credential、路径或 provider error。只有完整 app、channel/cron registration、lifecycle 和 optional frontend finalization 全部完成后 runner 才能 commit；commit 后 failure scope 放弃 authority，正常 close 归 app lifecycle。`app.start()` failure 不属于 composition rollback。

## 核心设计落点

- 在 config freeze 后创建唯一 `agent-log` operational writer，为各 product owner派生可信 component adapters，并把同一 writer接到 observation-derived structured transport；业务 package不创建 concrete logger。product logger 的 `component` 使用 owning package 短名 `agent-*`，package 内角色、adapter 或子流程使用 `source`；架构验证拒绝 product source 中与 owning package 不一致的静态 component binding。
- 组合 deployment-selected top-level audit gateway和 OTel metrics infrastructure：LOCAL选择独立 audit/metrics file owner，REMOTE只接受 trusted entrypoint注入，不做 local fallback；app通过 `metricsReadiness()` 暴露 bounded `READY|DEGRADED` output readiness，REMOTE缺 endpoint时业务仍 ready但 metrics reason为 `METRICS_EXPORTER_UNAVAILABLE`。
- `createAppOperationalLogWriter()` 要求显式、有效的 `serviceVersion`，缺失或非法值在创建 writer 前以 `APP_SERVICE_VERSION_INVALID` 失败，不回退到硬编码 `1.0.0` 或其它共享占位值；packaged local/remote entrypoint 使用 validated manifest 的 `createRuntimePackageServiceVersion()`，非 packaged entrypoint 从当前构建 package metadata 注入 version，metrics 和 OTel resource 复用同一已验证 serviceVersion。
- 生命周期关闭按 stop producers、drain projectors、close audit、metrics forceFlush/shutdown、记录 shutdown completed、最后 flush/close operational writer执行；单个 finalizer failure不能跳过后续 finalizer。
- 只向 Workbench注入 current-active operational identity；不注入 directory、archive或 metrics/audit reader。

- 落实 `architecture/ts-backend-architecture.md` 的唯一 composition root 和 package dependency exception。
- 落实 `architecture/core-contracts.md` 的 app-facing config outcome：raw config、AgentDefinition parser/compiler DTO 和 provider adapter config 不跨 package 暴露。
- 落实 `architecture/configuration-boundary.md` 的 startup config validation/freeze、secret reference resolvability、`DefaultSystemConfig` 唯一完整配置事实、`ConfigValidationEvidence` 安全投影和 local product branch authentication composition。
- 落实 `architecture/configuration-boundary.md` 的配置根模型：`default-system.yaml` 是内置默认配置，用户 `application.yaml` 是覆盖层；`configRoot` 承载用户配置相对路径解析，`workspaceRoot` 承载 SQLite、logs、运行数据和 execution workspace state；`paths.agentRoot` / `paths.skillRoot` 归一化为 `agentsRoot` / `systemSkillsRoot`，省略时默认 `agents` / `skills`，`sqliteFile` 和 `runtimeWorkspaceRoot=<workspaceRoot>/execution` 仍只从 trusted frozen config 派生。
- 作为 Capability Result 呈现策略的唯一配置 owner：在 ready 前校验 `nextAgent.system.capability-result-presentation`，以 `SUMMARY` default 和内置精确 `capabilityId` 基线合成深冻结的窄 `CapabilityResultPresentationPolicy`，再向 local configured、trusted product 与 IR Web channel 注册路径注入同一快照。只接受 `STATUS_ONLY` / `SUMMARY` / `DETAIL`；重复、未知、越界或 `HIDDEN` 配置 fail closed。app 不实现结果 projector、不持久化策略，也不允许请求、Agent package、模型、Capability 或前端覆盖该快照。
- 作为 channel 监听配置的唯一 env override owner：`applyChannelEnvOverrides` 纯函数在既有 env-ref 解析后、schema validation 前，被 application config loader 和 local runtime package config loader 复用，分别独立解析 `NEXTAGENT_CHANNEL_HOST` / `NEXTAGENT_CHANNEL_PORT` 并覆盖 `channel.host` / `channel.port`；非法值保持 schema-invalid 由既有安全诊断阻断 ready。app lifecycle 保持单一 Fastify `listen` 路径，`channel.host` 是监听地址唯一事实，不设置 `ipv6Only`、不新增 `ipFamily` 或第二 listener。local runtime CLI 把 `::` 与 `0.0.0.0` 投影为 `localhost`，IPv6 literal 输出方括号 URL。LOCAL_CONFIGURED_AUTH 入口在 channel route registration 前执行 host guard，最终 host 只接受 `localhost`、`127.0.0.1`、`::1`；DEFAULT_WEB 不受限。行为契约见 `network-connectivity` spec。
- 不注册 framework/reserved provider identity 的权威清单。`builtin-tools`、`builtin-skills`、`builtin-agents`、`local-skills-system`、`local-skills-agent-owned`、`local-agents`、`local-subagents`、`memory-tools` 等 provider 由 owning package 通过 startup provider contributions 进入 `agent-capability`。`agent-app` 只提供 trusted `configRoot`、Agent package locator、external owner contributions 和其他窄依赖，并使用 `CapabilitySubsystem.capabilityProviders` 作为跨模块 ready gate 的 provider fact 输入。
- 作为本地 TypeScript 插件的 startup composition owner：只从 trusted `nextAgent.system.plugins[]` 显式列表加载插件，校验 `plugin.json`、`apiVersion`、相对 `configRoot` 的路径 containment、single-file ESM bundle、host external declaration 和 default factory shape；不做目录扫描、glob、URL/remote loading、archive 解包、private `node_modules`、runtime hot load 或 marketplace 分发。加载后的插件贡献按 owner 边界转交：capability provider 给 `agent-capability`，lifecycle hook 给 startup hook registry，policy executable 给 `agent-runtime` policy registry。`agent-app` 不拥有 provider、hook 或 policy 的业务执行逻辑。
- plugin loader 的稳定流程是：解析 system config `plugins[]`（最多 8 个）-> 将相对 path 解析到 frozen `configRoot` 下并做 containment -> 读取同目录 `plugin.json` -> 校验 manifest schema、safe plugin id、manifest/export id 一致性、plugin author version、plugin API version、`artifactType=esm-bundle`、`main` 相对 `.js` 文件和 host external declaration -> 对 main bundle 做静态 import specifier 扫描 -> dynamic import single-file ESM bundle -> 对 default export 执行 plain plugin 或 factory materialization -> 校验 provider/policy/hook contribution shape -> 冻结 plugin registry snapshot。任一步失败都使用 safe plugin/config diagnostic；required plugin 或被 Agent activation 引用的插件失败必须阻断 readiness。
- `createComposedApp` / `createNextAgentApp` 和异步入口都支持从受信 `pluginSystem.plugins[]` 生成同等冻结 `PluginRegistrySnapshot`；调用方显式提供 trusted `pluginRegistrySnapshot` 时不得再次读取插件目录。异步入口可以 await 返回 `Promise<NextAgentPlugin>` 的 plugin factory；同步入口在没有预加载 snapshot 时必须对 async factory fail closed，并只输出 safe reason code。
- `plugin.json.apiVersion` 是 NextAgent plugin API contract version，不是插件作者发布版本。缺省时先使用 plugin export `apiVersion`，再使用当前 host latest supported version；显式 unsupported version 必须在接受任何 contribution 前 fail closed。`definePlugin(...)` root helper 当前写入固定 `"1.0"`，后续多版本只能通过后续 OpenSpec 变更扩展。
- host external injection 只允许 manifest 声明且 host inventory 开放的 `typebox` / `ajv`。使用 host external 的插件 default export 必须是 factory，host object 初始只包含 `{ externals }`；bundle 内不得保留 `import`、`export ... from` 或字符串字面量 `import(...)` runtime specifier。`agent-app` 不解析插件私有 `node_modules`，不安装依赖，也不把 logger、gateway、filesystem、workspace root、credential 或 raw config 注入插件。
- Agent definition compiler 拥有插件 activation 编译：`capabilityBindings` 继续作为 Tool authority；`hooks` 编译为 `AgentAssembly.hooks`；`policies` 编译为 implementation-free `AgentAssembly.policies`，包含 `policyPointId`、`pluginId`、`policyId`、`enabled`、可选 `timeoutMs` 和 validated `config`。缺失 plugin/policy/hook、reserved/unknown policy point、duplicate enabled policy point、invalid config 或 unsupported hook stage/order 都必须在 startup/assembly 阶段 fail closed；runtime 不保留 unavailable activation 状态。
- 提供 trusted Agent package source locator：按 frozen `configRoot/agents/{agentId}` 定位 Agent package，按 `configRoot/agents/{agentId}/skills` 暴露 Agent-owned local Skill root 给 `agent-capability`，不得回退到 `AgentAssembly.workspaceDir/skills`。
- 提供 trusted Agent package source locator：按 frozen `agentsRoot/{agentId}` 定位 Agent package，按 `agentsRoot/{agentId}/skills` 暴露 Agent-owned local Skill root 给 `agent-capability`，不得回退到 `AgentAssembly.workspaceDir/skills`。
- 作为 lifecycle hook 的唯一产品路径装配 owner：trusted startup composition 只接收显式 `LifecycleHook` 对象注册并冻结为 runtime snapshot。`agent-app` 负责 hook registry、AgentDefinition `hooks` 解析/编译、startup validation 与 snapshot 注入，但不再把目录扫描、manifest 解析或 `hooksRoot` 作为产品路径 hook source root。具体职责包括：
  - **Config 校验与 configure(config) 物化**：若 hook definition 提供 `configSchema`，assembly compiler MUST 在启动期按该 schema 校验对应 Agent hook entry 的 `config`；否则只做 safe JSON object 校验。validated config MUST 只在启动期通过 `configure(config)` 闭包为 configured executable，运行期 `HookInput` 不携带 config。
  - **Per-AgentAssembly configured executable 隔离**：相同 `hookId` 被不同 AgentAssembly 使用不同 config 时，startup materialization MUST 生成彼此隔离的 configured executable。runtime 按 accepted run 固化的 `agentAssemblyRef` 选择 executable，不得只按全局 `hookId` 复用最终 configured executable。
  - **maxHooksPerStage 强制**：framework-owned startup setting，默认 8。assembly compiler MUST 在发布 AgentAssembly 前按每个 lifecycle stage 计算 effective hook 总数（enabled SYSTEM + enabled CUSTOM，经 disablement 和 stage narrowing 后）；任一 stage 超过 `maxHooksPerStage` 时 assembly compile fail closed。runtime 不得截断、降级或只取前 N 个。`maxHooksPerStage` 不可被 Agent 配置，不支持 per-Agent 或 per-stage override。
  - **`system.output-redaction-guard`**：推荐首个内置 `SYSTEM` hook，声明 `kind=SYSTEM`、`supportedStages=["BEFORE_AGENT_TERMINAL"]`、`effects=["TRANSFORM","CONTROL"]`、`failureMode=FAIL` 和显式 system order。该 hook SHOULD 提供 `configSchema` 和 `configure(config)` 支持 per-Agent 额外 pattern、分类阈值、redaction token 或 block policy。config 只表达 pattern/policy data，不得表达脚本、表达式 DSL、远程策略 URL、owner/agent scope override、hook outcome 或 mutation payload。该 hook 在 agent-core 判断正常退出、最终 `finalContent` 已形成后、final-content event 发送前运行：可确定安全脱敏时返回完整替换后的 `AgentTerminalMutation.finalContent`；无法安全脱敏或高风险泄漏时返回 `BLOCK`。检测与脱敏必须 bounded、deterministic，不在 request path 进行远程网络调用。`HOOK_INVOKED` / logs / metrics / audit / control signal / diagnostics 不得输出 raw `finalContent`、raw finding、路径、credential、手机号或客户标识，只输出类别、数量、safe digest 和安全 reason code。
- 在 startup Agent assembly 中注册 Agent package `prompts/`：`agent-app` 只负责 trusted package root containment 和向 context-engine prompt registry 传递 `agentId`、`agentVersion`、prompt root path；prompt manifest schema、template compilation、template selection 和 rendering 由 `agent-context-engine` 拥有，runtime-facing `AgentAssembly` 不携带 prompt text、prompt root path、template refs 或 prompt id allowlist。
- 装配 invoked Agent discovery source：builtin Agent package 资源、local top-level Agent package 和 local subagent package 都编译为同一个 runtime-safe `AgentAssembly` shape；同一个 app-owned assembly registry/source 实现同时服务 `AgentAssemblyRegistry` 和 `agent-capability` 的 Agent discovery source。`agent-app` 不把 raw `agent.yaml`、package paths、subagent package body 或 provider-private loading facts 暴露给 catalog/model/runtime。
- `AgentAssemblyRegistry` 和 `AgentDiscoverySource` 必须读取同一批 compiled `AgentAssembly` facts。`AgentAssemblyRegistry.active/require` 服务 runtime acceptance、recovery 和 execution lookup；`AgentDiscoverySource` 只服务 capability discovery enumeration。两者接口分离，但实现不得各自扫描文件或各自维护不一致缓存。
- `AgentAssemblyRegistry` 支持运行时动态刷新：`assembly-composition.ts` 把 baseRegistry 作为可变引用，`readActiveAgentDefinitionFingerprint` 扫描 `agentsRoot` 下所有顶层 agent 目录的 agent.yaml 组合 fingerprint（不覆盖 `agents/{parentAgentId}/subagents/`），active/require/list 方法调用时同步检测 fingerprint 变化并重建 baseRegistry。重建复用启动时编译边界；重建失败 try-catch 保留上一次有效集合并通过 structured log 记录（`agent.registry.refresh_failed`）。并发请求不阻塞：当前请求同步完成重建后返回新集合，重建期间到达的新请求使用上一次有效集合响应。已 accepted request 通过 `require(agentId, agentVersion)` 继续使用 frozen assembly，不受重建影响。
- `AgentAssemblyRegistry.active(agentId)` 支持查找任意已注册 user-invocable agent，不限制为 configured `activeAgentId`；查找失败返回 missing-assembly safe failure，不合成 implicit default assembly。
- `agent-app/src/composition/agent-selection-policy.ts` 提供 `DefaultAgentSelectionPolicy` 默认实现（safeId 格式校验 + fallback `defaultRouteAgentId` + fail closed），由 `channel-composition.ts` 注入 runtime。`AgentSelectionPolicy` 接口定义在 `agent-contracts/agent-assembly`，runtime createSession 调用 `resolve(headerAgentId, defaultRouteAgentId)` 产出 agentId + safe reason code，再经 `assemblyRegistry.active(agentId)` 校验后绑定到 session。Web channel 和 task channel 的 createSession 统一调用，不在 channel 层做格式校验或 brand。`workspaceFileExtensionPolicies` 从静态 Map 改为从 `assemblyRegistry.require()` 动态获取，使刷新后新增的 agent 能正确解析 workspace file extension policy。
- builtin Agent packages、top-level local Agent packages 和 parent-local subagents 都使用同一 Agent definition parser/compiler。`agent-app` 可以在 startup 阶段对 trusted builtin package defaults 做产品配置归一化，但不得从 request input、descriptor metadata、model output、capability arguments 或 provider config 推导 Agent definition facts。
- parent-local subagent 只作为 package-scoped candidate input；父 `AgentAssembly` 不嵌入 child assembly、raw subagent package、prompt body、Skill body、source path 或 provider-private loading key。`parentAgentScope` 写在 child assembly 上，Catalog 只消费 compiled facts 计算 request-scope visibility。
- 落实 `architecture/model-provider-boundary.md` 的二级 model provider profile 校验、冻结以及 credential resolver / provider contribution / 可选通用 `FetchGateway` 注入。
- 作为 plugin API `1.2` runtime services host 的装配 owner：在 plugin preload 前创建 deferred runtime services host，把稳定 facade 提供给 factory；在 assembly、capability、model 与 prompt composition 完成后一次性绑定 `AgentAssemblyRegistry`、`CapabilityCatalog`、`CapabilityInvocationPort`、`ModelSelectionService`、`ModelInvocationService`、`PromptTemplateResolverPort` 六个 targets，未绑定调用与重复绑定 fail closed。app 同时创建 registry-backed `PromptTemplateResolverPort` 实例并绑定到需要该 public port 的 composition consumer；app 不拥有 router 的 model/template sequencing 或选择算法。
- `agent-app` 只把 model-gateway provider 和可选 fetch 交给 `createConfiguredModelRuntime(...)`；catalog、provider binding、authorization、lifecycle hook 与推理实现均由 `agent-model` 内部完成。local 模式可不装配 fetch，remote adapter 也不会仅因 deployment selection 或环境变量而自动启用模型推理。
- 落实 `architecture/runtime-boundaries.md` 的主路径装配：runtime、Web channel、session、core、context、model、capability、SQLite gateway、no-op hook/checkpoint/audit 和 observability 都由本 package 显式注入。
- 装配 gateway registry 时按 selected gateway entry 解析 provider，而不是按 deployment mode 选择唯一 provider。LOCAL 默认必须选择 `working-memory`、`long-term-memory` 和保留 `sqlite` 三个 persistence adapter entries，并把完整 `WorkingMemoryGatewayBindings`、`LongTermMemoryGatewayBindings` 和 `SqliteGatewayStoreBindings` 合并成 app 内部依赖对象后注入 runtime/session/context/attachment/memory/observability consumers。缺失、歧义、重复 binding 或 provider 返回未选择 binding 必须在 ready 前 fail closed。
- 为 runtime startup recovery 显式注入可信 hosted-agent selection 的 `recoveryAgentId`，以及进程生命周期内稳定、并发实例间不同且不含 owner、路径或 credential 的 recovery holder id。`agent-app` 不从 Web 请求、客户端 metadata、模型输出、capability 参数或 default route fallback 推导 recovery ownership。
- `session-services-composition.ts` 创建唯一 `SessionActivityService`；`request-runtime-composition.ts` 把已提交的 acceptance、pending-input 和 terminal/timeline 变化接到该 service 的 invalidation callback，再通过只注入 trusted active `agentId` 的 `RuntimeSessionActivityPort` facade 交给 channel。app 只做 wiring，不派生 Activity 状态、不决定 consume，也不把 channel 直接接到 `agent-session`。
- channel composition 必须把 `RuntimeSessionActivityPort` 作为 builtin Web 的 required dependency；缺失时 readiness fail closed，不能以空 snapshot、no-op port 或隐藏 Activity route 降级。session 删除成功后由 app 连接 durable delete 与 Activity invalidation，但两者保持独立 owner。
- app lifecycle 的 startup 顺序固定为 runtime recovery 完成后启动 pending-input timeout processing，首次 due/incomplete recovery 完成后才能进入 server readiness；future deadline 由 runtime timer继续处理。close 顺序先关闭 server 接收新工作，再关闭 runtime timeout processing，最后关闭 Session Activity subscribers。app 不实现 timer、clock、batch、退避或 timeout state transition。
- 装配 session fork 所需依赖：把 context-engine owned `ForkActiveContextSelectionPort`、gateway-local fork prefix/composite/promotion ports 和 session read model 注入 runtime/session facade；注册 fork-promotion cleanup scheduled maintenance job。`agent-app` 只做 wiring 和 job 注册，不拥有 fork 业务语义、message projection、promotion 可见性或 cleanup candidate policy。
- 装配 runtime-owned risk policy evaluator 及其依赖，把 capability invocation 前、sandbox execution 前和 authorization pending input 恢复所需的专用 evaluator contract 注入 runtime/受限执行边界；`agent-app` 只负责 trusted composition，不拥有 policy 决策真相、pending input lifecycle 或 `POLICY_APPLIED` timeline truth。
- 装配 Agent policy registry/resolver implementation：把插件贡献的 policy executable 与 AgentAssembly policy activation facts materialize 后注入 `agent-runtime`；各 policy point owner 只依赖 `agent-contracts` 中的 resolver 接口。`agent-app` 不调用 routing policy、不实现 fallback policy，也不保存运行期 policy 状态。
- 作为推荐问题能力的唯一接线 owner：当 `SuggestedQuestionPort` 及其依赖可用时，`agent-app` 负责把 owner-scoped、agent-scoped run lookup、主模型调用依赖和 Web route 需要的 port 注入产品路径。推荐问题生成不进入 runtime lifecycle，不写 canonical timeline，也不复用 memory/extraction worker 路径。
- 调用 `createCapabilitySubsystem({ ... })` 并注入返回的 `CapabilityCatalog` / `CapabilityInvocationPort`；capability provider config 使用 `agent-contracts/capability` owning contract。`agent-app` 将 validated provider configs、owner package external contributions、trusted resolver/gateway/adaptor options 传给 capability subsystem，并消费返回的 `capabilityProviders`、`validateStartupRegistration()`、scan report 和 cleanup jobs。Tool registration、ToolCatalog mutation、Tool executor routing、`WorkspaceFilePort`、workspace/sandbox request preparation 和 capability cleanup policy 留在 `agent-capability`；`agent-app` 不读取最终用户 Tool 配置文件，也不通过配置创建 Tool。
- 作为长期记忆的唯一接线 owner：读取并冻结 `nextAgent.memory.*`，选择 disabled/local/remote memory gateway port，向 memory consumers 注入 `longTermMemoryStore`、`longTermMemoryRetriever`、`taskTrajectoryStore` 和 `taskTrajectoryQuery` 的 selected public ports；`agent-app` 不实现 memory record、trajectory、extraction、aging 或 retrieval policy。
- 按 memory exposure gate 装配 model-facing memory tools：只有 `MemoryConfig.status === VALID`、当前 AgentAssembly 显式绑定 `providerId="memory-tools"` 的 `search_memory` / `get_memory_detail` / `add_memory`、并且 selected memory backend 可用时，才调用 `agent-memory` public contribution factory 并把 returned `memory-tools` provider contribution 传入 capability subsystem。memory Tool catalog construction、provider id、Tool definitions、executor support 和 memory provider semantics 归 `agent-memory` owning；`agent-app` 不手写 memory Tool 清单或在 composition root 中承载 memory Tool 业务。
- 在 LOCAL memory backend 下装配 task trajectory listener/worker、memory extraction scheduler、memory aging scheduler 和 L2 detail revival helper；这些后台能力必须在 terminal commit 关键路径之外运行，并在 shutdown 时停止。REMOTE complete-service memory backend 下，本地 worker/scheduler/helper 不得启动。
- trusted app composition 拥有 Tool/Skill/CLIP disclosure mode 的冻结配置，并把 `tool-disclosure-mode`、Skill deferred disclosure 与 CLIP `tool-search` disclosure 作为 trusted capability composition facts 注入 `agent-capability` / `agent-context-engine`；客户端请求体、模型输出、Skill metadata 或 Tool 参数不得覆盖 disclosure mode。
- `agent-app` owns SkillHub provider ready-state validation、`gatewayId`-based remote adapter selection and wrapping、managed install/cache reference validation and injection. startup/readiness may register the provider and adapter dependency, but must not trigger remote Skill content refresh, normalized staged folder fetch, committed install publication or installed-index mutation before request-scope catalog loading. Concrete SkillHub URL、credential、HTTP path、wire DTO、archive decode and single-file normalization remain inside gateway/deployment adapter boundaries.
- `agent-app` 是 `RagRetrievalGateway` 和本地 RAG knowledge governance 的唯一装配 owner：它基于当前 deployment shape、compiled active Agent workspace read scope 和 trusted workspace root 选择 retrieval provider，冻结 `rag.indexes` 默认 logical indexes（含 app config loader 已解析的 `env:<NAME>` 结果）并作为 `rag` Tool dependency 注入，装配 startup governance lifecycle，并把 provider-private实现隔离在 gateway/app composition 边界之后。
- 装配 accepted-run execution workspace resolver dependencies：把 derived `runtimeWorkspaceRoot`、runtime-facing `AgentAssembly.workspacePolicy` provider 和 gateway/platform deployment mode 显式注入 runtime/capability/sandbox composition。Agent definition compiler 在启动期把 `workspacePolicy.files.readDirectories/writeDirectories` 编译为 root-qualified canonical directories（`.` 为 `workspace`，普通无前缀目录为 `workspace/<directory>`，已知 root 保持前缀；区分缺省与显式空集合，写目录自动加入有效读权限），请求路径只使用冻结结果。`agent-app` 不把启动期静态 `workspaceDir` 注入 `createCapabilitySubsystem(...)`、file port、sandbox port 或 Tool descriptor。
- 注册 `agent-capability` 返回的 cleanup/maintenance jobs 到 runtime/gateway scheduled execution facility。`agent-app` 只做注册和依赖装配，不实现 `WorkspaceFilePort` cleanup、Skill projection、staging、lock、snapshot 或 temp cleanup policy，也不直接调用 workspace file operations。
- 装配后台任务 completion callback 时，自然完成只委托 completion callback 记录任务终态和关联 timeline event，不调用 `RuntimeCommandPort.submit`、不创建新的 RequestRun、也不写入新的 USER 消息。用户通过受信 channel 显式 kill 仍可走 `bg-notify-<taskId>` 幂等通知续跑路径；该路径是 kill 操作的反馈边界，不是普通后台任务自然完成的默认 Agent 续跑机制。
- 向 runtime 注册 `AgentConstructor[]` 和 Agent runtime dependencies；不拥有 Agent instance cache、reuse 或 execution lifecycle policy。
- 装配 observability 时，`agent-app` 负责把 runtime timeline listener、approved wrappers、`ObservabilityProjectorHost` 和 fixed projector set 连接为唯一产品路径；不保留 direct logger/audit/metrics write 的平行路径。
- `agent-app` 是 OTel observability adapter 的唯一装配 owner：显式决定是否启用 `TraceProjector`，为 unified `MetricsRegistry` 选择 LOCAL cumulative NDJSON exporter或 REMOTE entrypoint-injected OTLP exporter，并在 composition 边界初始化 tracer/meter/provider/exporter/propagator依赖及 readiness monitor；runtime/core/model/capability/gateway/channel不得自行初始化这些依赖。
- 落实 `architecture/fullstack-packaging-boundary.md` 的产品入口、运行包 manifest、前端包消费、静态托管注册和 route fallback ownership。
- 多宿主前端正式交付时，`with-frontend` 仍只消费 packaged artifact 和 hosting manifest；页面沉浸式入口与 `piu/AIAgentPIU.js` / `piu/AIAgentPIU.css` 都属于前端 artifact，后端不解释 Prel/PIU handler，也不装配 mock prelude。
- 落实 `architecture/local-runtime-packaging.md` 的本地运行包 entrypoint、manifest/layout validation、package profile 和 `PackageCandidateEvidence` handoff ownership。
- `pack:release -- skip` 仍必须执行本地运行包的 fail-closed packaging validation：暂存每个 runtime workspace package 后校验 `package.json.exports` 的运行时 `import` / `require` target 已进入候选包，归档后从新解压的 candidate root 执行正式 `nextagent-self-check`。`skip` 只跳过耗时的 release E2E gate，不得跳过 export 完整性、解压布局或 package-relative ESM resolution 验证。
- 落实 `architecture/release-qualification-flow.md` 的 `release:qualify` 固定命令 orchestration、safe result normalization 和 `ReleaseQualificationResult` 唯一 verdict shape。
- local configured auth 只能由显式 local product entry 装配 `agent-channel-web-auth-local`；default/backend-only/with-frontend 产品入口不得隐式包含 local auth。
- Web runtime bootstrap 的 `transportKind` 必须由可信 app/channel config 决定，并由 channel 投影给前端；前端只能消费该事实。

## 替换边界

否。`agent-app` 选择替换包，但自身是唯一 composition root。

## 验证关注点

- default app dependency graph 不包含 local auth package。
- local configured authentication 通过显式 product entry/factory import `agent-channel-web-auth-local`。
- `backend-only` 入口不依赖前端托管插件或前端包，且前端包缺失不阻断启动。
- `with-frontend` 入口只通过 `resolveFrontendHostingManifest()` 读取 asset root、`index.html`、base path 和 SPA fallback，并在 manifest 非法时 fail closed。
- bootstrap/transport 测试覆盖 `transportKind` 来自 app/channel config，不能由前端 build-time env 覆盖。
- app composition tests 必须覆盖唯一 Session Activity service/facade、trusted Agent Scope、channel required port、runtime fact invalidation、session delete notification，以及 activity/runtime/channel owner 不被 app 复制。
- app lifecycle tests 必须覆盖 recovery → timeout recovery → readiness 的启动顺序和 server → runtime timeout → Activity 的关闭顺序；缺失 timeout/Activity dependency 必须 fail closed。
- Capability Result 呈现配置测试覆盖默认值、内置基线、exact override、Unicode/count 边界、非法值阻止 ready、深冻结和三条 Web composition 路径注入同一策略。
- product manifest tests 覆盖 `backend-only.package.json` 不声明前端依赖，以及 `with-frontend.package.json` 精确依赖根版本一致的 `@nextagent/agent-web`。
- 不引入 runtime dynamic plugin loading、hot loading、remote implementation loading 或隐藏 DI。
- 下游 package 不读取配置文件、`process.env` 或内置 config path；产品 composition 不能选择 deterministic/test provider。
- 用户配置只能通过 `paths.workspaceRoot` 影响运行根，通过 `paths.agentRoot` / `paths.skillRoot` 影响 local Agent package 和 system Skill 资源根；`paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.sqliteFile`、`paths.runtimeWorkspaceRoot`、`paths.executionRoot` 和 raw `capabilityProviders.providers` 中的 framework/reserved provider 声明必须 fail closed 或被拒绝进入 capability provider contribution assembly。
- `runtimeWorkspaceRoot` 必须保持为 `workspaceRoot/execution`，不得与 SQLite/data/config/provider/source-private roots 重叠；execution workspace resolver、file port、sandbox port 和 cleanup job 装配不得从 raw config、client input、model output、Skill metadata 或 capability arguments 接收物理 root。
- Agent-owned local Skill discovery 只通过 trusted locator 使用 `agentsRoot/{agentId}/skills`；`workspaceDir/skills`、client input、model output、manifest metadata、descriptor metadata、runtime command 或 capability arguments 都不能覆盖 locator roots。
- lifecycle hook 产品路径只允许来自 trusted startup app/plugin composition 已装配的显式 `LifecycleHook` 对象；Agent package 只能通过 `agent.yaml.hooks` 声明 activation，runtime、core、channel 和 capability 不得自行扫描 hook 目录、读取 hook manifest、动态导入 hook 模块或在请求主路径热加载 hook code。
- plugin 产品路径只允许来自 trusted startup system plugin list；插件 bundle 必须通过 manifest/API version/path containment/static scan/host external 校验后才能贡献对象。Agent package 只能通过 `capabilityBindings`、`hooks` 和 `policies` 激活插件贡献；runtime/core/capability/channel 不得在请求主路径动态导入插件或读取插件 manifest。
- Agent discovery source 只从 app-owned compiled assembly set 枚举 builtin/top-level/subagent Agent；`agent-capability`、runtime、context 和 model 不得自行扫描 `agents/`、`subagents/`、builtin Agent package root 或 raw `agent.yaml`。
- Agent package `prompts/` 注册只发生在 startup/synchronous assembly path；request path 不读取 prompt files，也不从 `AgentAssembly` 或 runtime command 读取 prompt root。
- Memory configuration disabled/invalid、memory tools 未 opt-in、remote complete-service backend、task trajectory worker、extraction scheduler、aging scheduler 和 archived revival helper 的接线条件必须有 app composition/integration tests 覆盖；配置或 scheduler 诊断不得包含 prompt、memory content、raw path、credential、token 或 raw storage/provider error。
- release qualification 不接受调用方预制 verdict、package evidence 或跳过必需检查的参数。
- Alpha E2E gate 验证：`npm run test:e2e:alpha`（覆盖 `alpha-01` 到 `alpha-06` 六个核心用例）

## Public Exports

`@nextagent/agent-app`，`@nextagent/agent-app/packaging`，`@nextagent/agent-app/release`，local configured authentication 的显式产品入口，以及 `backend-only` / `with-frontend` 产品入口。

## CLI Executable and Observability Mode Composition

App composition reads the trusted `CLIPC_EXECUTABLE_DIRECTORY` environment variable at startup, validates it, and injects it as the `clipc` executable locator into the restricted local sandbox gateway dependency. The locator is specific to `clipc` and does not create a runtime-configurable arbitrary executable registry. App composition also consumes the frozen `sandbox.enabled` value from `DefaultSystemConfig` and passes it to both the restricted local sandbox gateway and the builtin Bash tool config as the authoritative local validation-mode switch. `sandbox.enabled=true` keeps deny-governed validation while still allowing non-denied shell built-ins and shell composition to execute inside the sandbox boundary. `sandbox.enabled=false` skips denylist command rejection for trusted local Bash execution while still forcing execution through the sandbox dependency and keeping adapter-owned cwd/env/timeout/cancellation/output controls. App composition also owns the product-path mapping from local restricted-sandbox rejection reasons back to existing capability safe errors: `unsupported-executable` maps to `COMMAND_NOT_ALLOWED`, `unsafe-path` maps to `CAPABILITY_PATH_REJECTED`, and only true adapter unavailability remains `SANDBOX_UNAVAILABLE`. App composition also consumes the frozen `observability.logging.redaction` value from `DefaultSystemConfig` and passes it as the authoritative logging mode to the `StructuredLogProjector` and `ObservabilityProjectorHost` through the startup composition boundary. In `debug`, app composition may additionally wire `rawToolInputLogging=true` into the tool loop dependencies so that only the runtime diagnostic log `toolInput` field carries raw tool arguments; structured logging, audit, metrics, traces, and safe errors remain sanitized.

## FrequentQuestionService Composition

App composition 组装 `FrequentQuestionService` 实现 `FrequentQuestionPort`，依赖 `CategoryQuestionResourceDiscovery`（内存目录）、`UserQuestionActivityStoreGateway`（DB 持久化）、`AgentAssemblyRegistry`（解析 agent scope）和配置项 `frequencyThreshold`、`pinLimit`。合并排序 5 层来源：fixed 静态问题（locale 过滤）→ pinned 问题（不按 locale 过滤，pinned_at DESC）→ high-frequency 问题（不按 locale 过滤，ask_frequency DESC）→ 剩余静态问题（locale 过滤）→ 空列表时前端 fallback。按 `question_hash` 去重。Submit/edit 路径注入 `ask_frequency` fire-and-forget 增长逻辑，cancel/retry 不增长。Port 注入到 Web channel 的 `frequentQuestions` 依赖。

`FrequentQuestionPort` 还承载输入联想查询 `listQuestionAssociations`：接收必填 `keyword`（trim 后非空）和可选 `locale`，在 service 层全量加载三层来源（pinned / high-frequency / static），对每层做 case-insensitive 子串匹配（`text.toLowerCase().includes(keyword.toLowerCase())`），按 `question_hash` 去重，按优先级 pinned > high-frequency > static 排序，cap 级联填充（pinned=10、high-frequency=5、static=5，剩余 slot 回填），top 20 截断。联想三层排序不同于 `listFrequentQuestions` 的五层排序：static 层将 fixed 和非 fixed 合并为一层，不保持 fixed 优先；pinned 和 high-frequency 不按 locale 过滤，static 按 locale 过滤。每条联想结果带 `source` 来源标签（`"pinned" | "high-frequency" | "static"`），纯视觉展示用。关键词过滤在 service 层 in-memory 完成，不引入 gateway LIKE 查询。`registerTrustedIdentityWebChannel` 透传 `frequentQuestions` port 到 Web channel。
