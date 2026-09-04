## MODIFIED Requirements

### Requirement: [TS] App Composition Root 三职责边界

TS 后端 `agent-app` SHALL 只作为 composition root 承担配置加载、依赖注入和服务启动。`agent-app` MUST NOT 拥有 request lifecycle、Agent 内部 routing、context assembly、model provider、capability、workflow、memory、question、gateway persistence、observability projection、session history 或 channel transport 的业务语义。

配置加载 SHALL 通过一个权威入口读取或接受可信配置，完成 runtime validation、ready gate 和冻结，为一次 app composition 产出唯一 `DefaultSystemConfig`、capability reference validation port 和 gateway sandbox runtime input，并通过既有 telemetry 边界安全上报配置失败 evidence。preparation SHALL 从该 frozen config 一次投影 app-private cron deployment selection `DISABLED | LOCAL | REMOTE`；`DISABLED` SHALL只规范化现有未启用/缺省状态，MUST NOT成为新的public config token、持久化值或跨package contract。配置或启动贡献阶段 MUST NOT 检查 cron scheduler factory、callback credential reference、callback registration 或 server。后续模块 SHALL 只消费该配置事实、窄派生输入或前序 typed result，MUST NOT 重新读取配置文件、环境变量或构造第二套完整配置对象。

依赖注入 SHALL 以一个唯一 `composeNextAgentApp` core 作为共享装配核心，并按以下宏观顺序完成：启动贡献 → Agent 静态装配 → 平台基础设施 → 执行能力 → 应用服务 → runtime/channel → app lifecycle/host handoff。进入该 core 前，第0层preparation SHALL依次完成identity/clock → bootstrap metrics → config → plugin snapshot load/validation/freeze → product-host defaults → remaining sync/async startup contribution preload；唯一 with-frontend typed host finalization只可由唯一async runner在core返回后、commit前完成。顶层 SHALL 直接呈现这些层级、必要的 typed handoff、受控 deferred binding、failure resource handoff 和最终 `NextAgentApp` 返回，MUST NOT 把每个模块的私有步骤提升为顶层 stage，也 MUST NOT 新增只转发参数的 layer wrapper。该 pipeline 描述 `NextAgentApp` 构造和 commit 前的 optional typed host finalization，不包含 public return 后的 `app.start()` producer 启动、ready gate、recovery 或 listen 执行。

完整 production app options 中的 composition fields SHALL 只由同步或异步 preparation 入口解释一次。public factory/host/test facade signature MAY 接收完整或扩展 options，当次唯一execution runner MAY接收同一options对象以建立scope并原样传给对应preparation；facade/runner MUST NOT读取未归其projection的production field、rest-spread/copy或自行normalize。local configured auth facade SHALL只选择`LOCAL_CONFIGURED_AUTH` channel auth profile、创建/选择不捕获options/config/server的local-only typed contribution并把原options引用交给唯一sync runner，不得复制options、读取auth config或直接注册route/plugin。只有local product dependency graph下的app-private contribution adapter MAY静态依赖local-auth实现包；shared channel、generic core、backend-only与with-frontend MUST NOT依赖该实现包。with-frontend facade只可投影既有三个host fields及`useDefaultWorkbenchScripts`派生事实，并 SHALL 把同一个原始 options对象和字段固定的host input交给唯一async runner，不得rest-spread/copy或规范化其他production fields。只有sync/async product preparation MAY创建`PreparedCompositionInputs`；host/test facade MUST NOT直接创建该root state。唯一共享装配 core SHALL 接收同一个只读 `PreparedCompositionInputs`，且 MUST NOT 复制、重建或整体下传该 root state。`PreparedCompositionInputs`、shared core及任何module entry MUST NOT接收、包含或检查`hostKind`、`testMode`、`LOCAL | REMOTE | TEST`或等价host discriminator。任何模块 composition entry MUST NOT 接收 `CreateNextAgentAppOptions`、`CreateComposedAppOptions`、`PreparedCompositionInputs`、rest-spread options 副本或含义宽泛的 options bag；模块 entry SHALL 只接收本模块需要的字段固定 typed projection。

Local、Remote、Test SHALL仅表示host preparation surface，MUST NOT表示三套app composition。host SHALL决定受信任contribution/default，frozen config SHALL决定启用的capability/deployment adapter，product preparation SHALL形成统一prepared shape，shared core SHALL只按已准备的窄输入装配。Local MAY额外提供package/config/Agent/local gateway/workbench/local-auth/writer/trace/evidence facts，Remote MAY额外提供remote gateway/model/RAG/sandbox/deployment facts，Test MAY额外提供isolated defaults/overrides/capture facts；这些差异 SHALL在进入product preparation前投影为production options或窄contribution，MUST NOT穿透为host-mode branch。

test host MAY 解释现有完整 `NextAgentTestAppOptions`，包括 basic/config、model、observability、lifecycle、gateway/runtime、capability 和 cron 共 37 个顶层 inputs，并 MAY 构造 isolated config/default Agent、deterministic model、local gateway defaults、observation capture 和 test lifecycle registration。test host SHALL 把这些事实投影为普通 production inputs并调用同一sync或async runner；MUST NOT 调用 module composition entry、直接构造`PreparedCompositionInputs`、复制 production config loader/module order/channel registration/failure scope，或把 test-only fields加入 production public/prepared contract。`testing.ts` facade MAY 额外投影 `channelPort`、`observationLogger` 和 test cleanup registration，但同样 MUST NOT 形成第二条 preparation/core。

装配 surface SHALL 按职责完整覆盖 product runner/core、module entry、local configured auth host、with-frontend host、local runtime package host、local gateway/workbench adapter、test host、testing facade、thin launcher、local gateway public/testing facade、remote deployment、root process host、local dev host和workflow demo host。任何读取或派生 app configuration、解释完整 app/test options、选择 host/profile/provider defaults、构造 channel contribution、注册 server/plugin/hook、创建或交接 closable resource、选择 app factory、决定 composition rollback 或组装 test product input 的路径，都 SHALL 归入一个明确 surface并受其 owner约束。纯 schema/parser、owner factory implementation、package evidence mapping、safe diagnostic 或无装配决策的 helper MUST NOT 仅因相邻文件被重构。

每个存在 app-local wiring 的模块 SHALL 只有一个权威 composition entry family，内聚该模块的 provider/factory 选择、adapter 构造、可选分支、job registration 和 typed output。复杂模块 MAY 使用同目录私有 helper，且 MAY 因真实前后依赖暴露少量具名 entry，但这些 entry MUST NOT 形成竞争装配路径。文件数量、文件名、私有 helper 名称和调用数量 MUST NOT 作为模块内聚的替代验收标准。

每个权威 composition entry family SHALL 同时具有一条清晰、唯一的模块内部装配流程。该流程 SHALL 明确触发时机和已完成依赖，按有序规则完成 validation/selection、dependency construction、optional branch、observer/job registration 和 result projection，并明确 typed output 的直接消费者及失败/cleanup 责任。模块内部流程 MAY 由同一文件的少量私有 helper 实现，但 MUST NOT 依赖隐式 mutation、跨文件回填、调用顺序猜测或功能不等价 fallback。设计中列出的模块有序决策是实施约束；私有 helper 名称和不影响依赖关系的局部表达不是稳定 contract。

模块依赖 SHALL 优先通过顺序重排和 typed parameter 形成单向装配。只有无法通过重排消除的真实 contract 循环才允许进入字段固定、单次绑定、重复绑定失败且显式定义未绑定语义的 typed deferred holder。lifecycle hook invocation 在未绑定时 SHALL 保持既有 `{ status: "CONTINUE", boundary }` neutral result；workflow capability invocation、workflow runtime adapters 和 runtime subagent execution lookup 在未绑定时 SHALL 返回 `undefined`，其必需消费者 SHALL fail closed；background runtime timeline 在未绑定时执行 event emission MUST fail closed。`agent-app` MUST NOT 使用通用 DI container、字符串 token、自动依赖图、可变 service locator、隐藏全局注册或跨模块 composition entry value import。

agent-app public factory SHALL仅作为facade，并最终恰好进入一个app-private sync runner或一个app-private async runner；一次调用链 MUST NOT形成agent-app public-facade-to-public-facade嵌套runner、重复preparation或第二个failure scope。跨包product/testing adapter SHALL只调用一个agent-app public/testing facade，MUST NOT import app-private runner。两个runner SHALL 复用同一配置语义、prepared input shape、模块装配 core、模块顺序和 lifecycle 组装；只允许保留是否可await的preload/finalization能力和sync/async rollback策略差异。sync runner SHALL只接受可同步完整准备的输入，MUST NOT静默跳过、fallback或降级async-only plugin materialization、startup preload或host finalization；async runner SHALL是支持完整preparation/finalization能力的canonical path。本change SHALL保留既有public sync factory的signature和黑盒结果，MUST NOT删除或废弃该compatibility surface；sync API迁移只可由独立change完成。

product selector SHALL把channel auth profile（`DEFAULT_WEB`/`LOCAL_CONFIGURED_AUTH`）与frontend hosting profile（`NONE`/`WITH_FRONTEND`）建模为正交维度；package kind、local gateway defaults和test host kind MUST NOT作为channel profile。channel entry family SHALL 按channel auth profile互斥地执行default/custom Web或local configured auth分支，再依次完成task和cron registration；local-auth facade或adapter MUST NOT 自行拥有 server lifecycle、完整 options或第二套 registration order。with-frontend MAY 把字段固定、app-private 的 host input 交给唯一async runner；该 runner SHALL 在创建唯一 failure scope 后复用同一个 async preparation/core，并且 MAY 在 core 返回尚未公开的完整 app 后、scope commit 前调用唯一 typed async host finalizer，按既有顺序解析/校验 manifest/version并 await frontend hosting registration。该例外 MUST NOT 扩大 package public options、形成第三个runner、第二套 core/scope/config/module order 或允许任意 post-core product hook。frontend hosting 与 SPA fallback MUST 在 Web、local extension、task 和 cron callback routes 后最后注册；任一产品宿主 MUST NOT 在 scope commit 或 app public return 后补充 server/plugin registration。服务启动 SHALL 只注册 server/channel/health/ready gate，并启动或停止 owner factory 返回的 lifecycle handle、scheduler、worker 或 job。

channel registration precedence SHALL 固定为：`DEFAULT_WEB` 下custom `webChannelRegistration`存在时只调用custom registration且不再调用trusted extension；缺省custom registration时先注册builtin trusted-identity Web，再调用trusted extension；`LOCAL_CONFIGURED_AUTH`下caller custom Web registration不生效，local-only typed contribution SHALL校验frozen auth config、构造auth/plugin、在protected scope注册builtin Web并调用trusted extension。三条路径随后都按task → cron → optional frontend hosting顺序执行。local auth与default/custom Web MUST互斥；workbench unavailable只能按既有local adapter规则降级，MUST NOT吞掉Web/auth/task/cron/frontend failure。

local runtime package host SHALL 把 package manifest/layout/config evidence、packaged Agent definition、candidate/run evidence和`app.start()`/`app.close()`留在package owner，并 SHALL 通过一次 package preparation产出同一个validated/frozen config fact。package preparation SHALL按已冻结的运行日志/trace行为先创建唯一operational writer、再初始化optional OTLP trace projector，并把二者作为app-owned injected handles一次性交给runner。deployment dispatch选择LOCAL路径时 SHALL 把同一prepared host result交给app-private local start，不得调用会再次读取/验证config的public local start；直接public local start才执行一次相同preparation。product configuration entry接收该injected config后 MUST NOT 再次打开config文件。local package SHALL 通过`local-runtime-bindings`窄factory/workbench contribution生成一份production input：backend-only hosting kind SHALL直接调用唯一async runner且不得创建frontend host input；with-frontend hosting kind SHALL由package private start把同一production input引用和单独的package manifest resolver/product version host input直接交给同一app-private async runner，以保留commit后package-private outcome，不得通过public facade丢失该outcome，也不得通过spread/merge复制完整options。local package MUST NOT 构造第二套product model、gateway、通用observability或cleanup pipeline。

shared core SHALL返回package-private `ProductCompositionOutcome`，其中public `app`保持完整`NextAgentApp`投影，`hostFacts`只允许包含safe gateway readiness facts和app-owned start-failure reporter。public factory/facade SHALL只返回`app`；只有local package app-private start path MAY消费`hostFacts`生成既有provider/readiness evidence和安全start-failure diagnostic。`hostFacts` MUST NOT包含credential、路径、raw provider error、完整config、writer/projector/bindings等closable handle或cleanup，并 MUST NOT进入public export或`agent-contracts`。

backend-only、local-configured-auth和with-frontend executable launcher SHALL 只选择公开factory/profile并调用`app.start()`；MUST NOT 读取或规范化app config、构造provider/defaults、注册route/plugin或拥有composition rollback。local/remote runtime package属于显式package host，不适用thin-launcher限制，并继续拥有start evidence与start-failure app close。

local gateway public facade MAY在agent-app边界前只对固定local gateway/SkillHub字段应用explicit override优先的public-options default projection；其testing facade MAY additionally包装gateway provider做audit capture、提供metrics default并关联成功返回app。root process host SHALL保留fatal boundary与`app.start()` failure close/exit status；local dev host SHALL保留一次local gateway/workbench projection；workflow demo host MAY在`app.start()`前添加既有非产品CORS hook并注册signal close。上述external surface MUST NOT调用module composition entry、形成第二个config/core、拥有composition rollback或在start后追加产品route/plugin。

任一装配阶段失败时，app SHALL 保持未就绪并返回既有安全启动失败投影。当次唯一app-private sync或async runner SHALL 在调用 preparation 前创建并唯一持有一个 composition failure scope；public/host/test facade、preparation 和 shared core MUST NOT创建竞争scope，preparation 和 shared core MAY 登记或交接 cleanup handle，但 MUST NOT commit 或自行选择 sync/async rollback policy。sync runner SHALL 在 shared core 返回完整package-private outcome后 commit；async runner SHALL在core返回后直接commit，或在持有with-frontend typed host input时于唯一typed finalization成功后commit。public facade SHALL只在runner commit后公开返回app，local package private path只在commit后取得outcome。commit是composition cleanup ownership向最终app lifecycle的唯一交接点。

resource ownership SHALL 由成功 `NextAgentApp.close()` 的既有 contract决定，不由“是否 injected”决定。operational writer、metrics infrastructure、gateway bindings、projector host、scheduled maintenance、cron scheduler、trajectory worker、memory aging/extraction schedulers、RAG retrieval/governance、cron store/callback registration、request runtime、server和runtime logger binding等被成功app lifecycle关闭或解绑的handle，一旦runner接受或module完整返回即为app-owned并 SHALL立即登记；host只负责runner接受前的本地构造失败，runner接受后 MUST NOT在host catch中再次关闭。capability validation、Web/task readiness、RAG build callable与system config SHALL明确分类为start/read-only input且不登记；model service、provider/factory definitions、metrics registry、identity/credential resolver、test sinks和没有close contract的channel/workbench contribution保持caller-owned且 MUST NOT登记。`composeAppLifecycle`的每个input SHALL进入compile-time completeness map，新增未分类input时验证必须失败。sync runner SHALL逆序、至多一次地best-effort触发cleanup，async runner SHALL按相同顺序等待cleanup settle；cleanup failure MUST NOT覆盖原始safe failure。该cleanup只修正composition failure的资源遗留，MUST NOT接管`app.start()`失败、改变成功启动、正常shutdown、owner lifecycle contract、public API、配置、持久化或request lifecycle behavior。

Owner package MUST expose narrow public factory、adapter 或 probe API for its own behavior when app composition is required。`agent-app` MUST consume those APIs instead of inlining owner-owned algorithms or domain output parsing。

设计入口：`openspec/designs/modules/agent-app.md`

#### Scenario: agent-app 只执行一次配置加载

- **WHEN** app startup 接收 injected system config 或加载 default config、application overlay 和 environment/reference-dependent inputs
- **THEN** preparation SHALL 在模块装配前完成 evaluate、validation、ready gate 和 freeze
- **AND** 同一次 composition 的所有后续模块 SHALL 消费同一个 `DefaultSystemConfig`、两个 configuration-owned 窄输入或前序 typed result
- **AND** 其他 composition entry MUST NOT 再次读取 config source、`process.env` 或复制完整 config state
- **AND** 配置入口 MUST NOT 执行 request-time memory、workflow、context、model、capability、session、gateway 或 observability 业务行为

#### Scenario: plugin snapshot 在入口 preparation 一次加载并冻结

- **WHEN** 第0层preparation已取得frozen config及optional injected plugin snapshot
- **THEN** 它 SHALL在config之后、product-host defaults及其他startup contribution preload之前，按injected snapshot优先 → empty frozen snapshot → sync/async loader的唯一规则完成plugin load、validation和freeze
- **AND** sync与async preparation SHALL产出同形、只创建一次的frozen plugin composition；required plugin失败 SHALL在shared core前终止，optional rejection SHALL只保留既有safe degraded diagnostic
- **AND** 第1层lifecycle definitions SHALL只消费snapshot hooks，第2层Agent assembly及后续request runtime policy SHALL只消费snapshot policies，第4层capability SHALL只消费snapshot providers并可复用policies完成既有validation，既有安全诊断/characterization路径 MAY消费snapshot diagnostics
- **AND** capability或其他下游阶段 MUST NOT加载plugin、重新读取plugin source/config root、重建snapshot或改变已冻结的plugin selection
- **AND** plugin loading SHALL属于第0层preparation，MUST NOT新增第九个宏观层级

#### Scenario: cron deployment prerequisite 由消费阶段校验

- **WHEN** frozen config 处于现有cron未启用/缺省状态，或选择`LOCAL`、`REMOTE` deployment，并由preparation分别规范化为app-private `DISABLED`、`LOCAL`、`REMOTE`
- **THEN** preparation SHALL 只投影该 selection，不得产出 cron runtime readiness 结论或调用独立 cron prerequisite validator
- **AND** 平台基础设施阶段 SHALL 按 selection 选择并构造 cron task gateway；selected binding/factory 缺失 SHALL 在该 gateway 消费点按既有安全错误失败
- **AND** 执行能力阶段 SHALL 只消费 selection 和 optional cron task gateway：`DISABLED` 返回 typed disabled result，`LOCAL | REMOTE` 要求 gateway并返回含deployment、cron capability port和observation的typed enabled result；该阶段 MUST NOT 接收scheduler factory、server、callback credential或callback registration
- **AND** runtime/channel 阶段 SHALL 按该 typed result switch：`DISABLED`不得创建cron runtime，`LOCAL`仅在创建scheduler时要求gateway与scheduler factory，`REMOTE`仅在创建verifier和注册callback route时依次要求callback credential reference与callback registration
- **AND** 未选中分支的专属输入 MUST被忽略；同时缺少REMOTE credential与registration时 SHALL先返回既有`CRON_CALLBACK_CREDENTIAL_REQUIRED`，credential存在后缺registration SHALL返回既有`CRON_CALLBACK_REGISTRATION_REQUIRED`
- **AND** `CRON_TASK_GATEWAY_UNAVAILABLE`、`CRON_TASK_SCHEDULER_FACTORY_REQUIRED`及上述REMOTE safe error的code/category/retryability MUST保持；多项依赖同时缺失时 selected gateway错误 SHALL先于LOCAL/REMOTE runtime prerequisite，REMOTE runtime内credential错误 SHALL先于registration；task → cron → optional frontend route顺序 MUST保持
- **AND** `cronTriggerCallbackRegistration.ready()` SHALL继续只在既有`NextAgentApp.start()` lifecycle gate执行，不得与composition prerequisite合并
- **AND** root/startup contribution MUST NOT调用或导入`validateCronRuntimeComposition`或同义standalone preflight；module-private branch prerequisite helper MAY存在
- **AND** REMOTE prerequisite在server创建后失败时 app MUST不返回，已登记server及其他app-owned资源 SHALL由同一runner-owned failure scope逆序且至多一次清理，原始safe failure不得被cleanup覆盖

#### Scenario: local runtime package 复用一次 package config fact

- **WHEN** local runtime package 通过 direct local start 或 deployment-dispatch start 构造应用
- **THEN** package preparation SHALL 只读取、解析、resolve、validate 和 freeze config sample 一次
- **AND** LOCAL dispatch SHALL 把同一个 prepared package host result交给app-private local start，不得再次调用完整package preparation
- **AND** product configuration entry SHALL 接受同一个injected frozen config并只补齐窄environment/reference projection，不得重新打开config文件
- **AND** package preparation SHALL先创建唯一operational writer，再初始化optional OTLP trace projector，并把二者作为app-owned injected handles交给runner
- **AND** package host SHALL 通过private host facts保持manifest/layout/config/start/health/gateway/run-state evidence语义，但 MUST NOT构造第二套product model、gateway、通用observability或cleanup pipeline

#### Scenario: 顶层流程按宏观层级连续可读

- **WHEN** `composeNextAgentApp` 装配完整产品应用
- **THEN** 顶层 SHALL 依次展示启动贡献、Agent 静态装配、平台基础设施、执行能力、应用服务、runtime/channel 和 app lifecycle
- **AND** 每一层 SHALL 能识别其上游 typed result、直接模块调用、必要 binding/cleanup handoff 和下一层消费者
- **AND** 模块内部 provider selection、adapter construction、optional branch、job registration、diagnostic mapping 和领域结果处理 MUST NOT 展开到 root
- **AND** 顶层 MUST NOT 为这些宏观层新增只做转发的 stage object 或 wrapper

#### Scenario: public options 不穿透 preparation 边界

- **WHEN** 同步或异步 public factory 完成配置和 preload preparation
- **THEN** 它 SHALL 逐字段构造固定的 app-private prepared input
- **AND** shared core SHALL 只接收这一个 prepared input，并只把对应窄字段或字段组传给模块 entry
- **AND** 任一模块 entry MUST NOT 接收 public options、完整 prepared input、动态 lookup 或未约束的 injection bag

#### Scenario: host 差异在 shared core 前消失

- **WHEN** Local、Remote 或 Test host 准备 app composition 输入
- **THEN** host SHALL 只投影该场景受信任的 config fact、default、adapter、contribution、override 或 caller-owned/app-owned handle
- **AND** sync 或 async product preparation SHALL 把这些输入转为同形 `PreparedCompositionInputs`，host MUST NOT 直接构造该 root state
- **AND** frozen config SHALL 决定 capability/deployment adapter selection，host identity MUST NOT 代替配置选择
- **AND** `PreparedCompositionInputs`、`composeNextAgentApp(...)` 和 module entry MUST NOT 包含或检查 `hostKind`、`testMode`、`LOCAL | REMOTE | TEST` 或等价 discriminator
- **AND** Local package、Remote deployment 和 Test override 的差异 SHALL 分别以普通 configuration、assembly、gateway、channel、observability 或 lifecycle input 进入同一 core

#### Scenario: 所有真实装配 surface 都进入唯一职责路径

- **WHEN** `agent-app`或已列明external host路径读取或派生app config、解释完整app/test options、选择host/profile/provider defaults、构造channel contribution、注册server/plugin/hook、交接closable resource、选择app factory、决定composition rollback或组装test product input
- **THEN** 该路径 SHALL 被分类为 product runner、module entry、product/package/test host、host adapter、testing facade或thin launcher之一
- **AND** 它 SHALL 只执行该surface在design中定义的ordered flow和typed handoff
- **AND** architecture verification SHALL覆盖整个`packages/agent-app/src`并定向覆盖local gateway public/testing facade、remote deployment、root process host、local dev host和workflow demo host，在出现未分类或竞争装配路径时失败
- **AND** 不拥有上述装配决策的schema/parser、owner factory implementation、evidence mapping、safe diagnostic或leaf helper MUST NOT仅为统一文件形态被修改

#### Scenario: test host 保持完整注入能力但不形成第二条产品 pipeline

- **WHEN** `createNextAgentTestApp` 或 testing facade 接收 basic/config、model、observability、lifecycle、gateway/runtime、capability和cron共37个顶层test inputs
- **THEN** test host SHALL 保持每个显式override、default、isolated config/default Agent、deterministic model、observation capture和test lifecycle registration的既有结果
- **AND** test host SHALL 把结果投影为普通production inputs并调用同一sync或async runner
- **AND** test host MUST NOT调用module composition entry、直接构造`PreparedCompositionInputs`、复制production config loader/module order/channel registration/failure scope或让test-only fields进入production prepared type

#### Scenario: 产品宿主注册在同一 failure scope 内完成

- **WHEN** backend-only、with-frontend、local configured auth、local gateway 或 remote deployment 宿主构造产品应用
- **THEN** 宿主 SHALL 分别选择channel auth与frontend hosting两个正交profile，并完成自身可信、窄且非竞争的adapter/workbench/task contribution preparation；package kind与local gateway defaults不得进入channel profile
- **AND** local configured auth facade SHALL把原options、固定channel auth profile和不捕获options/config/server的local-only typed contribution交给同一sync runner；auth config validation、auth/plugin construction、protected Web/extension registration和readiness SHALL只在channel stage的contribution invocation内完成
- **AND** shared channel、generic core、backend-only与with-frontend MUST NOT静态依赖local-auth实现包
- **AND** with-frontend SHALL 把字段固定的 host input 交给唯一async runner，由该 runner 先创建唯一 failure scope，再复用同一个 async preparation/core，且不改变 package public options或创建第三个runner
- **AND** `productVersion`、manifest resolver、index scripts、local gateway/workbench defaults、default-workbench script 注入条件和 candidate evidence/version validation SHALL 保持既有 override 优先级与可观察结果
- **AND** local configured auth、workbench extension、Web channel 和 task channel SHALL 通过同一 channel entry family 注册
- **AND** core 返回尚未公开的完整 app 且 cron callback route 已完成后，async runner SHALL 在 scope commit 前调用唯一 typed async host finalizer，按既有顺序解析/校验 manifest/version并 await frontend static hosting 和 SPA fallback 的最后注册
- **AND** 除该字段固定 finalizer 外，任一产品宿主 MUST NOT 在 shared core 返回后补充 server route、plugin 或 registration；composition failure scope commit 或 app public return 后一律禁止补注册
- **AND** manifest、version 或 registration 失败 SHALL 保持 app 未返回，并进入同一 composition rollback

#### Scenario: executable entrypoint 只承担 launcher 职责

- **WHEN** backend-only、local-configured-auth或with-frontend executable entrypoint启动产品
- **THEN** launcher SHALL只选择公开factory/profile并调用`app.start()`
- **AND** launcher MUST NOT读取或规范化app config、构造gateway/model/observability defaults、注册route/plugin或拥有composition rollback
- **AND** `app.start()` failure的统一自动close策略不由本change定义
- **AND** local/remote runtime package SHALL按package host contract保留preflight、evidence和start-failure app close，不被误分类为thin launcher

#### Scenario: channel profile 与registration precedence保持唯一

- **WHEN** product preparation把channel auth profile、custom Web、trusted extension/workbench和task contribution交给channel entry
- **THEN** `DEFAULT_WEB`且custom Web存在时 SHALL只调用custom registration并保持trusted extension不调用
- **AND** `DEFAULT_WEB`且custom Web缺省时 SHALL先注册builtin Web再调用trusted extension
- **AND** `LOCAL_CONFIGURED_AUTH` SHALL忽略caller custom Web registration，由local-only contribution校验config、构造auth/plugin、在protected scope注册builtin Web并调用trusted extension
- **AND** 三条路径 SHALL随后依次完成task、cron和optional frontend hosting，local auth与default/custom Web不得重复注册业务route
- **AND** 任一Web/auth/task/cron/frontend failure MUST终止composition；只有workbench unavailable MAY按既有local adapter contract降级

#### Scenario: package-private host facts保持public app不变

- **WHEN** shared core完成gateway selection、observability handoff和app lifecycle composition
- **THEN** 它 SHALL返回package-private outcome，其中`app`保持完整`NextAgentApp` shape，`hostFacts`只含safe gateway readiness facts和start-failure reporter
- **AND** public product/local-auth/with-frontend facade SHALL只返回`app`，不得公开`hostFacts`
- **AND** local package private start MAY消费host facts生成既有provider/readiness proof和安全start-failure diagnostic，不得重建gateway pipeline或取得closable handle
- **AND** host facts MUST NOT含credential、路径、raw provider error、完整config或cleanup authority

#### Scenario: external hosts保持各自黑盒职责

- **WHEN** local gateway facade/testing facade、root process host、local dev host或workflow demo host构造或启动app
- **THEN** local gateway facades SHALL保持`localGatewayCompositionDefaults` public helper、fixed local defaults、explicit override、SkillHub fallback、audit capture和metrics default/readback
- **AND** root process host SHALL保持fatal boundary、start-failure close和exit status
- **AND** local dev host SHALL保持local gateway/workbench defaults与成功start，workflow demo SHALL保持pre-start CORS hook、workflow mock和signal close
- **AND** 每条路径 SHALL只调用一个product/test runner，MUST NOT复制module order、创建第二个config/core或拥有composition rollback

#### Scenario: 模块装配流程保持内聚

- **WHEN** 一个模块需要选择 owner factory、构造 adapter、处理可选配置、注册本模块产生的 job 或返回下游服务
- **THEN** 这些装配事实 SHALL 由该模块唯一权威 composition entry family 完成
- **AND** 真正跨前后依赖的模块 MAY 暴露少量具名 entry，但每个 entry SHALL 有明确 typed input/output 且不构成第二条完整路径
- **AND** 可选分支 SHALL 返回明确 empty/absent projection，MUST NOT 返回部分初始化对象或功能不等价 fallback
- **AND** 创建 closable resource 的 entry SHALL 清理构造中途未交接的本阶段资源，并在成功后返回具名 cleanup handle
- **AND** 已经内聚且已经清晰实现目标有序流程的模块 MUST NOT 仅为统一文件形态被重写

#### Scenario: 模块内部装配流程连续可读

- **WHEN** 开发者阅读任一权威 module composition entry family
- **THEN** 它 SHALL 能按一个确定顺序识别输入校验或实现选择、依赖构造、可选分支、observer/job registration 和 typed result projection
- **AND** 每个跨前后依赖的具名 entry SHALL 明确其触发层级、前置 typed result、输出和唯一后续消费者
- **AND** 可选分支、构造失败、资源交接和 cleanup owner SHALL 在该模块流程中明确，不得依赖 root 猜测
- **AND** 如果现有入口已经实现该流程，实施 SHALL 复用并以测试确认；如果流程仍由隐式 mutation、跨文件回填或无序混合表达，实施 SHALL 在同一权威 entry family 内做最小收敛

#### Scenario: agent-app 只执行依赖注入

- **WHEN** product composition 连接 memory、workflow、context、model、capability、question、gateway、session、observability、health 或 channel 依赖
- **THEN** `agent-app` SHALL 调用对应权威 composition entry 和 owner public factory
- **AND** 它 SHALL 只传递所需窄依赖或 frozen config projection
- **AND** 它 MUST NOT 内联 owner-owned extraction、prompt preparation、catalog construction、provider request、ranking、record mapping、observation shaping 或 summary generation algorithm

#### Scenario: owner packages do not depend on agent-app

- **WHEN** owner package 暴露供 app composition 使用的 factory
- **THEN** owner implementation module MUST NOT import `agent-app` 或 app-private composition module
- **AND** owner package SHALL 只通过 public package exports、`agent-contracts`、`agent-common` 或 owner-owned public API 协作
- **AND** dedicated product/testing facade MAY 调用`agent-app` public export，但`agent-app` MUST NOT反向import该facade，且该facade MUST NOT被owner implementation调用
- **AND** architecture verification MUST 在 owner implementation 反向依赖 `agent-app` 或形成循环时失败

#### Scenario: 真实循环依赖通过受控绑定完成

- **WHEN** lifecycle invocation、workflow invocation/runtime adapter、runtime subagent 或 background timeline 存在无法通过阶段重排消除的循环
- **THEN** root SHALL 使用字段固定的 typed deferred holder
- **AND** 每个 target SHALL 只允许成功绑定一次
- **AND** 任一 target 的重复绑定 SHALL fail closed
- **AND** lifecycle hook invocation 在未绑定时 SHALL 返回既有 `{ status: "CONTINUE", boundary }` neutral result
- **AND** workflow capability invocation、workflow runtime adapters 和 runtime subagent execution lookup 在未绑定时 SHALL 返回 `undefined`，其必需消费者 SHALL fail closed
- **AND** background runtime timeline 在未绑定时执行 event emission MUST fail closed
- **AND** 可以通过普通顺序传递的依赖 MUST NOT 进入 deferred holder

#### Scenario: 同步和异步入口共享同一装配核心

- **WHEN** 相同 frozen config 和等价 injected dependencies 分别通过同步或异步 public facade 装配
- **THEN** 调用链 SHALL 分别恰好进入唯一sync runner或唯一async runner，每次只创建一个failure scope
- **AND** 两个 runner SHALL 产生同形 prepared input，并调用同一个 shared core
- **AND** 模块顺序、capability/workflow/memory/question availability、health/readiness、lifecycle 和 shutdown behavior SHALL 一致
- **AND** 异步文件、plugin、log 或 upload preload，以及唯一 with-frontend commit 前 host finalization，MUST NOT 形成第二条模块装配 core
- **AND** sync runner SHALL 对 async-only input 失败或由类型边界阻止，MUST NOT 静默跳过、fallback 或降级该能力
- **AND** 既有 public sync factory SHALL 保持可用；删除或废弃 sync API MUST NOT 在本 change 实施

#### Scenario: 装配失败清理尚未交接资源

- **WHEN** configuration、host/preload contribution 或任一 module composition entry 失败
- **THEN** app SHALL 保持未就绪且未到达的后续模块 MUST NOT 被装配或启动
- **AND** 当次唯一app-private sync或async runner SHALL 是 failure scope 及 commit/sync-async rollback policy 的唯一 owner，public/host/test facade MUST NOT 创建竞争 scope
- **AND** 已创建但尚未交给最终 app lifecycle 的 closable resources SHALL 按登记逆序至多关闭一次
- **AND** 既有成功app lifecycle关闭的injected handle SHALL在runner接受时按app-owned登记，host MUST NOT在runner接受后的composition catch中再次关闭
- **AND** scheduled maintenance、cron scheduler、trajectory worker、memory aging/extraction schedulers和runtime logger binding SHALL与writer/metrics/gateway/RAG/runtime/server/registration同样进入lifecycle input completeness map并按contract登记
- **AND** capability validation、Web/task readiness、RAG build callable和system config SHALL显式分类为无cleanup的start/read-only input；任一新增未分类lifecycle input MUST使验证失败
- **AND** 没有app close contract的model/provider/factory/metrics registry/test sink/contribution SHALL保持caller-owned且不得伪造cleanup
- **AND** 同步入口 SHALL best-effort 触发 cleanup，异步入口 SHALL 等待 cleanup settle
- **AND** cleanup error MUST NOT 改写原始安全失败结果或泄漏 raw config、credential、路径或 provider error
- **AND** 成功路径和正常 app close SHALL 继续使用既有 app lifecycle ownership 和顺序

#### Scenario: composition refactor 保持产品行为

- **WHEN** 装配逻辑在 preparation、顶层 core 和模块 entry 之间重新归位
- **THEN** startup readiness、request acceptance、capability/workflow/memory/question availability、Web/task/frontend hosting/local auth channel、cron、health、observability、background task、upload cleanup、RAG governance、active Agent assembly refresh、runtime recovery identity 和正常 lifecycle shutdown SHALL 保持兼容
- **AND** `NextAgentApp` 的 server、runtime、sessions、gateway、assembly registry、optional audit writer、metrics registry/readiness、health、model profile registry、capability providers、system config、product model provider kind、start 和 close projection SHALL 保持同形同义
- **AND** test-only `channelPort`、`observationLogger`、isolated config/default Agent 和 app lifecycle registration SHALL 保持，但 testing facade MUST NOT 形成第二条 preparation/core/module order
- **AND** `NextAgentTestAppOptions` 的全部37个顶层inputs及其override/default/observation行为 SHALL保持，不得只保护testing facade的少数字段
- **AND** local runtime package direct/dispatch start的config、packaged Agent、backend-only/with-frontend profile、gateway/workbench、service version、startup/health evidence和run-state行为 SHALL保持，但每次start只产生一个package config fact和一个product runner调用
- **AND** backend-only、local-auth和with-frontend launcher的成功启动行为 SHALL保持，同时不得重新获得app construction ownership
- **AND** local gateway public/testing facade、root process host、local dev host和workflow demo host的defaults、capture、fatal/start-failure、CORS/signal与成功start行为 SHALL保持
- **AND** 本 change MUST NOT 新增或修改 public Web API、runtime command、stream event、gateway schema、persisted fact、配置格式、Agent package 格式、model/capability invocation contract 或 request lifecycle semantics
