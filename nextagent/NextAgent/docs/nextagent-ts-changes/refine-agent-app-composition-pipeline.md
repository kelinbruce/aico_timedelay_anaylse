# refine-agent-app-composition-pipeline

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
OpenSpec：[`refine-agent-app-composition-pipeline`](../../openspec/changes/refine-agent-app-composition-pipeline)
所属分组：Composition / Extension Refinement

状态：ready
类型：架构 refinement + 内部 composition reliability change
主要 owner：`packages/agent-app`
协作 owner：无；其他 owner package 只提供既有 public factory/port，不修改其业务 ownership
依赖：`shrink-agent-app-to-composition-root`、`add-ts-app-config-schema`、`add-ts-local-runtime-package`、`refine-ts-fullstack-packaging-boundary`、`add-ts-runtime-operational-log-hardening`、`add-otlp-trace-export`；后两项实现必须先完成并形成最终writer/trace稳定基线，归档可以滞后，但剩余工作只能是验证/归档收尾且不得再并行修改重叠装配路径

目标：
- 在既有严格 composition root 内建立唯一、连续、可复核的 app construction pipeline。
- 让 public options 只在 preparation 消费一次，唯一 shared core 接收只读 prepared input，各模块只接收窄 typed projection。
- 在第0层显式固定identity/clock → bootstrap metrics → config → plugin snapshot load/validation/freeze → product-host defaults → remaining startup contribution preload；plugin不新增顶层层级，也不延后到capability加载。
- 让 backend-only、with-frontend、local configured auth、local gateway、remote deployment 和 test composition 复用同一个 core；channel auth与frontend hosting profile正交，Web/local/workbench/task/cron registration在channel stage完成，with-frontend仅保留commit前唯一async host finalization。
- 将Local、Remote、Test限定为三种host input projection：host只决定contribution/default，config只决定capability/deployment adapter，只有product preparation产出统一`PreparedCompositionInputs`，shared core不包含`hostKind`、`testMode`或等价分支。
- 将现有四个public factory收敛为compatibility facade，所有product/test/package路径最终只进入一个app-private sync runner或一个app-private async runner；async是full-capability canonical path。本change保留public sync API，删除/废弃与跨包caller迁移必须独立change。
- 以黑盒装配职责覆盖product runner、module entry、local-auth/with-frontend host、local runtime package、local gateway/workbench adapter、test host/testing facade、thin launcher、local gateway public/testing facade、remote deployment、root process、dev backend与workflow demo host；不按文件数量裁剪，也不修改没有装配决策的leaf implementation。
- local runtime package direct/dispatch start只产生一次validated/frozen config fact和一份production input；按冻结基线先创建唯一writer、再初始化optional OTLP trace；backend-only与with-frontend都进入同一app-private async runner，后者只额外携带独立typed host input，两者复用同一preparation/core；通过package-private safe host facts保留gateway/start evidence，不保留第二套model/gateway/通用observability/cleanup pipeline。
- 保留`NextAgentTestAppOptions`全部37个顶层输入及其override/default行为，同时禁止test host复制production config loader、module order、channel registration或failure scope。
- 让cron deployment只在配置/preparation冻结为app-private `DISABLED | LOCAL | REMOTE`，其中`DISABLED`仅规范化现有未启用/缺省状态、不新增public config值；平台gateway、capability和runtime/channel分别在真实消费点校验cron gateway、scheduler factory、callback credential/registration，删除REMOTE-only readiness预检半路径。
- 为尚未 commit 给最终 app lifecycle 的 composition-created 或既有 app-owned closable resources 提供 runner-owned、逆序、至多一次 cleanup；caller-owned injection 不越权。
- 保持现有 public contracts、product availability、app outputs、Agent/Owner Scope、request lifecycle 和正常 start/close 语义。

规格输入：
- `agent-app` 继续只拥有配置加载、依赖注入、server/channel registration 和 lifecycle handle 组装，不拥有 runtime、context、model、capability、memory、session、gateway 或 observability 业务语义。
- 一次 composition 只有一个 `DefaultSystemConfig`、一个 `PreparedCompositionInputs`、一个 shared core、一个 failure scope 和一套最终 app lifecycle。
- host preparation与runner执行能力正交：Local投影package/local gateway/workbench/local-auth/writer/trace事实，Remote投影remote gateway/model/RAG/sandbox事实，Test投影37项override/default/capture事实；三者都不直接构造prepared root。
- plugin preparation在frozen config后按injected/empty/sync/async唯一规则产出一个frozen snapshot；hooks、policies、providers、diagnostics分别由既有lifecycle、assembly/request policy、capability和安全诊断/characterization路径消费，下游不得reload。
- `composeNextAgentApp` 是唯一可以整体接收 `PreparedCompositionInputs` 的 root；模块 entry 不得接收 public options 或完整 prepared root state。
- product selector只含正交`channelAuthProfile`与`frontendHostingProfile`；package kind、local gateway defaults和test kind不进入channel profile。
- cron deployment selection只表达部署模型，不表达runtime readiness；`DISABLED`不创建cron capability/runtime，`LOCAL`只在scheduler构造时要求gateway/factory，`REMOTE`只在verifier和route registration消费点依次要求credential/registration。未选中分支输入不生效；单项缺失的既有safe error保持，多项缺失按gateway→runtime、credential→registration顺序失败，task→cron→frontend顺序保持。
- local product dependency graph下唯一app-private local-auth contribution adapter静态依赖local-auth实现包；facade只选择contribution/profile并转交原options，shared channel只调用typed contribution且不依赖local-auth包。custom Web/default Web/local-auth precedence按design矩阵固定。
- product host 把 Web、local auth、workbench、task registration 投影为窄 channel contributions；with-frontend 入口只投影现有 host input并原样转交 app options，由唯一async runner创建 failure scope、复用同一 async preparation/core，再在 core 返回尚未公开的 app 后调用唯一 typed finalizer，按既有顺序 await manifest/version validation 和 hosting registration；成功后才 commit/return。不得扩大 package public options、新建第三个runner或允许任意 post-core hook，frontend fallback 仍在 Web/task/cron route 后最后注册。
- 无法通过重排消除的循环只允许使用字段固定、单次绑定、未绑定/重复绑定 fail-closed 的 typed deferred holder。
- composition failure cleanup 不接管返回后的 `app.start()` 失败；start-phase transactional rollback 明确 deferred。
- resource ownership按成功`NextAgentApp.close()` contract决定：app lifecycle会关闭的injected/created handle在runner接受后统一登记，host不得重复关闭；无close contract的model/provider/factory/metrics registry/test sink/contribution保持caller-owned。
- shared core返回package-private`ProductCompositionOutcome { app, hostFacts }`；public facade只投影原`NextAgentApp`，local package private path只消费safe gateway readiness和start-failure reporter。host facts不含closable handle、credential、路径、raw provider error或完整config。
- local runtime package的package config preflight是受控host前置，product config entry接收其injected frozen config后不重读文件；backend/local-auth/with-frontend executable entrypoint保持launcher-only。

契约输入：
- 复用 `ts-backend-architecture` 的 composition root、owner package public factory 和 package dependency boundary。
- 复用 app config 的 startup validation/freeze、fullstack packaging 的 backend-only/with-frontend profile 和 local runtime package manifest/version contract。
- 不新增、不移动、不重命名任何 `agent-contracts` export，不修改 public Web API、runtime command、stream event、gateway schema、provider contract 或 persisted fact。

实现约束：
- 恰好一个sync runner和一个async runner可创建并持有当次唯一failure scope；public/host/test facade不拥有scope，preparation/shared core 只登记 handle。sync runner在core返回完整outcome后commit；async runner在无host input时直接commit，在with-frontend typed finalization成功后才commit，并分别执行sync/async rollback。
- `PreparedCompositionInputs` 不得复制为第二个 root DTO，不得用 service locator、动态 key、字符串 token、DI container 或 layer aggregate 替代显式 handoff。
- plugin sync/async preload必须同形且只执行一次；required failure在shared core前终止，optional rejection只保留既有safe degraded diagnostic。capability及其他下游不得接收plugin loader或config root。
- 归位所有真实wiring，无论位于`create-app.ts`、module composition、`create-local-configured-app.ts`、`create-test-composition.ts`、`testing.ts`、entrypoint或`local-runtime-package`；已内聚且没有装配决策的leaf默认不改。
- with-frontend 公开入口只投影现有三个 host 字段和 default-workbench script 派生事实，并原样转交 app options；唯一async runner在 scope 创建后解析 local gateway/workbench defaults并复用同一个 async preparation/core，在 core 后、commit/public return 前通过唯一 finalizer 保持 manifest/version/async hosting 既有顺序；candidate evidence 独立行为保持。backend-only/remote 不加载 frontend hosting。
- composition refactor 前先建立 public option/output/host/test-facade fact 防丢 characterization；`channelPort`、`observationLogger`、isolated config/default Agent 和 test lifecycle registration 必须保持；任何事实没有明确消费者时不得静默删除。
- 建立职责型surface inventory并扫描整个`packages/agent-app/src`，并定向覆盖local gateway public/testing facade、remote deployment、root process和dev/demo scripts：完整options解释、config读取、profile/default选择、server/plugin/hook registration、closable handoff、app factory/core调用和start/close都必须映射到唯一surface；禁止用静态文件allowlist代替。
- local configured auth facade只选择fixed channel auth profile和local-only contribution并转交原options；local auth/Web/plugin/readiness在channel invocation内完成，shared channel不依赖local-auth包；with-frontend executable main不再构造local defaults；`local-runtime-bindings.ts`只保留local factory/workbench contribution；test host逐字段覆盖37个inputs。
- gateway/cron共用selection规则只位于app-private config pure helper；cron capability entry只接收selection与optional gateway并返回typed disabled/enabled result，runtime entry按该result选择LOCAL/REMOTE/DISABLED。删除exported/root-called `validateCronRuntimeComposition`，但保留module-private消费点prerequisite helper与`cronTriggerCallbackRegistration.ready()`生命周期语义。
- `composeAppLifecycle(...)`每个input必须进入compile-time completeness map：closable/stop/unbind handles全部登记，capability/Web/task/RAG-build/config等start/read-only facts显式不登记；新增未分类input时验证失败。

非目标：
- 不改变 `NextAgentApp.start()` 的 producer、ready validation、RAG build、runtime recovery 或 listen 顺序。
- 不在本 change 实现 start-phase transactional rollback或统一所有 launcher 的 start-failure close policy。
- 不删除或废弃public sync factory；只将其收敛为“仅支持可同步完整准备输入”的compatibility facade，不允许对async-only能力静默降级。
- 不迁移业务 owner，不引入新 package、public builder、DI framework、动态插件机制或第二套配置/model/capability/gateway path。

验收要点：
- source/type/architecture guards 证明只有 preparation 逐字段解释 public options，两个runner只原样传递对象引用；只有 shared core 接收完整 prepared input、模块只接收窄投影。
- source/type/architecture guards证明Local/Remote/Test差异在preparation前已投影为普通输入，prepared/core无host/test discriminator；每条调用链恰好进入一个sync或async runner和一个scope，只有async runner调用with-frontend finalizer。
- plugin tests证明config后一次load/validation/freeze、sync/async同形、injected/empty优先级、required/optional失败语义，以及hooks/policies/providers/diagnostics四类消费映射；negative guard阻止下游reload。
- sync/async 等价性覆盖完整 `NextAgentApp` projection、capability/workflow/memory/question availability、health/readiness 和 lifecycle handles。
- sync compatibility inventory覆盖public exports、local/remote/testing facades和存量tests/callers；本change diff无sync export删除或deprecation，async-only input在sync path被类型阻止或safe failure，不被跳过。
- product entrypoint tests 覆盖 backend-only、with-frontend public input/default/evidence、local configured auth、local gateway、remote deployment、test injection、protected prefixes、SPA fallback 和 route exclusivity。
- channel tests覆盖custom Web覆盖且不调用extension、default Web后调用extension、local auth忽略custom Web并在protected scope注册Web/extension，以及task→cron→frontend固定顺序；dependency test证明只有local contribution adapter依赖local-auth包。
- cron tests覆盖`DISABLED`无runtime、`LOCAL` scheduler、`REMOTE` callback route，selected gateway/scheduler factory/credential/registration四类单项缺失，多项缺失时gateway-first与REMOTE credential-first错误顺序，未选中分支输入忽略，callback真实readiness不前移，以及server创建后cron失败由同一scope清理且不double-close。
- local runtime package tests覆盖direct/dispatch local、backend-only/with-frontend、一次config read/validation、writer→optional OTLP trace、packaged Agent、workbench、composition/start failure、private host facts、evidence/run-state和无double-close。
- test-host completeness map覆盖37个顶层inputs的basic/config、model、observability、lifecycle、gateway/runtime/capability和cron七组override/default，字段变化时映射与验收同步失败。
- failure injection 覆盖 configuration/preload、observability、gateway、capability、runtime、channel/frontend、cron；cleanup 逆序、至多一次，async 顺序等待，原始 safe failure 不被覆盖。
- lifecycle-input completeness覆盖scheduled maintenance、cron scheduler、trajectory worker、全部memory schedulers、runtime logger binding及无cleanup的start/read-only facts。
- characterization 覆盖 active Agent assembly refresh、runtime recovery identity、fork cleanup、capability maintenance、audit/metrics readiness、operational active identity 和全部 public app outputs。
- external host characterization覆盖local gateway defaults/override/audit/metrics、remote contribution、root fatal/start-failure close、dev local defaults、demo pre-start CORS/workflow/signal close且每条路径只有一个runner。
- `npm run build`、`npx tsc -b --pretty false`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict` 通过。

## 实施期只读装配 surface inventory

本表记录实际触发链和验收 owner，不引入新的运行时抽象。`options/profile` 只允许由表中 host/facade 投影，production 字段只由 product preparation 解释；schema、parser、evidence mapper 和 leaf owner factory不属于装配 surface。

| surface | 触发、options/config 与 profile/default | registration、closable handoff 与 core/factory | start/close 与直接验收 |
|---|---|---|---|
| product runner/core：`composition/create-app.ts` | 四个 public facade 或内部 host/test facade；唯一 sync/async preparation 逐字段解释 production options，冻结 config/plugin，并投影正交 channel/frontend profile | 唯一 shared core 调用 module entry；唯一 failure scope登记 app-owned handle并在 outcome/optional frontend finalization后 commit | facade 不 start；composition、runner、input characterization、architecture tests |
| module entries：`configuration/plugin/observability/attachment/assembly/lifecycle-hook/model/gateway/memory-maintenance/background-task/capability/prompt-template/workflow/session-services/context-engine/health/request-runtime/channel/app-lifecycle` composition 与 cron runtime | 只接收窄 typed input；各自执行 design 4.1 的 owner factory/default/optional选择 | 只注册本模块 callback/job/route或返回具名 handle，root立即交给同一 scope；不接收 public/prepared root | 各 module targeted suite、composition tests、dependency/architecture guard |
| local-auth host/adapter：`create-local-configured-app.ts`、`local-configured-auth-channel-contribution.ts` | fixed `LOCAL_CONFIGURED_AUTH + NONE`，原 options 引用；adapter 不捕获 config/server | contribution只在 channel stage构造 auth/plugin/Web/extension；不建 scope | local-auth kernel/package tests；launcher负责 start |
| with-frontend host：`entrypoints/with-frontend.ts` | 原 options 引用，加固定 product version/manifest/scripts/default-script fact；只设 frontend profile | 唯一 async runner在 core 后、commit 前调用唯一 typed finalizer，最后注册 hosting plugin | fullstack boundary/candidate evidence tests；executable只 start |
| local package host：`local-runtime-package/index.ts` | manifest/layout后一次读取、resolve、validate/freeze config；packaged Agent、service version、hosting profile；writer先于optional trace | fixed local bindings生成一份 production input；direct/LOCAL dispatch共享 prepared host；runner接受前 host清writer，接受后只消费 private host facts | package拥有 app start、start failure close、proof/run-state与 stop；local package tests |
| local bindings adapter：`local-runtime-package/local-runtime-bindings.ts` | 固定 gateway factory set、scripts/prefixes和一个workbench contribution；不读 app state | workbench unavailable单独降级；不调用 app factory、不拥有server/scope | local package/fullstack/architecture tests |
| test host/facade：`create-test-composition.ts`、`testing.ts` | 37字段 completeness map；isolated config/default Agent/deterministic model/capture/defaults投影为普通 production input；local auth fixed profile | 只调用唯一 runner；成功后登记 audit/metric capture和test lifecycle | composition/input map、kernel/contract/smoke suites与test cleanup |
| thin launchers：三个 `entrypoints/*.ts` executable | 仅选择公开 factory/profile和可选launcher config locator | 不构造 provider、route/plugin、scope或第二个 core | 只调用 `app.start()`；entrypoint/fullstack tests |
| local gateway public/testing facade | fixed local defaults且explicit override优先；testing额外audit/metric defaults | 每条链只调用一个 agent-app public/testing facade，成功后关联capture | public sync/async API tests与contract tests |
| remote deployment host | remote model/gateway/RAG/sandbox/metric contribution投影到一个 public product factory | 不调用 module entry、不拥有composition rollback；package preflight/evidence仍由remote host拥有 | sync app factory与async package start/close integration tests |
| root process host：`src/main.ts` | 默认 async public factory；不解释 app config | fatal boundary；不追加产品registration | 条件 start，失败 safe log + close + exit status；process tests |
| local dev host：`scripts/start-dev-backend.mjs` | 一次 `loadLocalRuntimeBindings()` 后投影固定local defaults/workbench | 一个 async public factory；不加载第二个config/core | `app.start()`；build/architecture source guard |
| workflow demo host：`scripts/start-demo-workflow-server.mjs` | testing composed facade、test config/model/workflow mock | 仅在 start 前添加既有非产品 CORS hook并注册signal close | `app.start()`；demo/source architecture guard |

最终审计确认 `auth/local-auth.ts`、`server/fastify.ts`、`assembly/**`、`plugin/**`、`packaging/**`、`release/**` 等 leaf 未因目录相邻而改写；本 change 对 `config/**` 的新增仅为由 preparation/gateway 共享的纯 deployment selection helper。

## Sync compatibility inventory

| 调用面 | 保留原因与本 change 处理 |
|---|---|
| `@nextagent/agent-app` 的 `createNextAgentApp` | public compatibility API；同步 config/plugin/model preparation仍完整可用，直接进入唯一 sync runner |
| app testing 的 `createComposedApp`、`createLocalConfiguredComposedApp`、`createNextAgentApp` | deterministic/injected model与local-auth测试需要同步拿到app；只做test projection并进入同一 sync runner |
| backend-only 与 local-configured-auth sync factory | 已发布package entrypoint和存量caller；仅作fixed facade，不嵌套其他 public runner |
| local gateway public/testing sync facade | 保留explicit override/local defaults、audit/metric capture契约；只调用一个agent-app sync facade |
| remote deployment `createRemoteNextAgentApp` | caller已提供remote clients且同步构造 contribution；保留现有signature并调用一个public sync factory |
| workflow demo与 architecture/contract/kernel/e2e/smoke tests | 依赖同步测试app以便在 start 前注入fixture/hook；继续通过testing facade到唯一 sync runner |
| async product/with-frontend/local package/remote package/root/dev paths | async-only preload、host finalization或process/package start需要await，继续使用canonical async runner，不改变sync API |

源码/type inventory 以 `rg "createNextAgentApp|createComposedApp|runProductComposition" packages/agent-app/src packages/agent-platform-gateway-local/src packages/agent-remote-deployment/src src scripts tests` 和 public export/typecheck gate复核；本 change 不删除、不标记 deprecated、也不迁移任何sync signature。若未来删除sync surface，必须另开change迁移上述public exports与caller。

并行边界：
- `add-ts-runtime-operational-log-hardening`与`add-otlp-trace-export`的实现必须先完成并形成稳定基线；归档可以滞后，但两项不得再并行修改重叠装配路径。
- 与修改 `packages/agent-app/src/composition/create-app.ts`、`channel-composition.ts`、`with-frontend.ts` 或相同 composition entry 的其他 active change 串行集成。
- 与修改`packages/agent-app/src/composition/create-local-configured-app.ts`、`create-test-composition.ts`、`testing.ts`、`packages/agent-app/src/local-runtime-package/index.ts`、`local-runtime-bindings.ts`、三个product entrypoint或相同host/test/package surface的active change串行集成。
- 与修改local gateway public/testing facade、remote deployment、`src/main.ts`或dev/demo scripts相同surface的change串行集成；只读characterization可先行。
- 可以与不写入上述文件/surface、且不改变 public contracts、runtime lifecycle、Agent/Owner Scope 或 product hosting boundary 的 change 并行。
- owner package 业务实现、frontend browser ownership、gateway persistence、runtime lifecycle 和 channel public DTO 不属于本 change 写入范围。
