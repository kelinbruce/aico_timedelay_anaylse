## 0. 固定串行前置

- [x] 0.1 确认 `add-ts-runtime-operational-log-hardening` 与 `add-otlp-trace-export` 的实现已完成且其最终writer/trace初始化、safe diagnostic和close语义已进入稳定基线；允许归档状态滞后，但两项剩余工作只能是验证/归档收尾，并已确认在本change实施期间不再并行编辑`create-app.ts`、observability composition、app lifecycle或local runtime package。本change不得重定义其contract；在该基线上重新运行local package、logging和OTLP targeted tests并记录结果。
  验证：两项change的未完成task只包含模型检视、全量验证或strict validation，不包含重叠装配路径实现；已确认实施期间无并行编辑；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts tests/local-runtime-package.test.ts`通过。
  来源：proposal实施前置；design决策1.1与Incremental Delivery。

## 1. 固化装配行为基线

- [x] 1.1 为同步与异步入口补充等价性 characterization，覆盖相同 frozen config、model、plugin snapshot 和 gateway injection 下的完整 `NextAgentApp` projection：`server`、`runtime`、`sessions`、`gateway`、`assemblyRegistry`、optional `auditWriter`、`metricsRegistry`/`metricsReadiness()`、`health`、`modelProfileRegistry`、`capabilityProviders`、`systemConfig`、`productModelProviderKind`、`start` 和 `close`；同时断言sync/async plugin preload在config后只形成一次同形frozen snapshot，hooks/policies/providers/diagnostics分别进入既有lifecycle、assembly/request policy、capability和安全诊断/characterization消费者，product model kind、capability providers、model profiles、health/readiness语义一致。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts`
  来源：`Scenario: 同步和异步入口共享同一装配核心`。

- [x] 1.2 为现有可选子系统补充产品行为 characterization，覆盖 workflow、memory tools/maintenance、question services、background task、attachment/upload cleanup、cron、RAG governance、Web/local auth/workbench/frontend hosting/task channel 和 observability 的 enabled/disabled/absent availability；cron逐一固定`DISABLED`无capability/runtime、`LOCAL` scheduler、`REMOTE` callback route，以及selected gateway、scheduler factory、callback credential/registration单项缺失时的既有safe error code/category/retryability。多项同时缺失时记录当前顺序，但明确不把root REMOTE precheck优先锁成目标；最终gateway-first与REMOTE credential-first顺序由任务5.1/6.1按新阶段契约验收。按design Channel precedence matrix分别固定custom Web覆盖且不调用extension、default Web后调用extension、local auth忽略custom Web并在protected scope注册Web/extension，以及task→cron→frontend顺序。保持未选中cron分支输入不生效、真实callback `ready()`仍在app start、local auth 与 default/custom Web route 互斥、frontend SPA fallback precedence、protected prefixes、operational active identity projection，以及 with-frontend public input override、local gateway/workbench defaults、default-workbench script 注入条件和 candidate evidence/version validation。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/background-completion.test.ts packages/agent-app/tests/cron-delivery-composition.test.ts packages/agent-app/tests/metrics-exporter-composition.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts packages/agent-app/tests/suggested-question-service.test.ts packages/agent-app/tests/frequent-question-service.test.ts packages/agent-app/tests/question-association-service.test.ts`；相关 product entrypoint、`tests/agent-kernel` 与 `tests/contract` targeted tests 通过，并记录 host input/default/evidence 与 route/profile 差异。
  来源：`Scenario: composition refactor 保持产品行为`。

- [x] 1.3 为 app start/close 和 startup failure 补充 characterization，固定 ready 前失败、正常 start、幂等 close、worker/scheduler/job 启停、normal shutdown 顺序及 safe `APP_START_FAILED` 投影；明确八层 composition 在返回 `NextAgentApp` 时结束，composition failure scope 不接管之后的 `app.start()` 失败，也不把当前 start failure-time 资源遗留锁成期望行为。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/app-lifecycle-composition.test.ts packages/agent-app/tests/composition.test.ts`
  来源：`Scenario: 装配失败清理尚未交接资源`；design “Failure scope 是有意且受限的可靠性修正”。

- [x] 1.4 按 design 决策 8 建立可执行的 public input/output/host fact 防丢 characterization：逐字段覆盖所有 `CreateNextAgentAppOptions`/`CreateComposedAppOptions` 进入唯一 preparation projection；覆盖正交channel auth/frontend hosting profile、local-only auth contribution、with-frontend `productVersion`/manifest resolver/index scripts、local runtime package manifest/config/Agent/writer→OTLP trace/hosting kind/evidence handoff，以及 `NextAgentTestAppOptions` 全部37个顶层字段按 basic/config、model、observability、lifecycle、gateway/runtime/capability、cron 分组进入 test-host projection；覆盖 active Agent assembly refresh、trusted recovery Agent/holder identity、fork cleanup registration、capability maintenance jobs、audit/metrics readiness、protected prefixes、operational active identity、frontend hosting registration、host defaults、candidate evidence、isolated test config/default Agent、test lifecycle registration、package-private`ProductCompositionOutcome.hostFacts`与public app隔离，以及 design 决策6中每个app-lifecycle input的closable/start-only/pure-fact归属。任一事实缺少consumer或验收时先修design/tasks，不在实现中删除。
  37字段机械核对清单：`serviceVersion`、`workspaceDir`、`agentDefinition`、`identity`、`channelPort`、`localAuthEnabled`、`modelProfiles`、`toolDisclosureMode`、`skillDisclosureMode`、`clipcDisclosureMode`、`capabilityProviders`、`modelSteps`、`modelRequestSink`、`operationalLogWriter`、`observationLogger`、`metricsRegistry`、`metricsExporter`、`traceProjector`、`lifecycleHooks`、`lifecycleHook`、`lifecycleHookDefinitions`、`hooks`、`sandboxGateway`、`sandboxGatewayFactory`、`scheduledMaintenanceGatewayFactory`、`ragRetrievalFactory`、`backgroundTaskStoreFactory`、`riskPolicyEvaluator`、`clipCommandRunner`、`gatewayProviders`、`skillHubAccessFactory`、`cronTaskGatewayFactory`、`cronTaskSchedulerFactory`、`cronTaskIdFactory`、`cronDeploymentMode`、`cronTriggerCallbackCredentialRef`、`cronTriggerCallbackRegistration`。
  验证：`npx tsc -b --pretty false`；相关 `packages/agent-app/tests/composition.test.ts`、`tests/local-runtime-package.test.ts`、`tests/fullstack-packaging-boundary.test.ts`、test-host/entrypoint、runtime recovery、gateway fork cleanup、metrics/observability targeted tests通过；source/type review逐行对照决策8输入映射、系统事实映射和决策6 ownership表无遗漏。
  来源：`Scenario: composition refactor 保持产品行为`；design 决策 8。

- [x] 1.5 建立完整装配 surface characterization 与只读 inventory，覆盖 `create-app.ts`、所有module entry、`create-local-configured-app.ts`、`create-test-composition.ts`、`testing.ts`、三个entrypoint、`local-runtime-package/index.ts`、`local-runtime-bindings.ts`、`packages/agent-platform-gateway-local/src/{entrypoints/local,testing}.ts`、remote deployment、`src/main.ts`、`scripts/start-dev-backend.mjs`和`scripts/start-demo-workflow-server.mjs`；对每条路径记录触发入口、config/options解释点、正交profile/default选择、server/plugin/hook registration、closable handoff、factory/core调用、start/close和直接黑盒验收。证明无装配决策的schema/parser/evidence/leaf helper不需要修改。
  验证：新增architecture/source characterization实际发现当前未分类的完整options copy、重复config read、host-side registration、provider/default construction或重复cleanup；修复后inventory中每个职责信号都映射到design决策1.1一个surface，且leaf negative fixture不被误判。
  来源：`Scenario: 所有真实装配 surface 都进入唯一职责路径`；design 决策1.1、4.2、7。

- [x] 1.6 建立sync factory compatibility inventory：盘点`agent-app`公开exports、`testing.ts`、local configured auth、local gateway public/testing facade、remote deployment、root/dev/demo hosts以及architecture/contract/kernel/e2e/smoke tests中的全部sync调用链，记录每个调用方为何仍可同步准备或未来需迁移。本change保留全部既有public sync signature和黑盒结果，只把内部语义收敛到唯一sync runner；不删除、废弃或偷渡迁移任何sync API。若实施证据显示sync已无必要，只记录独立follow-up change的public export/caller migration范围，不扩大本change。
  验证：type/export characterization覆盖全部已有sync factory；与sync等价性tests共同证明signature、safe failure、app projection和既有caller可达；`git diff`无public sync export删除或deprecation。
  来源：`Scenario: 同步和异步入口共享同一装配核心`；proposal/design sync compatibility决策。

## 2. 收敛配置和入口 preparation

本节每个任务勾选前，除完成列出的命令外，还必须按 design 4.1 对应模块条目核对前置输入、内部有序决策、typed output/消费者和 optional/failure/cleanup；不能只证明代码归入了同一文件。

- [x] 2.1 新建 `configuration-composition.ts`，实现唯一 `loadAppCompositionConfiguration(...)`：复用现有 config evaluate/ready/freeze 和 memory config failure telemetry，创建 capability reference validation port并解析 gateway sandbox runtime input；显式 injected config 不再读取配置文件。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts packages/agent-app/tests/composition.test.ts`；negative test 触发其他 composition entry 二次读 config/env 并断言失败。
  来源：`Scenario: agent-app 只执行一次配置加载`；design 决策 2。

- [x] 2.2 在 `create-app.ts` 建立 `prepareCompositionInputsSync(...)`、`prepareCompositionInputsAsync(...)` 和字段固定的 `PreparedCompositionInputs`；两条路径均按identity/clock → bootstrap metrics → config → plugin snapshot load/validation/freeze → product-host defaults → remaining startup contribution preload顺序逐字段投影。按 design 决策 1 和决策 8，channel input只含正交`channelAuthProfile`、optional local-auth contribution和现有Web/extension/task字段，不含frontend/package host kind；cron input从frozen config只投影app-private `deploymentSelection: DISABLED | LOCAL | REMOTE`和原始分支依赖，`DISABLED`仅规范化现有未启用/缺省状态，不修改config schema或执行scheduler/callback prerequisite validation。禁止保留完整 options、rest-spread options 副本、动态 key、lookup、setter、`unknown` service map、`hostKind`、`testMode`或`LOCAL | REMOTE | TEST`等价discriminator。只有这两个preparation entry可以创建`PreparedCompositionInputs`，host/test facade不得直接构造该root state。`composeNextAgentApp(...)` 是唯一整体接收该 prepared type 的 core，模块 entry 只能接收窄投影，且不得新增同形 root input type。
  验证：`npx tsc -b --pretty false`；任务 1.1、1.4、1.6；source/type guard 证明除 public/host/test facade signatures、恰好两个execution runner和两个production preparation entry外，无其他函数接收完整public options；只有preparation逐字段读取production fields，runner保持对象identity并原样传递；只有 shared core 引用完整 prepared root type，所有模块 entry 均不引用 public options/prepared root type，testing facade 只调用同一runner；negative fixture对prepared/core中的`hostKind`、`testMode`或宿主分支实际失败。
  来源：`Scenario: public options 不穿透 preparation 边界`；design 决策 1。

- [x] 2.3 新建 `plugin-composition.ts` 的 sync/async preload entry，复用现有 plugin loader，统一injected snapshot优先、empty frozen snapshot和required/optional plugin failure semantics，返回同形且只创建一次的frozen `PluginComposition`。固定消费映射：hooks只给lifecycle definitions/materialization，policies给assembly/capability validation/request runtime policy，providers给capability external providers，diagnostics只给既有safe diagnostic/characterization路径；下游不得接收loader/config root或reload plugin source。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/plugin-loader.test.ts packages/agent-app/tests/plugin-host-externals.test.ts packages/agent-app/tests/plugin-activation-compiler.test.ts packages/agent-app/tests/plugin-routing-policy-order.test.ts packages/agent-app/tests/composition.test.ts`；normal/boundary/failure tests覆盖injected、empty、sync、async、required failure、optional degraded diagnostic及四类snapshot字段消费者；source/architecture negative fixture断言capability和其他下游不能调用loader或读取config root。
  来源：`Scenario: plugin snapshot 在入口 preparation 一次加载并冻结`；design 决策 3、4。

- [x] 2.4 扩展 `observability-composition.ts`，只保留依赖驱动的 config-failure registry preparation、sync/async preload、projector bootstrap 和 gateway audit-backed completion；两个 preload entry 返回同形 output，保持 injected registry → infrastructure registry → bootstrap registry 的现有选择顺序。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-app/tests/metrics-exporter-composition.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts packages/agent-app/tests/runtime-logging-config.test.ts`。
  来源：design 决策 3 的入口 preparation/平台基础设施层；质量属性“审计/可追溯性”。

- [x] 2.5 扩展 `attachment-composition.ts` 的 sync/async preload entry，只确定最终 upload config 并执行既有异步 startup temp cleanup；不在 preload 创建 attachment runtime 或注册 periodic job。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-attachment-runtime/tests/chat-upload-config.test.ts packages/agent-attachment-runtime/tests/upload-temp-cleanup-job.test.ts`。
  来源：design 决策 3 的入口 preparation；`Scenario: 同步和异步入口共享同一装配核心`。

- [x] 2.6 将 product model 的 injected/default 选择收敛到 `model-composition.ts` preparation entry，输入只包含 model service、provider kind、credential resolver、model gateway providers 和 frozen config；同步/异步入口复用相同规则。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/model-provider-configuration-contracts.test.ts`；任务 1.1。
  来源：design 决策 1、4；`Scenario: public options 不穿透 preparation 边界`。

- [x] 2.7 在 `local-runtime-package/index.ts` 建立字段固定的 package host preparation result：manifest/layout、config sample ref、一次read/env resolve/validation/freeze、packaged Agent definition、candidate/service version和package hosting kind；在同一preflight中按已冻结契约先创建唯一operational writer、再初始化optional OTLP trace projector，并把二者作为app-owned injected handles交给runner。`startRuntimePackage` 的LOCAL dispatch把同一result交给app-private local start，直接`startLocalRuntimePackage`仅在没有prepared result时执行一次相同preparation。product configuration entry接收injected config且不得重读文件；package evidence继续消费同一个validation fact。
  验证：`npx tsc -b --pretty false`；`tests/local-runtime-package.test.ts`分别覆盖direct local、deployment-dispatch local、with-frontend package、invalid config、trace absent/invalid/ready；read/validation spy断言每次start恰好一次，writer creation ordinal早于trace init，evidence/active Agent/hosting kind不变；failure injection断言runner接受前由host cleanup、接受后不double-close；negative test触发dispatch后第二次读取并断言失败。
  来源：`Scenario: local runtime package 复用一次 package config fact`；design 决策1.1、2、4.2。

## 3. 归位全部真实 module、host、test 和 launcher 装配事实

本节每个模块的实现和验证以 design 4.1 的内部流程、每个host/test/launcher以design 4.2的流程为验收路径。属于装配surface的事实无论位于root、composition、entrypoint、local-runtime-package或testing文件都必须归位；不拥有装配决策的leaf implementation不得因目录相邻被修改。每个任务用normal、optional/boundary和failure tests证明结果。

- [x] 3.1 扩展 `assembly-composition.ts`，收拢 root 中 Agent definition/source locator、resource references、assembly registry/scopes、package source locator 和 execution workspace resolver；保持现有 compiler、startup validation、Agent Scope 和 Owner Scope 语义。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.2 扩展 `lifecycle-hook-composition.ts`，只收拢 root 中 definitions、assembly materialization 和 lifecycle model wrapper；三者按真实前后依赖暴露具名 entry，保持 hook stage/order/config/failure semantics。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/plugin-routing-policy-order.test.ts tests/agent-kernel/lifecycle-hook-stage-owner-integration.test.ts tests/agent-kernel/lifecycle-hook-per-assembly-isolation.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.3 将 sqlite parent、runtime workspace 和 shared data root 三项目录操作收敛为一个简单 app-private helper，在 config/assembly validation 成功后、任何依赖目录的 module entry 前调用；不新增 `startup-foundation-composition.ts` 或 stage object。
  验证：`npx tsc -b --pretty false`；目录 failure injection 返回既有 safe startup failure；source review 确认 root 不再展开三次 `mkdirSync`。
  来源：design 决策 3、4；`Scenario: 顶层流程按宏观层级连续可读`。

- [x] 3.4 扩展 `model-composition.ts`，收拢 root 中 model profile registry、capability model patch resolver 和 safe model diagnostics；保持单一 model registry，移除 root 对 diagnostics helper 的直接调用，不为此重写 owner model behavior。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts`；`npx vitest run --config vitest.config.contract.ts tests/contract/model-profile-context-window.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.5 扩展 `gateway-composition.ts`，接收 configuration-owned sandbox runtime input，移除 `process.env` 读取，并收拢 root 中 observed sandbox 和 CLIP runner 接线；把gateway/cron共用的deployment selection predicate移到app-private `config/gateway-selection.ts`纯helper并由preparation复用，保持 binding/store/RAG/maintenance/cron selection语义。selected cron binding/factory缺失继续在gateway消费点返回既有safe failure；gateway entry返回具名cleanup handles且不产出cron runtime readiness。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/gateway-observability-linking.test.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/risk-policy.test.ts`。
  来源：`Scenario: agent-app 只执行一次配置加载`；design 决策 2、4。

- [x] 3.6 扩展 `memory-maintenance-composition.ts`，把 root 中 memory-tool opt-in、tool port、provider、diagnostics/observers/telemetry 收敛到 capability-facing entry，并让现有 maintenance entry 复用该结果创建 trajectory/aging/extraction worker/scheduler。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/memory-runtime-integration.test.ts tests/agent-kernel/task-trajectory-integration.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.7 新建 `background-task-composition.ts`，收拢 optional store、start/completion callbacks 和 typed runtime timeline proxy；factory 缺失返回明确 disabled result，删除 root 中 mutable runtime 回填和 optional-chaining timeline fallback。正常产品顺序下 target 必须在 callback 可调用前完成绑定；非法提前调用 fail-closed 是 proposal 明确列出的第二项受限可靠性修正。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/background-completion.test.ts packages/agent-app/tests/composition.test.ts tests/agent-kernel/background-tasks-endpoint.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4、5。

- [x] 3.8 扩展 `capability-composition.ts`，收拢 assembly 前 provider reference preparation，以及 assembly 后 external provider 汇总、subsystem、maintenance registration、final assembly validation、catalog/invocation 和 workflow runtime adapters；保持 provider config 只解析一次。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/plugin-policy-inventory.test.ts packages/agent-app/tests/skill-catalog-query-port.test.ts packages/agent-capability/tests/catalog.test.ts packages/agent-capability/tests/plugin-provider.test.ts`；`npx vitest run --config vitest.config.contract.ts tests/contract/skill-catalog-contract.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.9 扩展 `attachment-composition.ts` runtime entry，收拢 root 中 diagnostics、staged/execution/summary/intake/cleanup runtimes 和 periodic upload cleanup registration；job 只注册，启动/停止继续由 scheduled-maintenance lifecycle owner 负责。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-attachment-runtime/tests/attachment-intake.test.ts packages/agent-attachment-runtime/tests/attachment-execution-runtime.test.ts tests/agent-kernel/attachment-reserve-submit.test.ts`。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.10 扩展 `request-runtime-composition.ts`，收拢 root 中 risk evaluator selection、request lifecycle coordinator/listeners、lifecycle binding output、subagent execution 和 observed/tracked commands；保持 request lifecycle ownership 和状态语义不变。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/risk-policy-contract.test.ts`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/risk-policy.test.ts packages/agent-app/tests/composition.test.ts tests/agent-kernel/risk-policy-sandbox.test.ts tests/agent-kernel/risk-policy-enforcement.test.ts tests/agent-kernel/runtime-foundation.test.ts`。
  来源：`Scenario: agent-app 只执行依赖注入`；design 决策 4。

- [x] 3.11 扩展 `channel-composition.ts` 的唯一权威 entry family：`composeProductChannelLayer(...)` 收拢 root 中 prompt/inventory resolver、memory/background/sandbox adapter、access logger，并只接收`channelAuthProfile`与optional local-auth typed contribution，不接收frontend/package host kind。按design Channel precedence matrix固定三条分支：custom Web覆盖且不调用extension；builtin Web后调用extension；local-auth contribution忽略custom Web并在protected scope完成auth config validation、auth/plugin construction、Web/extension registration和readiness。三条分支随后统一task→cron，frontend finalization在唯一async runner中最后执行。shared channel不得import local-auth或frontend hosting package。create result返回前失败由create entry关闭尚未交接server；完整返回后root立即登记唯一server cleanup，后续cron/with-frontend finalization失败只由runner rollback关闭，避免重复close。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/skill-catalog-query-port.test.ts tests/agent-kernel/web-boundaries.test.ts tests/agent-kernel/web-stream-transports.test.ts tests/agent-kernel/background-tasks-endpoint.test.ts tests/agent-kernel/local-configured-auth.test.ts`；三行precedence matrix的normal/failure test通过；architecture guard断言channel module不import local-auth/frontend hosting package且server cleanup只登记一次。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4。

- [x] 3.12 扩展 `cron/cron-runtime-composition.ts` 的 capability composition 与 runtime composition entry，收拢 root 中 cron port/observation/scheduler/callback wiring，并删除 cron 对 gateway composition entry 的 value import。capability entry只接收`deploymentSelection + optional cron gateway`并返回区分disabled/enabled deployment的typed union；runtime entry只按该union switch，`DISABLED`返回empty，`LOCAL`在创建scheduler时要求factory，`REMOTE`在创建verifier和注册route时依次要求credential与registration。未选中分支输入不检查；分支内prerequisite helper保持module-private。为保证校验后移前failure ownership先成立，本任务只建立最终entry与direct module tests，root早期validator的删除由完成failure scope后的任务5.1一次性执行。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cron-delivery-composition.test.ts packages/agent-app/tests/cron-trigger-callback-handler.test.ts packages/agent-app/tests/cron-trigger-callback-verifier.test.ts packages/agent-app/tests/composition.test.ts`；direct module tests覆盖三种deployment、未选中分支输入忽略、四个既有safe error和REMOTE credential-first顺序；type/source assertion证明capability input不含server/scheduler/credential/registration，runtime只消费typed capability result。
  来源：`Scenario: cron deployment prerequisite 由消费阶段校验`；design 决策 4。

- [x] 3.13 对照 design 4.1 复核 `prompt-template-composition.ts` 的 trusted root validation → optional Agent root registration → builtin registration → assembler 流程；现有入口满足时不改生产代码，不满足时只做该 entry 内最小收敛。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.architecture.ts tests/architecture/prompt-template-assembly-boundary.test.ts`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts tests/agent-kernel/config-assembly.test.ts`；覆盖 root 不存在、越界/非目录和 registration conflict。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 Prompt template。

- [x] 3.14 对照 design 4.1 复核 `workflow-composition.ts` 的 node catalog/adapters → injected/REMOTE/LOCAL selection → sub-recipe self-reference 流程；只在 deferred proxy 签名或流程连续性确有缺口时修改。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/workflow-remote-composition.test.ts tests/contract/workflow-package-composition.test.ts tests/contract/workflow-tool-safety.test.ts`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/workflow-loop-config-validation.test.ts packages/agent-app/tests/composition.test.ts`；覆盖 remote gateway 缺失和 proxy 提前调用。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 Workflow。

- [x] 3.15 对照 design 4.1 复核 `session-services-composition.ts` 的 category catalog → session facade → annotation → suggested/precomputed → category/frequent → share 流程，确认输出只服务 runtime/channel 且不混入 channel DTO 或 request lifecycle。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts packages/agent-app/tests/frequent-question-service.test.ts packages/agent-app/tests/question-association-service.test.ts packages/agent-app/tests/composition.test.ts`。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 Session services。

- [x] 3.16 对照 design 4.1 复核 `context-engine-composition.ts` 的 large-content externalizer → fork-promotion resolver → summary generator → context engine → observed wrapper 流程，确认只消费上游 model/prompt registry。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/context-assembly-contracts.test.ts tests/contract/model-profile-context-window.test.ts`；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-context.test.ts packages/agent-app/tests/composition.test.ts`。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 Context engine。

- [x] 3.17 对照 design 4.1 复核 `health-composition.ts` 的 probes → evaluator → observed wrapper → transition diagnostics 流程，确认 composition 不执行 deep check，runtime degradation 仍返回 safe result。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/health-composition.test.ts tests/agent-kernel/health-check.test.ts packages/agent-app/tests/composition.test.ts`。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 Health。

- [x] 3.18 对照 design 4.1 复核 `app-lifecycle-composition.ts` 的完整-handle precondition、固定 start 顺序、幂等 best-effort close 顺序和准确 failure stage；只接收已完成装配结果，不重新选择 factory/provider。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/app-lifecycle-composition.test.ts packages/agent-app/tests/composition.test.ts`。
  来源：`Scenario: 模块内部装配流程连续可读`；design 4.1 App lifecycle。

- [x] 3.19 重构 `create-local-configured-app.ts` 为local-auth host facade，并新增app-private `local-configured-auth-channel-contribution.ts`作为唯一local-auth dependency adapter：adapter实现不捕获options/config/server的字段固定`LocalConfiguredAuthChannelContribution`，facade只选择`channelAuthProfile: LOCAL_CONFIGURED_AUTH`与`frontendHostingProfile: NONE`，并把原`CreateNextAgentAppOptions`/`CreateComposedAppOptions`引用、contribution、显式model和provider kind交给同一sync runner。facade删除完整options spread/copy/capture、auth config读取、直接Web/plugin/workbench registration和composition catch；adapter contribution只在任务3.11的channel stage被调用并在那里构造auth/plugin与registration。
  验证：`npx tsc -b --pretty false`；`tests/agent-kernel/local-configured-auth.test.ts`覆盖invalid config、login/cookie/SSE/WS、custom Web被local-auth覆盖、protected prefixes、workbench和default Web互斥；source guard断言facade没有options spread/capture、auth config read、直接`registerWebChannel`/`server.register`，同时断言adapter是agent-app唯一local-auth static import且不接收完整options/调用app factory，generic/channel/backend/with-frontend均无该依赖。
  来源：`Scenario: 产品宿主注册在同一 failure scope 内完成`；design 4.2 Local configured auth host。

- [x] 3.20 将 `local-runtime-bindings.ts` 固定为local host adapter：返回完整且字段固定的local gateway factory set、frontend scripts/protected prefixes和单个workbench contribution；保留workbench unavailable不阻断local runtime的既有降级，同时保证default Web/local auth/task registration failure不被该adapter吞掉。禁止其调用app factory、读取完整prepared state、拥有server lifecycle或composition rollback。
  验证：`npx tsc -b --pretty false`；local runtime/workbench tests覆盖factory export缺失、workbench absent/degraded、read port/access scope和protected prefix；architecture negative fixtures对adapter调用app factory、持有failure scope或直接post-core registration实际失败。
  来源：`Scenario: 所有真实装配 surface 都进入唯一职责路径`；design 4.2 Local gateway/workbench adapter。

- [x] 3.21 重构 `create-test-composition.ts` 和 `testing.ts` 为单一test-host surface：按design决策8逐字段保存37个`NextAgentTestAppOptions`的override/default语义，构造isolated config/default Agent、deterministic model、observation capture和local gateway defaults后投影为普通production input，只调用同一sync或async runner；local auth只通过fixed profile选择。禁止直接构造`PreparedCompositionInputs`、调用module composition entry、复制production config loader/channel registration/failure scope；test cleanup只登记成功返回的app和临时路径。
  验证：`npx tsc -b --pretty false`；type/source completeness test逐字段对照37字段映射；现有kernel/e2e调用点按basic/config、model、observability、lifecycle、gateway/runtime/capability、cron七组各有override/default黑盒验收；negative fixture对test host自建core/module order/registration/rollback实际失败。
  来源：`Scenario: test host 保持完整注入能力但不形成第二条产品 pipeline`；design 4.2 Test host/Public testing facade、决策8。

- [x] 3.22 收敛 `entrypoints/backend-only.ts`、`entrypoints/local-configured-auth.ts` 和 `entrypoints/with-frontend.ts` executable main 为thin launcher：只选择公开factory/profile、传递可选launcher-level config locator并调用`app.start()`；移除with-frontend main中的local gateway动态加载/default construction。不得添加config evaluation、provider/model/observability construction、server/plugin registration或composition rollback；package host不套用本任务。
  验证：backend-only/local-auth/with-frontend entrypoint tests与fullstack dependency-graph test通过；source/architecture guard断言launcher只有factory/profile/start职责，并对provider construction、config parse、`server.register`和rollback negative fixture实际失败。
  来源：`Scenario: executable entrypoint 只承担 launcher 职责`；design 4.2 Thin launchers。

- [x] 3.23 按design 1.1/4.2收敛并characterize external host surfaces：`agent-platform-gateway-local` public facade保持`localGatewayCompositionDefaults(...)` export、固定local defaults与explicit override优先，testing facade保持同策defaults、audit capture、metrics default与成功app关联；remote deployment只构造remote contribution并调用一个public runner；`src/main.ts`保留fatal boundary与start-failure close/exit；dev script保留一次local gateway/workbench projection；workflow demo保留testing runner、pre-start CORS hook、workflow mock与signal close。只有唯一handoff需要时才窄改，禁止第二个config/core、module entry调用或composition rollback。
  验证：local gateway entrypoint/testing tests覆盖每个default/override、SkillHub、audit/metric readback；remote integration通过；process-fatal/start-failure test通过；dev/demo smoke或source characterization证明一个runner、CORS hook在start前且无post-start product registration。architecture negative fixtures对external host自建core/module order/rollback实际失败。
  来源：`Scenario: 所有真实装配 surface 都进入唯一职责路径`、`Scenario: external hosts保持各自黑盒职责`；design 1.1、4.2、8。

## 4. 集中真实循环和受限失败资源 ownership

- [x] 4.1 扩展 `createCompositionDeferredBindings()`，新增 background runtime timeline proxy/target，使 holder 恰好包含 lifecycle、workflow capability、workflow runtime adapters、runtime subagent、background timeline 五类真实循环。
  验证：`npx tsc -b --pretty false`；deferred binding unit tests 断言五类字段存在且无第六类；source search 确认主 pipeline 无同义 deferred `let`。
  来源：`Scenario: 真实循环依赖通过受控绑定完成`；design 决策 5。

- [x] 4.2 为五类 binding 补充重复绑定 negative tests，固定 lifecycle hook invocation 的 neutral `CONTINUE`、workflow capability/runtime adapter/subagent optional lookup 的 `undefined`，并为 background runtime timeline 非法未绑定调用及普通依赖误入 holder 补充实际失败断言。
  验证：运行新增 deferred tests 与 `npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；结果覆盖五类重复绑定失败、四类既有未绑定 neutral lookup 和 background timeline 未绑定 event emission typed failure。
  来源：`Scenario: 真实循环依赖通过受控绑定完成`；AGENTS.md negative case 门禁。

- [x] 4.3 新建 `composition-failure-scope.ts`，只实现具名 cleanup handle 的逆序、once、commit、`rollbackSync()` best-effort trigger 和 `rollbackAsync()` sequential awaited settle；sync rollback 对 thenable cleanup 附加 rejection handler 但不等待，禁止存放或查询服务、配置、token、retry、`app.start()` rollback 或正常 shutdown policy。
  验证：unit tests 覆盖 empty、reverse order、once、commit 后不 rollback、cleanup failure 不覆盖原错误、sync thenable rejection 不产生 unhandled rejection 和 async cleanup 逐项等待；`npx tsc -b --pretty false`。
  来源：`Scenario: 装配失败清理尚未交接资源`；design 决策 6。

- [x] 4.4 在`create-app.ts`建立恰好一个app-private sync runner和一个app-private async runner，只允许这两个runner在preparation前创建并持有当次唯一failure scope，将同一scope显式传给preparation和shared core。public/host/test facade不创建scope，一次调用链只进入一个runner；禁止public-facade-to-public-facade delegation导致嵌套runner、重复preparation或第二scope。shared core不捕获、不commit、不rollback。sync runner在core返回完整outcome后commit；async runner在无host input时直接commit，仅在持有with-frontend typed host input时于typed finalization成功后commit；sync runner统一catch调用`rollbackSync()`，async runner统一catch等待`rollbackAsync()`。
  验证：runner unit/source tests断言恰好两个runner、每条public/test/package调用链只有一个runner和scope、无重复preparation；sync/async failure分别触发`rollbackSync()`/await `rollbackAsync()`，core成功后只commit一次，with-frontend host input存在时finalization ordinal严格位于core return与commit之间；architecture negative fixture对facade-owned scope、嵌runner、第三个runner和core commit/rollback实际失败。
  来源：`Scenario: 同步和异步入口共享同一装配核心`、`Scenario: 装配失败清理尚未交接资源`；design决策1、6。

- [x] 4.5 按design决策6逐资源固定ownership acceptance，并建立`composeAppLifecycle(...)` input的compile-time completeness map：injected/created writer、metrics infrastructure、gateway bindings、projector host、scheduled maintenance、cron scheduler、trajectory worker、全部memory aging/extraction schedulers、RAG retrieval/governance、cron store/callback registration、request runtime、server和runtime logger binding在runner接受或module完整返回后立即登记；capability validation、Web/task readiness、RAG build callable、system config显式分类为无cleanup；model/provider/factory/metrics registry/test sink/contribution保持caller-owned不登记。host只清runner调用前失败，不得在runner接受后的catch重复关闭。
  验证：type test在新增未分类app-lifecycle input时失败；在configuration/preload、observability、gateway、capability、memory scheduler/worker、runtime、Web/local auth/frontend/task channel、cron、runtime logger和local package handoff阶段注入失败，逐行对照ownership表断言后续阶段未执行、app-owned handle逆序且至多关闭一次、host无double-close、caller-owned/start-only input不关闭、async cleanup顺序等待settle、原始safe failure不被覆盖；特别覆盖server已登记后REMOTE缺credential、credential存在但缺registration以及route registration抛错，断言app不返回、server/既有资源只清一次且callback registration仅在成功返回后登记；commit后不rollback，正常close characterization保持通过。
  来源：`Scenario: 装配失败清理尚未交接资源`；proposal 第一项受限可靠性修正。

## 5. 收敛八层共享 core 和架构护栏

- [x] 5.1 在任务4.3-4.5的failure scope与cron晚失败清理证据通过后，用唯一 `composeNextAgentApp(preparedInputs, failureScope)` 替换 `composeBoundApp(...)`，按 design 决策 3 的七个 core 层级组织连续代码段，与按config → plugin snapshot load/validation/freeze → host defaults/remaining preload显式排序的入口preparation共同形成八层完整app composition；删除exported `validateCronRuntimeComposition(...)`及root/startup contribution调用，不新增同义standalone validator。core 是唯一整体接收 `PreparedCompositionInputs` 的函数，只调用模块 entry、向模块传递窄 typed projection、登记 cleanup、完成 binding、构造 lifecycle，并返回唯一package-private `ProductCompositionOutcome { app, hostFacts }`。`hostFacts`只含safe gateway readiness与start-failure reporter，不含closable handle；不新增其他同形 root input/layer wrapper/result object，也不捕获错误或执行 commit/rollback。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/app-lifecycle-composition.test.ts packages/agent-app/tests/cron-delivery-composition.test.ts`；integrated composition test证明多项cron依赖同时缺失时gateway错误先于LOCAL/REMOTE runtime prerequisite，REMOTE runtime内credential先于registration；source review 能依次识别入口 preparation 和七个 core 层级及其依赖交接；source/architecture negative fixture证明root无cron runtime prerequisite检查、cron module无exported standalone validator、capability entry不接收runtime-only input，同时module-private branch helper合法。
  来源：`Scenario: 顶层流程按宏观层级连续可读`；design 决策 1、3。

- [x] 5.2 让四个agent-app public factory只作为compatibility facade，并与agent-app内的local-auth、with-frontend、testing facade一样只做固定projection，然后直接调用任务4.4的唯一sync或async runner。跨包local/remote adapter只调用一个agent-app public/testing facade，不import app-private runner；整条路径最终恰好抵达一个runner。两个runner分别调用对应preparation和同一`composeNextAgentApp(...)`，且只有runner拥有scope/commit/rollback。production options仍只由preparation解释。public factory/local-auth/with-frontend facade只投影`outcome.app`，local package app-private path可保留outcome；任何public export/`NextAgentApp`不得出现host facts。保持全部sync/async package exports、local/remote entrypoint和test injection API。sync runner只接受可同步完整准备的输入，async runner作为canonical full-capability path；两者都不得对依赖做静默skip/fallback/degrade。
  验证：任务1.1、1.4、1.5、1.6、4.4；backend-only、local configured auth、local/remote package、remote deployment和test-host entrypoint tests；type/source search确认所有product/test/package host最终共享一个core、每次调用恰好一个runner和一个scope owner、只有runner commit/rollback，host facts仅在package-private path可见且public app shape不变；negative fixture使public facade嵌套调用另一public facade并产生重复scope/preparation时实际失败。
  来源：`Scenario: 同步和异步入口共享同一装配核心`。

- [x] 5.3 升级职责型root/options architecture guard并覆盖整个`packages/agent-app/src`，同时定向覆盖local gateway public/testing facade、remote deployment、root process host和dev/demo scripts：允许且只允许shared core整体接收`PreparedCompositionInputs`；拒绝shared core/module entry接收public options或让module entry接收完整prepared root type，拒绝第二个同形root input、未分类完整options解释/copy、owner factory直调、config/env/file读取或内联module callback/observer/job。另外拒绝`PreparedCompositionInputs`或`composeNextAgentApp(...)`中的`hostKind`、`testMode`、`LOCAL | REMOTE | TEST`或等价宿主分支；拒绝多于一个sync runner、多于一个async runner、facade-owned scope、public-facade-to-public-facade嵌套runner，以及async runner以外的with-frontend finalizer调用。对local-auth host/adapter、with-frontend host、local package/bindings、test host/testing facade、thin launcher和external hosts分别应用design决策7约束，不用静态文件数量allowlist；新增职责信号必须先归类。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；production/host options copy、未分类factory caller、local package二次config、test host自建core、launcher provider construction、host discriminator、第三个runner、facade-owned/nested scope和非async-runner finalizer调用等negative fixtures实际失败；合法private leaf helper、test projection、package evidence和workbench contribution fixtures通过。
  来源：`Scenario: public options 不穿透 preparation 边界`；design 决策 1、7。

- [x] 5.4 升级 config/module architecture guard，保护唯一 config entry、每个 module responsibility 的单一权威 entry family、module→root prohibition 和跨模块 composition entry value-import prohibition；允许同模块私有 helper，不维护“恰好一个物理文件”的静态 allowlist。
  验证：`npm run lint:architecture`；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；二次 config/env read、竞争 entry、module→root、跨模块 entry import negative fixtures 实际失败，合法 private helper fixture 通过。
  来源：`Scenario: 模块装配流程保持内聚`；design 决策 4、7。

- [x] 5.5 重构 `with-frontend` product host：公开入口只投影现有 `productVersion`、manifest resolver、index scripts 三个 host 字段及由 `trustedLocalWebExtensionRegistration` 是否缺省派生的 `useDefaultWorkbenchScripts`，只设置`frontendHostingProfile: WITH_FRONTEND`而不改变channel auth profile，并把同一个原始options对象和字段固定的`ProductHostCompositionInput`交给任务4.4的唯一async runner，不rest-spread/copy/normalize production fields、不新建hosted runner。async runner按injected override优先级在async preparation解析local gateway/workbench defaults，调用同一shared core。core返回尚未公开的outcome后，只有该runner可用`outcome.app`调用唯一typed `completeWithFrontendProductComposition(...)`，按既有顺序解析manifest、校验product/frontend version、按派生事实选择scripts并await frontend hosting plugin registration；成功后才commit并由public facade返回app。executable main只选择config/profile并调用该facade，删除自身local gateway/default construction。不得扩展package public options、增加任意post-core hook、第三个runner或第二套core。独立candidate-evidence查询保持既有行为。
  验证：backend-only artifact 不加载 frontend hosting；with-frontend 正常 route/SPA fallback/version mismatch、public input override、local gateway/workbench defaults、default-workbench script 条件和 candidate evidence tests；local configured auth route exclusivity/protected prefix tests；断言 typed finalizer 只由唯一async runner 在 core return 后、scope commit/public return 前调用，frontend fallback registration ordinal 晚于 Web/task/cron routes；manifest、version、frontend registration 失败时 `NextAgentApp` 不返回、后续 commit 不执行、server 和已登记资源按 scope 逆序关闭；architecture negative fixture 对 app options rest-spread/copy、public options 扩展 host-private input、额外hosted runner、sync runner/facade/module 任意 post-core hook、commit/public return 后 `server.register(...)` 实际失败，同时不误伤唯一 finalizer和 candidate-evidence 查询。
  来源：`Scenario: 产品宿主注册在同一 failure scope 内完成`；design 决策1、3、4.1 Channel、4.2 With-frontend host、7。

- [x] 5.6 收敛 local runtime package 完整host path：复用任务2.7 prepared package result，LOCAL通过package hosting kind和`local-runtime-bindings`窄contribution只生成一份production input；package kind不进入channel auth profile。backend-only直接调用唯一app-private async runner且不创建frontend host input，with-frontend由package private start把同一production input引用和单独的package manifest resolver/product version host input直接交给同一app-private async runner，以保留commit后的package-private outcome；禁止通过public facade丢失该outcome、spread/merge完整options或增加package专用wrapper/hosted runner。package保留已冻结的writer→optional OTLP trace bootstrap并作为app-owned injected handles交给runner；model、gateway bindings/defaults和通用observability completion由product preparation创建或接受。backend-only与with-frontend两条路径由同一async runner返回同形`ProductCompositionOutcome`；package只用safe reporter记录`app.start()` failure，只用gateway readiness facts生成原有proof，不从public app重建selection，也不取得/关闭writer、trace或bindings。composition failure完全交给同一async runner rollback，start failure只`app.close()`一次；stop只关闭成功running app。
  验证：`tests/local-runtime-package.test.ts`和`tests/fullstack-packaging-boundary.test.ts`覆盖backend-only、with-frontend、custom packaged Agent、workbench、invalid config、trace absent/invalid/ready、composition failure、start failure、stop、candidate/service version和evidence；spy断言一次config preparation、writer先于trace、一个product core、backend-only和with-frontend只调用同一async runner、后者额外执行一次typed finalization、gateway proof来自host facts、composition failure无writer/trace/gateway/server double-close、start failure只调用safe reporter和一次app close；source guard对package host复制/merge完整options、新增wrapper/hosted runner、从app重建gateway evidence或直接关闭runner-owned handle实际失败。
  来源：`Scenario: local runtime package 复用一次 package config fact`、`Scenario: 装配失败清理尚未交接资源`；design 4.2 Local runtime package host、决策6。

- [x] 5.7 完成test-host与product runner集成：为design决策8列出的37字段建立compile-time completeness map，任何字段新增/删除时映射和验收必须同时更新；七个字段组的explicit override和default都投影为普通production input并进入同一sync或async runner/preparation/core，local auth使用fixed profile，observation/audit/metric capture和test lifecycle在成功app返回后交接。test host不直接创建`PreparedCompositionInputs`，不传入`testMode`或等价discriminator。
  验证：`npx tsc -b --pretty false`；相关`packages/agent-app/tests`、`tests/agent-kernel`和`tests/e2e` targeted suites通过；source/type guard证明test host不import module entries、不构造prepared root、不持有failure scope、不注册server/plugin，core无test branch，37字段无未消费或静默删除。
  来源：`Scenario: test host 保持完整注入能力但不形成第二条产品 pipeline`；design决策1.1、4.2、8。

- [x] 5.8 对照design决策1.1对整个`packages/agent-app/src`及已列明external hosts做最终装配surface审计：每个config/options/profile/provider/default/registration/hook/closable/factory/core/start-close职责信号都映射到唯一surface和task；发现遗漏即先补design/tasks再改实现。确认`auth/local-auth.ts`、`server/fastify.ts`、`assembly/**`、`config/**`、`plugin/**`、`packaging/**`、`release/**`及其他leaf只有在实际拥有装配决策时才修改，未触达文件无无关diff。
  验证：职责型source inventory为零未分类项；git diff逐文件可追溯到surface/task；architecture negative fixtures覆盖新增未分类host/test/package/process/script path并断言失败；local gateway/remote/process/dev/demo integration分别证明design 4.2定义的唯一handoff和黑盒行为。
  来源：`Scenario: 所有真实装配 surface 都进入唯一职责路径`；design决策1.1、4.2、7、8。

## 6. 回归验证和完成门禁

- [x] 6.1 运行tasks 0-5列出的targeted suites，按product core、sync/async runner、module、local auth adapter、with-frontend、local package/bindings、test host、thin launcher、local gateway facade、remote integration、root process、dev/demo host记录normal、boundary、failure/cleanup结果并修复本change引入的行为差异。
  验证：所有targeted commands通过；37字段、一次package config、config后plugin snapshot一次加载冻结及hooks/policies/providers/diagnostics fan-out、writer→trace、正交profile/route order、Local/Remote/Test差异在core前投影完毕、恰好一个sync与一个async runner、public sync compatibility保留、private host facts/public app隔离、lifecycle completeness、ownership/无double-close和external host黑盒行为均有直接证据；cron三分支、gateway/capability/runtime消费点校验、四个单项缺失的既有safe error、gateway-first与REMOTE credential-first顺序、callback真实readiness、server后失败cleanup均有直接证据，并明确记录非法REMOTE runtime依赖可在config accepted diagnostic后失败但成功路径和单项public safe failure shape不变；无刻意保留的新增no-op、test-only provider或未接入production helper。
  来源：`Scenario: composition refactor 保持产品行为`；design Verification Map。

- [x] 6.2 运行完整后端与 OpenSpec 门禁，确认没有 public contract、配置、持久化、最小内核、architecture 或安全回归。
  验证：`npm run build`、`npx tsc -b --pretty false`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-agent-app-composition-pipeline --strict`、`openspec validate --all --strict`。
  来源：proposal 非破坏性范围；AGENTS.md 验证门禁。

- [x] 6.3 push 前运行 `$nextagent-code-review`，覆盖 frozen core contract、Agent/Owner Scope、architecture boundary、minimal kernel、security、OpenSpec consistency、Clean Code、顶层八层流程、design 4.1逐模块流程、design 4.2逐product/test/package/process/script host流程、决策1.1完整surface inventory、Local/Remote/Test host投影与core无宿主分支、恰好一个sync/一个async runner、public sync compatibility保留、正交profile与local-auth dependency boundary、private host facts、决策6 lifecycle-input completeness/ownership、决策8 public/test/package/external fact防丢映射、sync/async/package equivalence、runner-owned failure scope、唯一commit前typed async finalization和全部验证证据；P0/P1修复后重新检视。
  验证：模型语义检视结论为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP；P2 有明确 follow-up plan。
  来源：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前：

- 同步 `openspec/specs/ts-backend-architecture/spec.md` 中 `[TS] App Composition Root 三职责边界`。
- 更新 `openspec/designs/architecture/ts-backend-architecture.md` 的八层 pipeline、prepared input 边界、deferred binding 和 failure resource ownership。
- 更新 `openspec/designs/modules/agent-app.md` 的配置入口、模块权威entry、product/test/package host surface、launcher边界、37字段映射、资源ownership和验证关注点。
- `openspec/overview.md` 和 `openspec/designs/adr/` 无需更新。
- 核对 `openspec/designs/spec-to-design-map.md` 既有导航；没有导航变化时不修改。
