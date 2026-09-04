# TS 后端架构

## Node-only technical foundation 例外

`agent-local-file-roll` 是受限 technical foundation，不是领域 package 或可替换 adapter。它只封装 async line destination、size+process-local daily rotation、active identity、atomic gzip、reconciliation、elapsed retention 和 bounded lifecycle。依赖方向固定为 `agent-log | agent-observability | agent-platform-gateway-local -> agent-local-file-roll`；仅这三个 production consumer 被 allowlist，foundation 不得依赖 `agent-common`、`agent-contracts` 或实现 package。

该例外不放宽其它 implementation-to-implementation firewall。Operational log、LOCAL metric history 与 LOCAL audit 只共享机制代码，必须使用三个独立 policy/handle/state；领域 schema、failure mapping、deployment selection、readiness 和 lifecycle ownership仍分别归三个 consumer。

## 架构驱动

NextAgent TS 后端面向电信网络智能体框架，而不是通用聊天机器人或通用 coding-agent 平台。架构基线必须同时服务直接使用智能体的用户、基于框架二次开发的开发者和集成者，并满足电信级质量属性。

四类顶层诉求是稳定架构输入：

| 顶层诉求 | 架构推导 |
|---|---|
| 面向电信网络智能体 | context、model、capability、gateway、assembly 边界必须能承载电信任务、领域术语、网络能力治理、运维诊断和客户系统集成。具体网络域、工具分级、审批、回滚、术语表和提示词策略由后续 change 定义。 |
| 服务两类用户 | `agent-app` 提供默认装配；`agent-contracts`、adapter/provider package、capability boundary 和 `agent-test-kit` 为开发者与集成者提供扩展和验证面。 |
| 支持多入口接入 | 第一阶段提供 Web submit/SSE/history 的最小产品切片，但 runtime command、canonical event、identity propagation、session ownership 和 stream facts 不得写成 Web-only。 |
| 满足电信级质量属性 | 安全、容量、可靠性、恢复、审计、诊断、维护和测试进入 package 边界、runtime ownership、async boundary、event stream、observability 和 verification gate。 |

## 范围和非目标

当前稳定基线定义 TS 后端 workspace、package topology、runtime ownership、adapter boundary、composition root、event ownership、sandbox boundary、local/PaaS 运行形态边界、验证门禁、首个可运行的最小 Agent 问答内核切片，以及可选长期记忆能力组的 core/config/tools/task-trajectory/extraction/aging 边界。

当前稳定基线不定义：

- 前端页面行为、浏览器状态管理、UI 交互细节、完整 cancel/retry/edit 用户控制、完整多实例 recovery、完整本地运行包打包/升级或附件产品能力。同仓 `frontend/agent-web` 源码和后端静态托管只通过 `fullstack-packaging-boundary` 定义的构建后包产物边界进入稳定基线；WebSocket 由 stream transport capability 单独定义。长期记忆 sharing/publish/fork、REST/Web 维护界面、remote complete-service memory protocol、context assembly 自动记忆注入和多实例 durable memory scheduler 仍在当前基线范围外。
- 具体认证 endpoint、cookie/ticket、credential 校验协议、identity 解析协议、remote/IAM 认证协议、public gateway auth contract、非 localhost 本地认证暴露、reverse proxy/TLS secure-cookie 部署规则或 server-side auth session store。
- 动态插件加载、运行时热插拔、远端实现包加载、第三方包分发协议、marketplace discovery、remote gateway endpoint、sandbox runtime、SkillHub/remote Skill source installation、SubAgent、audit sink 或 metrics sink 的具体实现协议。

## 第一阶段关键场景

- 直接使用者启动默认后端装配，无需编写 runtime glue code。
- Web/LUI 请求通过 channel adapter 进入 runtime command boundary，channel 不拥有请求生命周期。
- 中文或英文请求在 request、context assembly、model/prompt selection、capability metadata、streamed response 和 final result 边界上保留 normalized language/locale。
- 长任务通过 async Agent、Model、Capability、Gateway contracts、bounded scheduler、same-session lane、`AbortSignal` cancellation 和 terminal commit boundary 保持可控。Tool、Skill、Agent capability 都作为 Capability 类型遵守同一执行边界。当前 gateway-local 只有 SQLite local atomic persistence transaction，Gateway public port 保持 async，远程、长耗时或可取消的 Gateway cancellation 后置。
- Agent、Model、Capability 等执行组件发布事实事件；runtime 维护 canonical timeline；Web channel 只把事件投影为可流式渲染的 transport envelope。
- 已持久化的公开过程正文只由 `SessionMessage` 拥有；canonical timeline 只保存时序、状态和经 scope 校验的消息强引用。runtime 提供 server-only bounded association，channel 统一投影 live/history，浏览器不读取 hidden message；引用失败降级为 status-only，禁止回退 event 正文双写。
- PaaS 多实例部署后续启用时，任一实例故障后，其他实例必须能基于共享 RequestRun、checkpoint、pending input、timeline、lock/lease、version 和 terminal commit state 接续或安全终止请求；本地运行态只提供单实例进程重启恢复。
- 模型、hook、policy、capability 或 runtime 需要人参与时，通过统一 human interaction boundary 挂起为 pending input；澄清、确认、授权、选择和人工接管不创建新的 root request。
- Agent 在收到 runtime 调用后，先通过 Agent 内部 routing policy 决定走确定性流程、模型驱动 loop、澄清、拒绝或人工接管；runtime 不做业务语义路由。
- 非内置 Skill source 进入统一 capability source/catalog 生命周期，不形成独立 Skill 执行机制。
- shell、python、脚本和模型生成代码等动态可执行内容只能通过 sandbox execution boundary 执行。
- 同仓 `frontend/agent-web` 前端源码只能通过构建后的 `@nextagent/agent-web` npm 包产物和 `@nextagent/agent-web/hosting` public export 被 `agent-app` 托管；后端 package 不直接消费前端源码或 frontend-private path。
- 开发者通过 public contract 添加 adapter/provider 替换包，并由 `agent-app` 显式装配。
- 运维人员通过业务标识、structured logs、traces 和低基数 metrics 定位请求、gateway、能力调用和终态提交路径。

## 术语约定

- `Capability` 是能力的总称，用于描述可以被 Agent 发现、选择、调用和审计的可执行能力。
- `Tool` 是 Capability 的一种，通常表示一次明确的外部动作、查询或本地操作。
- `Skill` 是 Capability 的一种，通常表示可复用的任务能力，内部可以编排模型调用、工具调用或其他能力调用。
- `Agent` 是 Capability 的一种，表示由当前 Agent 调用的另一个 Agent。它可以是本地 SubAgent，也可以是远端 Agent。架构上它不拥有独立的请求生命周期；它通过 capability boundary 接入，由 runtime 继续负责 cancellation、timeline、terminal commit 和审计边界。
- `agent-model` 是模型提供方适配模块。它负责把不同模型 provider 的差异归一化为 NextAgent 的模型调用、流式输出、tool-use 片段和错误结果；具体 provider SDK、开源库或平台 ModelGateway 调用只能放在该模块或 provider adapter 内部。这里的 ModelGateway 表示 PaaS 平台提供的推理网关，只有在配置选择推理网关时才由 `agent-model` 调用。

## 架构原则

| 原则 | 结论 | 保护目标 |
|---|---|---|
| Runtime owns lifecycle | request admission、scheduler、same-session lane、cancellation、checkpoint、terminal commit 和 canonical timeline 由 `agent-runtime` 拥有。 | 可靠性、恢复、审计、流式一致性 |
| Schema-first at trust boundaries | HTTP、stream、config、gateway、persisted JSON、capability input/output 等不可信输入必须在边界处运行时校验。 | 安全、可维护、可测试 |
| Adapter contains libraries | Fastify、SQLite/Kysely、provider SDK、PaaS SDK、OTel SDK 等外部库类型不得泄漏到 contracts 或 core package。 | 可替换、低耦合 |
| Capability is the executable umbrella | Tool、Skill、Agent 都作为 Capability 类型进入统一 discovery、disclosure、invocation、result consumption、audit 和 recovery 边界。 | 能力治理、二次开发、恢复 |
| Context assembly is not memory lifecycle | `agent-context-engine` 负责上下文选择和渲染；`agent-memory` 负责长期记忆、自学习和记忆生命周期。 | 职责单一、终态提交稳定 |
| Human interaction is one pending boundary | 澄清、确认、授权、选择和人工接管都进入 runtime-owned pending input。 | 用户体验、恢复、审计 |
| Dynamic execution goes through gateway sandbox | shell、python、脚本和模型生成代码只能通过 sandbox gateway boundary 执行。 | 安全、平台隔离、审计 |
| Explicit composition over hidden DI | `agent-app` 是唯一 composition root，通过 public contract 和 factory 显式装配。 | 可审查、可测试、整模块替换 |

## 关键方案和设计决策

| 决策 | 选择 | 理由 | 放弃的方案 |
|---|---|---|---|
| Runtime | Node.js LTS | 企业后端运行时、可观测、Fastify、工具链和长期维护风险最低。 | Bun 作为第一阶段生产 runtime |
| Web framework | Fastify | 性能、schema-first、inject testing 和 SSE/WS adapter 边界较适合后端服务。 | Express、NestJS、tRPC |
| Package strategy | responsibility-based packages + `agent-contracts` subpath exports | 保持模块 owner 清晰，同时避免边界粒度在 TS 中过度碎片化。 | 单包服务、每个 SPI 独立 package |
| Context policy | 上下文选择策略由 `agent-context-engine` 负责 | 与 context assembly 同属一个职责边界，避免把内部策略抬升为独立架构承诺。 | 将上下文选择策略定义为独立架构边界 |
| Attachment | 独立 `agent-attachment-runtime` | 附件有独立安全、暂存、可用性和 cleanup 生命周期，不能分散在 channel/runtime/context。 | 由 Web channel 或 session/gateway 顺带处理 |
| Memory | 独立 `agent-memory` | 长期记忆、自学习和记忆生命周期不是 context assembly 的内部细节。 | 塞入 Context Engine 或 Capability |
| Model | 独立 `agent-model` | provider SDK、stream normalization、tool-use 片段和 ModelGateway 差异不能泄漏到 core/runtime。 | core 直接调用 provider SDK |
| Sandbox | sandbox gateway contract + platform gateway adapter | 实际隔离由 PaaS 提供，TS 后端负责控制、审计和防绕过。 | 独立 `agent-sandbox` module |
| Request routing | Agent 内部 policy | 路由是 Agent 处理请求的一部分，也是开发者可定制点；runtime 不做业务语义路由。 | channel/runtime 前置路由 |
| Multi-channel | contract 支持，多实现后置，第一阶段只实现 Web | 避免 Web-only 生命周期，同时控制首批实现范围。 | 同时实现 IM/A2A 等 channel |
| PaaS 多实例 | 共享状态、lock/lease、version、terminal commit、非粘性请求 | 满足服务部署和故障接续，不把正确性绑到单进程内存。 | sticky session 或 process-local lifecycle |

## 逻辑视图

```text
agent-app
  -> agent-channel-web
  -> agent-app-frontend-hosting (with-frontend only)
  -> agent-runtime
  -> agent-session
  -> agent-attachment-runtime
  -> agent-context-engine
  -> agent-memory
  -> agent-core
  -> agent-model
  -> agent-capability
  -> agent-platform-gateway-local
  -> agent-platform-gateway-remote
  -> agent-observability

agent-channel-web-auth-local
  -> only local configured authentication product entry

agent-common
  -> shared foundation below contracts

agent-contracts
  -> stable public contract subpaths
```

Package responsibilities:

- `agent-common`：shared branded ids、基础 value object、JSON、安全错误、身份和基础 enum。
- `agent-contracts`：agent-assembly、runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app 的 public contract subpath。
- `agent-runtime`：request lifecycle、scheduler、cancellation、checkpoint、timeline、terminal commit。
- `agent-session`：session/message read model、history consistency、owner scope。
- `agent-attachment-runtime`：附件可信校验、staging、metadata extraction boundary、availability check、cleanup。
- `agent-context-engine`：history candidate selection、query policy、window selection、compaction、prompt shaping、disclosure budget。
- `agent-memory`：long-term memory、自学习、memory lifecycle、retrieval boundary。
- `agent-core`：默认 Agent orchestration、context render、model invocation、tool loop 和 Agent 内部 routing policy boundary。
- `agent-model`：模型 provider adapter boundary、stream normalization、safe provider error mapping。
- `agent-channel-web`：Web transport、Fastify plugin、SSE/WS stream projection、presentation-safe errors。
- `agent-app-frontend-hosting`：`with-frontend` profile 下的前端静态资源和 SPA fallback Fastify 插件；不进入 `backend-only` 入口依赖图。
- `agent-channel-web-auth-local`：localhost-only local configured authentication 的 optional Web auth adapter boundary。
- `agent-platform-gateway-local`：SQLite local gateway adapter，拥有私有 row/schema/index/transaction 细节和主路径专用事实表。
- `agent-platform-gateway-remote`：remote gateway adapter、PaaS sandbox gateway adapter、failure normalization。
- `agent-capability`：Capability lifecycle boundary，统一 Tool、Skill、Agent。
- `agent-observability`：structured logging、redaction、trace/metric integration wrapper。
- `agent-app`：唯一 composition root；按产品入口选择 `backend-only` 或 `with-frontend` serving shape，并在 `with-frontend` 下注册前端静态资源托管。
- `agent-test-kit`：schema samples、临时 SQLite test helper、architecture test helpers。

## Capability 生命周期视图

Capability 是可执行能力的总称。Tool、Skill、Agent 是 Capability 类型或后续 capability change 定义的能力子类，不建立互相竞争的执行体系。

生命周期边界：

1. Registration：provider package 通过 public contract 暴露 capability descriptor。
2. Discovery：Agent assembly、tenant/subject、language/locale、source、version、availability 和 policy 决定当前可用能力。
3. Disclosure：Tool 以 tool schema 或等价模型工具描述进入模型输入；Skill 先以轻量 listing 进入模型输入；Agent capability 以可委托目标说明进入模型输入。
4. Invocation：Agent 调用 Tool、Skill 或 Agent capability，统一受 timeout、cancel、concurrency、event、safe error、audit、checkpoint 和 idempotency 边界约束。
5. Result consumption：能力结果进入模型上下文、会话历史、审计、归档或恢复状态时，必须经过显式 result consumption boundary。
6. Recovery：PaaS 多实例恢复时根据 checkpoint 和 capability idempotency declaration 判断重放、等待、标记未知或安全失败。

## 模块间数据流

下图说明第一阶段架构骨架中各模块如何交互。它只表达责任和数据流方向；最小 Web submit/SSE/history、runtime lifecycle、gateway persistence 原则和 RequestRun 领域不变量由对应 spec/design 主承载，数据库物理 schema 和后续能力协议不在本图中定义。

```text
Web/LUI client
    |
    v
agent-channel-web
    |  local auth boundary when local configured authentication is enabled
    |---- local auth adapter boundary ----> agent-channel-web-auth-local
    |  typed command / stream subscribe / attachment upload
    |---- validates/stages attachment ----> agent-attachment-runtime ----> platform gateway
    v
agent-runtime
    |---- reads/writes session state ----> agent-session ----> platform gateway
    |---- validates attachment refs -----> agent-attachment-runtime
    |---- invokes Agent ------------------> agent-core
                                                |---- request routing policy
                                                |       |---- deterministic flow
                                                |       |---- user-directed Skill flow
                                                |       |---- model-driven loop
                                                |       |       |---- requests context/prompt -> agent-context-engine
                                                |       |       |                                |---- reads history refs -> platform gateway
                                                |       |       |                                |---- reads capability disclosure -> agent-capability
                                                |       |       |                                |                                   |---- Tool / Skill / Agent descriptors
                                                |       |       |                                |---- returns rendered model input
                                                |       |       |---- invokes model -----------> agent-model
                                                |       |       |                                |---- provider SDK / platform ModelGateway / remote inference
                                                |       |       |---- invokes capability ------> agent-capability
                                                |       |       |                                |---- Tool / Skill / Agent providers
                                                |       |       |                                |---- model-facing memory tools -> agent-memory ----> platform gateway
                                                |       |       |                                |---- platform gateway when needed
                                                |       |       |                                       |---- PaaS sandbox for dynamic executable content
                                                |       |---- clarify/reject/handoff

执行事实事件：
agent-model / agent-capability / agent-core / platform gateway
    -> agent-runtime canonical timeline
    -> agent-channel-web stream projection
    -> Web/LUI client

诊断信号：
all packages -> agent-observability -> logs / metrics / traces

动态执行：
agent-capability / hook / policy
    -> sandbox gateway contract
    -> agent-platform-gateway-local / agent-platform-gateway-remote
    -> PaaS sandbox or local unavailable/limited implementation
```

关键约束：

- `agent-channel-web` 只负责 Web/LUI transport，不拥有 request lifecycle。
- `agent-channel-web-auth-local` 只负责 localhost-only local configured authentication adapter：login/logout route、signed HttpOnly cookie、unauthenticated challenge、SSE/WS cookie auth 和 safe auth diagnostic。它不拥有 request lifecycle、session/message state、identity storage 或 IAM integration；禁用 local configured authentication 时不得提供本地认证能力；它是可选 composition package，不是 `agent-channel-web` 的必需依赖。
- `agent-runtime` 是请求生命周期和 canonical timeline 的唯一 owner。
- `agent-attachment-runtime` 是附件可信校验、暂存、可用性和 cleanup policy 的 owner；channel、runtime、context 和 session 不直接处理文件系统细节。
- `agent-memory` 是长期记忆、自学习、task trajectory、memory extraction 和 memory aging lifecycle 的 owner。Context Engine 不自动检索或注入长期记忆；模型需要长期记忆时通过 governed memory tools 显式调用，后台学习和生命周期维护通过 public gateway ports 异步执行。
- `agent-core` 编排 Agent 内部 request routing 和 Agent loop；在 model-driven loop 内先请求 `agent-context-engine` 生成 context/prompt，其中包含 visible history 和 capability disclosure，再调用 `agent-model`，并在需要时调用 `agent-capability`。执行中产生的 timeline event、assistant tool-use、capability result、checkpoint 和后续 session message 只能通过 runtime-owned `AgentRunStatePort` 请求 runtime 处理，不能直接写 gateway record。
- request routing 是 Agent 内部 policy 扩展点，不是 channel 或 runtime 的前置规则。
- 用户或上游入口提供的处理约束是 Agent 内部 routing policy 的输入；typed `RoutingConstraints` 只允许 `targetSkill`、`targetRecipe`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`allowHumanInput` 和 `allowSubagents`，不得携带或覆盖 Agent-owned `maxTurns` / `maxToolCallsPerTurn`。这些约束不能绕过 discovery、capability invocation、sandbox gateway、policy 或审计边界。runtime 还会把 accepted user input text 作为 runtime-owned request fact 传给 Agent routing policy，但它不形成新的授权边界。
- `agent-capability` 用统一能力模型承载 Tool、Skill、Agent，不把它们拆成相互竞争的执行体系。
- 非内置 Skill source 只是来源差异，进入统一 catalog、priority/conflict、availability、SkillTool、sandbox gateway 和 audit 机制。
- session/message/read model、history consistency 和 owner scope 由 `agent-session` 与 platform gateway 边界负责，其他 package 不直接操作会话相关存储。
- identity owner scope 必须贯穿 runtime、session、attachment、memory、capability、gateway 和 audit；任何跨 owner 访问都不能依赖下游存储偶然过滤。
- `sandbox gateway contract` 是动态可执行内容的唯一执行边界；capability、hook、policy 不直接启动 shell、python 或脚本，不直接依赖 PaaS sandbox SDK。
- `platform gateway` 表示 local 或 remote gateway adapter；具体选择由 `agent-app` 装配。

## 开发视图

根目录是 TS 后端 workspace。`src/` 只承载最薄的进程启动入口；具体装配由 `packages/agent-app` 负责。`packages/` 承载内部 package；`tests/` 承载 architecture、contract、schema 和 integration 验证；`openspec/` 是规格源。仓库可以包含 `frontend/agent-web` 前端源码，但后端 workspace、后端 runtime 和 architecture lint 输入只能通过构建后的 `@nextagent/agent-web` 包产物消费它。

产品化 package 结构由本开发视图和 `openspec/designs/modules/<module>.md` 共同承载。核心 implementation package 不得把主流程实现集中在单个 `src/index.ts` 中；`src/index.ts` 只能作为 public barrel 或明确的 lightweight factory export。模块内部应按职责拆分到 lifecycle、timeline、terminal、agent、tools、routes、schemas、providers、catalog、assembly、services、stores 或 composition 等责任目录；具体目录名称以对应模块文档和当前代码职责为准，不为单次使用代码强行新增抽象目录。

Dependency rules 由 dependency-cruiser 和 package manifest policy 强制：

- `agent-contracts` 不得依赖 implementation packages。
- `agent-common` 不得导入 `agent-contracts`。
- `agent-runtime` 不得导入 Web channel、platform gateway adapters 或 app composition。
- `agent-channel-web` 不得导入 lifecycle owner packages，也不得依赖 `agent-channel-web-auth-local`。
- 后端 package 不得直接 import `frontend/agent-web` 源码、frontend-private path 或前端构建器临时目录；`backend-only` 入口不得依赖 `@nextagent/agent-app-frontend-hosting` 或 `@nextagent/agent-web`。
- `agent-channel-web-auth-local` 不得导入 `agent-contracts`、runtime、session、core、context、capability、attachment runtime、memory、`agent-channel-web` 或 app composition。
- business packages 不得泄漏 Fastify、Pino、Kysely、SQLite、OpenTelemetry、provider SDK 或 PaaS SDK 类型。
- cross-package import 必须使用 package name 和 public exports；private path import 失败。
- 除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 的源码 import 和 `package.json` workspace dependency 不得指向其它 implementation package。
- 产品代码不得从 `@nextagent/agent-contracts` root aggregate import；每个 package 只能导入模块设计授权的 `agent-contracts/<subpath>`。`agent-contracts/agent-assembly` 只承载 runtime-safe assembly facts，不承载 Agent execution、raw config 或 app compiler contract。
- `agent-app` 可以导入所有 package，并且是唯一装配具体实现的位置。
- `with-frontend` 产品入口可以导入 `@nextagent/agent-app-frontend-hosting` 和 `@nextagent/agent-web/hosting`；前端静态托管配置只能来自可信 profile 选择和 `resolveFrontendHostingManifest()`。

## 运行视图

Runtime kernel 拥有请求生命周期骨架：

```text
agent-channel-web
  -> runtime command boundary
  -> durable acceptance boundary
  -> bounded scheduler
  -> agent-core Agent boundary
  -> agent-internal request routing policy
  -> deterministic flow or model-driven loop
  -> agent-model / agent-capability boundaries
  -> sandbox gateway boundary for dynamic executable content
  -> terminal durable-write boundary
  -> timeline event publisher
  -> channel stream projection
```

TS runtime 定义：

- submit command、runtime session facade 和后续 request control command interfaces。
- request acceptance boundary、RequestRun 持久化、accepted assembly 固化和 `ACCEPTED -> EXECUTING` CAS。
- same-session lane scheduler；同一 `tenantId + subjectId + agentId + sessionId` lane 可持久化多个 queued runs，但默认同一时间最多一个 run 进入 executing/terminal-writing path，terminal-pending run 阻塞 dispatch。
- request cancel/retry、cancellation 和 timeout 的 `AbortSignal` propagation。
- checkpoint 和 terminal commit coordinator interfaces。
- timeline event publisher interface。
- async Agent、Model、Capability、Gateway invocation boundaries；Tool、Skill、Agent capability 通过 Capability invocation boundary 表达。
- bounded parallel execution extension boundary。
- human interaction pending input interfaces。
- sandbox execution gateway interfaces。

运行时规则：

- Scheduler 使用 Promise workers 和 explicit semaphores，不使用隐式 event-loop fanout。
- 长时间运行的 agent、model、capability 和 stream operations 必须是 async contract，并接收 cancellation context。Gateway public port 必须是 async contract；当前 gateway-local SQLite local atomic persistence transaction 以一致性为先，不承诺事务中途 abort，远程、长耗时或可取消的 Gateway cancellation 后置。
- 单个 RequestRun 首版串行执行 read tool loop；后续若启用 Tool、Agent capability、检索和确定性子流程并行，必须受 explicit concurrency budgets、dependency graph、result aggregation、timeout 和 cancellation propagation 约束。
- request routing 在 `agent-core` 的 Agent boundary 内执行。`agent-runtime` 只负责携带 accepted `routingConstraints` 和 runtime-owned `acceptedInputText` request facts，不根据业务语义选择确定性流程或模型 loop；runtime 只负责 admission、lane、cancellation、checkpoint、timeline 和 terminal commit。
- routing policy 可以选择 deterministic flow、user-directed Skill flow、model-driven loop、clarify、reject 或 human handoff；在当前稳定实现中，trusted `mode=policy` 可用 ordered regex rules 基于 accepted input text 首个命中固定导向 governed Skill path 或 governed workflow path。`targetSkill` 必须先经过 request-scope capability governance，再进入受控 deterministic path。
- routing、constraint validation 和 model fallback 结果必须通过 redacted evidence 进入 timeline-only `POLICY_APPLIED`、audit、log 和 trace；默认不投影到用户可见 stream/history。
- Model stream、capability progress、capability lifecycle、agent planning 和 runtime lifecycle 都进入 timeline event ownership model；最小内核已定义 submit/SSE/history 所需 canonical event vocabulary，后续 capability change 只能扩展或细化。
- 模型、hook、policy、capability 或 runtime 需要人参与时，必须通过同一个 human interaction pending input boundary 进入澄清、确认、授权、选择或人工接管；响应回来后继续同一个 RequestRun。
- shell、python、脚本和模型生成代码等动态可执行内容必须通过 sandbox execution gateway boundary；PaaS sandbox 或本地受限实现负责资源限制、文件系统范围、网络、环境变量、凭据、工作目录、输出大小和安全错误归一化。
- Request Execution Stream 的 SSE 和 WebSocket delivery 只投影 runtime event stream；唯一受控的 Session Activity Projection Stream 由 `agent-session` 从已提交 session/run/pending facts 派生，并使用独立 snapshot/delta contract。Activity 不进入 `StreamEnvelope`、`RuntimeSessionPort.streamEvents(...)` 或 request lifecycle。两类 stream 的慢客户端、transport close、heartbeat 与连接清理都属于 channel delivery concern，不修改 runtime lifecycle，也不伪造执行事实。
- terminal stream event 和 visible conversation history 只能在 terminal durable-write boundary 成功后对客户端可见。最小内核的 terminal commit 在一个 gateway composite transaction 中持久化 run terminal state、terminal assistant message、active context item 和 terminal timeline event。
- HTTP、stream、config、gateway response、persisted JSON、capability input/output 必须做 runtime schema validation。
- 双语相关 language/locale 值必须在 request acceptance 后进入 context assembly、model/prompt selection、capability descriptor filtering、stream metadata 和 final result。
- 当前身份和 owner scope 必须由 channel/auth 边界解析并进入 runtime command；session、attachment、memory、capability、gateway 和 audit 写入必须保留 owner scope，不信任请求体、模型输出或 capability 参数中的 owner 值。
- 最小内核只接受空 `attachments?: []` public DTO；真实 attachment refs、上传、解析和可用性校验由后续 attachment change 启用。
- 长期记忆、自学习和记忆维护通过 `agent-memory` 与 gateway owner-scoped memory ports 处理；这些后台或异步 lifecycle 不参与 request terminal commit 的必要写入。memory tools 是可选 Agent opt-in capability，不改变最小内核的 terminal commit 不变量。
- 本地运行和后续 PaaS 多实例部署复用同一 runtime/gateway contracts；本地 adapter 可以用单实例本地状态实现，PaaS adapter 启用时必须把 RequestRun、checkpoint、pending input、timeline、terminal commit、lock/lease 和 version 作为共享权威状态处理。
- 后续 PaaS 多实例正确性不得依赖 process-local memory、单进程 scheduler 或 sticky session；channel reconnect、stream resume 和 request control 必须能路由到任意健康实例。
- Tool 不默认支持幂等。执行有副作用的 Tool 或 Agent capability 前，runtime 必须有 checkpoint/idempotency boundary；如果目标能力未声明可安全重放，恢复逻辑不得盲目重复调用。
- Session/message/read model、active RequestRun、pending input 和 human handoff 事实必须通过 session/runtime/gateway contract 访问；其他 package 不得绕过 owner scope 直接操作会话状态。

输入护栏拦截轮的持久化是 Web channel → runtime command → gateway store owner 协作的一个稳定实例，不形成平行 lifecycle：Web channel 的 submit 路径在 guardrail 输入校验返回 `BLOCKED` 时，经 `RuntimeCommandPort.recordInputGuardBlock`（可选方法）把一对 `visible=true` 的用户输入与拒答消息下沉到 runtime，runtime 内部经 `SessionMessageStoreGateway.appendSessionMessage` 写入，不调用 `runtime.submit`、不创建 run、不产生 terminal timeline event。该 command 的 identity 来自当前 trusted owner/Agent/session scope，`requestId` 由 channel 生成、不关联 `runId`，`metadata.modelVisibility.excluded=true` 使 context assembly 在后续轮次排除该消息对。channel 抛 `GUARD_INPUT_BLOCKED`（HTTP 400）作为前端即时反馈，但持久化权威事实由 runtime/gateway 拥有，conversation 读路径按普通 `visible=true` history 返回该轮。`recordInputGuardBlock` 与 OUTPUT 护栏使用的 `hideRunMessages` 对称：前者记录无 run 的输入拦截轮（页面可见、模型排除），后者隐藏已有 run 的 assistant 终态消息（页面隐藏、模型排除）；两者复用同一 `SessionMessageRecord`/`SessionMessageStoreGateway`/`VisibilityReason="GUARD_BLOCKED"` 持久化面。`recordInputGuardBlock` 未实现时 channel 回退为仅 400 即时反馈（刷新丢失，渐进降级），不阻塞主路径。

## 部署和物理视图

第一阶段保留两种运行形态：

- 本地运行包：单实例进程重启恢复，不声明多实例集群调度或跨进程接管保证。
- PaaS 多实例：后续启用时不得依赖 process-local memory、单实例 scheduler 或 sticky session；必须通过共享 RequestRun、checkpoint、pending input、timeline、lock/lease、version、terminal commit state 和 idempotency boundary 保证故障接续和终态一致性。

本基线不定义具体 PaaS 产品拓扑、端口、流量切换或发布策略。

## 配置和 Secret 边界

`agent-app` owns startup composition：

- 读取内置 default-system 和 default-agent 配置，并解析 env secret override。
- 读取 Agent definition，编译为 runtime-safe `AgentAssemblyRegistry`。
- 通过 runtime schema 校验配置。
- 构造 typed system/component config、model provider profiles、capability catalog 和 app-internal assembly compiler output；模型目录与推理服务由 `agent-model` runtime factory 构造。
- 选择 SQLite local gateway adapter；remote gateway adapter 后置。
- 装配 runtime、Web channel、context engine、core、OpenAI model provider、capability subsystem、SQLite local gateway、no-op hook/checkpoint/audit provider 和 observability；具体 builtin Tool registration、ToolCatalog 和 Tool executor routing 由 `agent-capability` 拥有。
- 提供产品特定 composition entry/factory；local configured authentication 入口显式 import `agent-channel-web-auth-local` 作为边界包，remote/IAM 入口不得 import/register、bundle 或暴露该 package。
- 提供 `backend-only` 和 `with-frontend` 两个产品入口；`with-frontend` 入口通过 `@nextagent/agent-web/hosting` 读取前端托管 manifest，并通过 `@nextagent/agent-app-frontend-hosting` 注册静态资源和 SPA fallback。
- 使用 `packages/agent-app/manifests/backend-only.package.json` 和 `packages/agent-app/manifests/with-frontend.package.json` 作为候选运行包依赖权威；`packages/agent-app/package.json` 不是运行包依赖权威。
- 保留 attachment runtime boundary；长期记忆能力由 `nextAgent.memory.*` 冻结配置、selected gateway ports、Agent opt-in memory tools、本地 task trajectory/extraction/aging scheduler 和 remote complete-service backend gate 共同控制。最小内核仍不要求长期记忆启用。
- 暴露 Fastify server factory，用于 tests 和 local startup。

Secrets 只用 env/file credential sources 表示。Raw credentials 不得进入 config examples、stream payloads、messages、traces、logs、metrics 或 health details。Local configured auth 使用冻结 app configuration 和 secret validation result 组装，credential source 只能是 `env:` 或 `file:` SecretReference。

## App Composition Pipeline

`agent-app` 是完整应用对象图的唯一 composition root。产品、运行包、测试和进程宿主只能准备受信任的 host contribution 或调用公开 facade；它们不得复制模块顺序、创建第二套配置状态、持有 composition rollback policy，或把宿主类型带入共享 core。完整构造路径固定为：

```text
Local / Remote / Test host projection
  -> runProductCompositionSync(...) 或 runProductCompositionAsync(...)
  -> runner 创建唯一 CompositionFailureScope
  -> prepareCompositionInputsSync(...) 或 prepareCompositionInputsAsync(...)
  -> 唯一 PreparedCompositionInputs
  -> composeNextAgentApp(preparedInputs, failureScope)
  -> ProductCompositionOutcome { app, hostFacts }
  -> async runner 可选执行 with-frontend commit 前 finalization
  -> runner commit
  -> public facade 只返回 NextAgentApp；local package private path 可消费 hostFacts
```

`createNextAgentApp(...)`、`createNextAgentAppAsync(...)`、`createComposedApp(...)` 和 `createComposedAppAsync(...)` 是兼容 facade，不是四条 runner。一次调用链必须恰好进入一个 sync runner 或一个 async runner；两者产生同形 prepared input，并调用同一个 `composeNextAgentApp(...)`。async runner 是支持 async plugin/preload 和 with-frontend finalization 的完整路径；sync runner 只接受能够同步完整准备的输入，不得静默跳过、fallback 或降级 async-only 能力。

入口 preparation 与 shared core 共同形成八个宏观层级：

| 层级 | owner 与顺序 | typed handoff / 失败边界 |
|---|---|---|
| 0. 可信输入与配置准备 | identity/clock → bootstrap metrics → config → plugin snapshot load/validation/freeze → product-host defaults → remaining sync/async preload | 只产生一个 frozen `DefaultSystemConfig`、一个 frozen plugin snapshot 和一个 `PreparedCompositionInputs`；required preload failure 不进入 core |
| 1. 启动贡献 | lifecycle definitions → capability provider config/reference validation | 不预检 cron runtime prerequisite |
| 2. Agent 静态装配 | assembly compile/graph validation/scopes → directory preparation → lifecycle materialization → prompt registry → model runtime (`catalog` + `invocationService`) | Agent/Owner Scope、workspace policy 或 assembly 非法时，在基础设施创建前 fail closed；app 不拆解或二次包装 model runtime |
| 3. 平台基础设施 | observability bootstrap → gateway/stores/sandbox/RAG → selected cron task gateway → audit-backed observability completion | selected gateway/binding/factory 在实际消费点校验；已交接的 closable handle 立即登记到 failure scope |
| 4. 执行能力 | risk policy → typed cron capability → memory/background/workflow/capability subsystem → final assembly validation → workflow target binding | optional 分支收敛为 disabled/absent typed result；重复 binding 失败，必需 target 的非法提前调用 fail closed |
| 5. 应用服务 | attachment → memory maintenance → session/question/share → context → health | worker、scheduler 和 job 只构造或注册，不在 composition 中启动 |
| 6. Runtime 与通道 | request runtime → lifecycle/subagent/background target binding → channel/server → Web/local auth/workbench → task → cron runtime | channel/cron prerequisite 或 registration 失败时 app 不返回，已登记资源由同一 runner rollback |
| 7. App lifecycle/host handoff | core 构造现有 start/close handles并返回尚未公开的 outcome → async runner 可选完成 frontend hosting → commit → handoff | commit 前失败属于 composition rollback；commit 后由 `NextAgentApp.close()` 拥有正常关闭 |

`app.start()` 不属于上述 composition pipeline。它在完整 `NextAgentApp` 已交接后按 scheduled maintenance → cron scheduler → trajectory worker → memory aging → memory extraction → capability validation → Web ready → task ready → cron callback ready → RAG build → runtime recovery → server listen 的既有顺序执行。composition failure scope 不接管 start-phase failure，也不改变正常 shutdown 顺序；所有 launcher 的统一 start-failure close 仍需独立 reliability 设计。

### Prepared input 和宿主边界

`prepareCompositionInputsSync(...)` 与 `prepareCompositionInputsAsync(...)` 是唯一可以逐字段解释完整 public options 的入口。`PreparedCompositionInputs` 是 app-private、只读且字段固定的 root state，只包含 identity、configuration、observability、plugin、attachment、model、assembly、gateway、capability/runtime、lifecycle/workflow、channel 和 cron 输入组。它不得包含 public options 副本、rest-spread options、`unknown` service map、动态 key/lookup/setter、`hostKind`、`testMode` 或 `LOCAL | REMOTE | TEST` discriminator。只有 `composeNextAgentApp(...)` 可以整体接收该对象；模块 composition entry 只能接收所需的窄字段或字段组。

宿主决定“提供哪些受信任 contribution/default”，frozen config 决定“启用哪个 capability/deployment adapter”，product preparation 决定“如何形成同形 prepared state”，shared core 不感知宿主身份：

- Local package host 拥有 manifest/layout preflight、一次 config read/resolve/validate/freeze、packaged Agent definition、writer 后 optional OTLP trace bootstrap、candidate/run evidence 和 start/stop；LOCAL direct start 与 deployment dispatch 必须复用同一个 prepared package result。
- Remote host 只准备 remote gateway/model/RAG/sandbox contribution 与 deployment evidence，再调用一个 public product facade；不解释 module order 或 composition rollback。
- Test host 保留 `NextAgentTestAppOptions` 的全部 37 个顶层输入、isolated config/default Agent、deterministic model、local defaults、observation capture 和 lifecycle registration，但只能投影为普通 production inputs并调用同一 runner；shared core 不含 test branch。

产品选择只有两个正交维度：`channelAuthProfile: DEFAULT_WEB | LOCAL_CONFIGURED_AUTH` 与 `frontendHostingProfile: NONE | WITH_FRONTEND`。local/remote package kind、gateway defaults 和 test host kind 不得冒充第三种 profile。local configured auth 的 app-private contribution 是 `agent-app` 中唯一允许静态依赖 `agent-channel-web-auth-local` 的位置；shared channel、generic core、backend-only 和 with-frontend 不得静态依赖该实现包。

with-frontend facade 只投影 `productVersion`、manifest resolver、index scripts 和 `useDefaultWorkbenchScripts`，把字段固定的 `ProductHostCompositionInput` 交给唯一 async runner。该 runner 必须在 core 返回完整但尚未公开的 app 后、failure scope commit 前，完成 manifest/version validation 和 awaited frontend hosting registration；SPA fallback 保持最后注册。除这个 typed finalizer 外，任何产品宿主都不得在 core 返回后或 public return 后追加 route/plugin registration。

`ProductCompositionOutcome.hostFacts` 只允许包含安全 gateway readiness facts 和安全 start-failure reporter。它不得包含 credential、路径、raw provider error、完整 config、writer/projector/binding 或 cleanup authority；public factory、testing facade、`NextAgentApp` 和 `agent-contracts` 不得暴露该内部 handoff。

### Channel 与 cron 的消费点顺序

Channel registration 只有三条互斥路径：

| channel 输入 | Web/auth 顺序 | 后续顺序 |
|---|---|---|
| `DEFAULT_WEB` + custom Web | 只调用 custom registration，不再调用 trusted extension | task → cron → optional frontend hosting |
| `DEFAULT_WEB` + 无 custom Web | builtin trusted-identity Web → trusted extension | task → cron → optional frontend hosting |
| `LOCAL_CONFIGURED_AUTH` | 忽略 caller custom Web；local-only contribution 校验 config、构造 auth/plugin，并在 protected scope 注册 builtin Web 与 trusted extension | task → cron → optional frontend hosting |

任一 Web/auth/task/cron/frontend failure 必须终止 composition；只有 workbench unavailable 可以按 local adapter 的既有契约降级。

cron deployment selection 由 frozen config 一次投影为 app-private `DISABLED | LOCAL | REMOTE`；`DISABLED` 只是现有未启用/缺省状态的规范化，不是 public config token。平台基础设施只选择 cron task gateway，执行能力只产生 disabled/enabled typed cron capability，runtime/channel 才消费分支专属 prerequisite：

- `DISABLED` 不创建 cron capability 或 runtime；未选中分支输入被忽略。
- `LOCAL` 先要求 selected cron task gateway，再在 scheduler 构造点要求 scheduler factory。
- `REMOTE` 先要求 selected cron task gateway，再依次在 verifier/route 构造点要求 callback credential reference 和 callback registration。

错误优先级固定为 gateway before LOCAL/REMOTE runtime prerequisite，REMOTE credential before registration；既有 `CRON_TASK_GATEWAY_UNAVAILABLE`、`CRON_TASK_SCHEDULER_FACTORY_REQUIRED`、`CRON_CALLBACK_CREDENTIAL_REQUIRED` 和 `CRON_CALLBACK_REGISTRATION_REQUIRED` 的 safe error shape 保持不变。root 或 startup contribution 不得调用独立 cron preflight；`cronTriggerCallbackRegistration.ready()` 仍只属于 `app.start()` lifecycle gate。

### Deferred binding 与 composition rollback

真正无法通过阶段重排消除的循环只有五类：lifecycle hook invocation、workflow capability invocation、workflow runtime adapters、runtime subagent execution 和 background runtime timeline。`createCompositionDeferredBindings()` 只为这五类提供 typed proxy/lookup 与单次 bind；任一 target 的重复绑定必须 fail closed。未绑定时，lifecycle hook invocation 保持 `{ status: "CONTINUE", boundary }` neutral result，workflow capability/runtime adapters/subagent lookup 返回 `undefined` 并由实际必需消费者 fail closed，background runtime timeline 的 event emission 直接返回 typed failure。普通依赖必须通过有序参数传递，不得加入 holder、DI container、service locator 或动态 registry。

当次唯一 sync/async runner 是 `CompositionFailureScope` 的唯一 owner。scope 只保存 `{ stage, cleanup }`，覆盖已由本次 composition 创建，或按现有成功路径 contract 已被 runner 接受为 app-owned、但尚未 commit 给最终 lifecycle 的 closable resource。规则如下：

- 模块在构造中途清理尚未交接的本阶段资源；完整 result 返回后，root 立即登记具名 cleanup。
- runner 接受前的 host 构造失败由 host 清理；runner 接受 app-owned injected handle 后，host 不得在 catch 中重复关闭。无 app close contract 的 model、provider/factory、metrics registry、test sink 和 contribution 保持 caller-owned。
- rollback 按登记逆序且至多一次执行。sync rollback 只 best-effort 触发并处理 thenable rejection；async rollback 按同一逆序等待 settle。cleanup failure 不得覆盖原始 safe failure，也不得泄漏 config、credential、路径或 raw provider error。
- scope 只能在 channel/cron registration、app lifecycle 构造和 optional frontend finalization 全部成功后 commit。commit 后 scope 放弃 cleanup authority，正常关闭完全交给 app lifecycle。

`composeAppLifecycle(...)` 使用 exhaustive ownership map 对每个 input 分类；新增未分类字段必须在类型或 architecture validation 中失败。具体字段、模块 entry、host surface 和 37 字段 test projection 由 `openspec/designs/modules/agent-app.md` 主承载。

验证必须覆盖：唯一 config/plugin snapshot、sync/async 等价、八层顺序、完整 host surface、37 字段映射、profile/route precedence、cron 三分支与错误顺序、五类 binding 的 neutral/negative cases、failure cleanup reverse/once/no-double-close、lifecycle input completeness、public app/host facts 隔离，以及 owner package 不反向依赖 `agent-app`。主要门禁为 app composition targeted tests、local runtime package/fullstack packaging tests、architecture negative fixtures、`npx tsc -b --pretty false`、`npm test`、`npm run test:contract` 和 `npm run lint:architecture`。

## Local Auth 范围

`agent-channel-web-auth-local` 是本地运行包的 optional local Web auth adapter boundary，仅在 localhost-only local configured authentication 产品入口中由 `agent-app` 显式 import。

当前基线定义 localhost local product entrypoint 的 login/logout、signed HttpOnly cookie、fixed TTL、logout invalidation、service restart invalidation、unauthenticated challenge 和 SSE/WS cookie auth。local auth 不访问 request lifecycle、session/message、memory、attachment、RequestRun 或 capability durable facts。remote/IAM 产品入口不得 import、register、bundle 或暴露 `agent-channel-web-auth-local`。

## 可观测和日志

`agent-observability` 提供 structured logging helper、AsyncLocalStorage request/run context、safe error shape、redaction policy 和 OTel integration wrapper。业务 package 不直接依赖散落的 `console.*` 作为诊断入口，也不暴露 tracing/metrics SDK 类型。

日志、trace、metric 的安全要求：

- Metrics labels 不包含 `requestId`、`runId`、`sessionId`、prompt、payload、content、delta、local path、raw provider error 或 secret。
- Trace/log payload 使用 safe summary 和 stable refs。
- Web request log 与 runtime request/run context 可以关联。

## 架构需求满足关系

本节说明 `openspec/specs/ts-backend-architecture/spec.md` 中的 requirement 为什么属于架构需求，以及由哪些设计元素承载。具体 API、事件 payload、状态机、数据表和业务能力仍由后续 capability change 定义。

| 架构需求 | 架构元素 | 关键决策 | 验证入口 |
|---|---|---|---|
| 顶层架构驱动、架构驱动覆盖 | 架构需求与关键场景、架构原则、质量属性设计 | 只固化影响后续实现正确性的边界，不提前定义业务行为。 | OpenSpec strict、README/设计审查 |
| 双语交互架构边界 | `agent-common` language/locale value、context/model/capability/stream metadata | language/locale 是 contract 字段，不靠 prompt 或 UI 隐式传递。 | schema/contract smoke tests |
| 根 Workspace 后端范围、规格基线来源 | 根 workspace、`openspec/`、`packages/`、`tests/` | TS 后端以仓库根为后端 workspace；浏览器 UI 不进入后端 build。 | build、architecture lint |
| 服务运行时模型、异步执行边界 | Node.js LTS、Promise/AsyncIterable、AbortSignal、AsyncLocalStorage | 所有慢边界 async 化，取消、requestId、runId 和 trace/log 上下文由 runtime/observability 协作贯穿。 | async boundary tests |
| 事件流架构边界 | runtime canonical timeline、channel projection | 执行组件发布事实，channel 只投影，不拥有领域事件。 | event ownership tests |
| Package 拓扑、Package 边界强制、整模块替换边界 | responsibility packages、package exports、dependency-cruiser、`agent-app` composition root | 边界通过 package 和 public exports 强制；替换通过显式 composition。 | package export tests、negative dependency fixtures |
| Identity 和 Owner Scope 边界 | channel/auth、runtime command、gateway owner-scoped operations、audit refs | owner scope 来自当前 identity，不信任请求体、模型输出或 capability 参数。 | owner-scope contract tests、safe error tests |
| Attachment Runtime 边界 | `agent-attachment-runtime`、attachment refs、availability check、cleanup policy | 附件可信处理独立成包，避免散落到 channel/runtime/context。 | attachment boundary smoke tests |
| Memory Lifecycle 边界 | `agent-memory`、gateway memory ports、Context Engine memory consumption | 记忆生命周期独立于上下文组装，不参与 terminal commit 必要写入。 | memory boundary smoke tests |
| Capability 分类和 Agent capability 边界、Capability 生命周期边界 | `agent-capability`、catalog、discovery、SkillTool、ToolExecutor、Agent capability executor | Capability 是上位概念；Tool/Skill/Agent 不形成三套运行时。 | capability contract smoke tests |
| Agent 内部 Request Routing 边界 | `agent-core` routing policy、AgentAssembly、runtime lifecycle boundary | request routing 属于 Agent 内部 policy，runtime 不做业务语义路由。 | routing boundary smoke tests |
| Model provider adapter boundary | `agent-model`、provider stream normalization、ModelGateway 调用边界 | provider SDK/ModelGateway 细节不泄漏到 core/runtime/contracts。 | model contract tests、dependency lint |
| 模块间数据流说明 | 模块间数据流图、动态执行图、诊断信号图 | 用数据流审查模块交互，不定义 route/payload/schema。 | design review、OpenSpec strict |
| Runtime Kernel Ownership | `agent-runtime`、session facade、dispatcher、same-session active-run guard、checkpoint、terminal commit、hooks | 请求生命周期、hook lifecycle 和终态可见性统一由 runtime 拥有。 | runtime characterization tests |
| 本地与 PaaS 运行形态边界 | local/remote gateway adapters、shared RequestRun/checkpoint/timeline/lock/version | 首版本地 release 可只交付本地单实例；PaaS 多实例后续启用时正确性不依赖 sticky session。 | PaaS boundary smoke tests |
| 会话状态边界 | `agent-session`、gateway owner-scoped state access、runtime facts | session/message/read model 和 active/pending/handoff facts 通过 owner-scoped contract 访问。 | session state boundary tests |
| Human Interaction 统一边界 | runtime-owned pending input | 澄清、确认、授权、选择、人工接管共用一个 pending boundary。 | pending input smoke tests |
| Bounded Parallel Execution 扩展边界 | runtime scheduler、parallel budget、dependency graph、deterministic aggregation | 首版可保持单个 RequestRun 内串行；后续并行必须有预算、依赖、取消、checkpoint 和聚合边界。 | parallel boundary tests |
| Sandbox Execution 边界 | sandbox gateway contract、remote platform gateway PaaS sandbox adapter | TS 后端控制和审计，PaaS 提供隔离；不新增 `agent-sandbox` package。 | sandbox gateway contract tests |
| Adapter Ownership、结构化日志边界 | adapter packages、`agent-observability` integration helpers、Pino/OTel/metrics | 外部库和诊断 sink 留在 adapter/integration 内，不泄漏到 core/contracts。 | architecture lint、log redaction tests |
| 架构验证门禁 | build/test/contract/architecture scripts、negative fixtures | 架构完成必须可重复验证。 | `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` |

## 质量属性

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 电信网络智能体可能接触网络拓扑、告警、日志、客户系统凭据和用户画像；所有不可信边界 runtime schema validation；identity 从 channel/auth 解析并贯穿 runtime、session、attachment、memory、capability、gateway 和 audit；附件只有经过 `agent-attachment-runtime` 可信处理后才能进入请求；gateway owner scope 由 gateway contract 和 adapter 共同约束；adapter 输出 presentation-safe errors；动态可执行内容必须走 sandbox gateway boundary，控制文件系统、网络、环境变量、凭据、资源和安全错误。 | schema tests、Web contract smoke tests、owner-scope fixtures、attachment boundary tests、sandbox gateway contract tests、secret scan、safe error tests |
| 性能/容量 | 电信任务可能涉及长时间诊断、多源检索和持续流式输出；Fastify + compiled schema 降低 route 开销；Agent、Model、Capability、Gateway 边界采用 async contracts；runtime scheduler 显式并发和 backpressure；单个 RequestRun 首版串行执行 read tool loop，后续并行必须在预算、依赖图、取消和聚合约束下启用；SQLite 短事务集中在 gateway adapter。 | architecture tests、async boundary tests、tool loop limit tests、parallel boundary tests、后续 load/benchmark tests |
| 可靠性/恢复 | 电信运维场景不能把请求终态、能力副作用和历史可见性做成 best-effort；runtime kernel owns lifecycle、checkpoint、terminal commit；本地运行态承诺单实例进程重启恢复；PaaS 运行态后续启用时必须具备共享状态、lock/lease、version、非粘性请求和故障接续边界；Tool 不默认幂等，恢复必须依赖显式 idempotency contract 或安全失败；memory lifecycle 不参与 terminal commit 必要写入，避免自学习失败破坏主请求。 | runtime characterization tests、gateway idempotency tests、PaaS boundary tests、memory lifecycle smoke tests |
| 可维护性 | 开发框架需要长期承载 Agent、Model provider、Capability provider、gateway 和 channel 扩展；package topology 以 responsibility 分层；package exports + dependency-cruiser 阻止边界腐化；composition 集中在 app；附件和记忆因独立生命周期成包，上下文选择策略并入 `agent-context-engine`，避免把仅服务上下文装配的策略再拆出额外架构边界；实现遵循局部童子军原则，新增代码必须被产品路径、测试路径或 OpenSpec contract 使用，本次改动产生的 dead code、未使用 import、临时 fixture、debug logging 和重复实现必须在完成前清理；Pino structured logs 提供稳定诊断入口，避免散落的 console 输出。 | `npm run lint:architecture`、package export tests、log helper tests、unused/dead-code scan、code review |
| 可测试性 | 二次开发能力必须可在无真实外部依赖下验证；schema validator、Fastify inject、fake gateway、test-kit fixtures 支持无端口、无真实外部依赖测试；测试优先断言黑盒规格、边界、安全属性和可观察结果，只有 architecture/source boundary 才允许 source-level assertion。 | Vitest unit/contract tests、test-kit fixtures、architecture negative fixtures |
| 审计/可追溯性 | 电信级诊断需要定位请求、模型、工具、gateway、事件事实来源、语言上下文和终态提交路径，同时避免暴露敏感内容；业务标识字段、Pino structured logs、OTel spans、low-cardinality metrics 和 safe trace summary 分工明确。 | observability tests、event ownership tests、log redaction tests、metric tag policy tests、trace smoke tests |

## 文档主承载

- 行为契约：`openspec/specs/ts-backend-architecture/spec.md`
- 跨模块架构：`openspec/designs/architecture/ts-backend-architecture.md`
- 模块职责：`openspec/designs/modules/*.md`
- 技术栈取舍：`openspec/designs/adr/0001-ts-backend-stack.md`
- 导航：`openspec/designs/spec-to-design-map.md`

最小 Web submit/history、SSE/WS stream transport、runtime lifecycle、same-session lane、request cancel/retry、local runtime recovery、gateway persistence 原则和 RequestRun 领域不变量已经由稳定 specs 与 `architecture/runtime-boundaries.md`、`architecture/core-contracts.md`、`architecture/request-run.md`、`architecture/runtime-recovery.md`、`architecture/stream-projection.md` 和 `architecture/web-stream-transports.md` 建立主承载。长期记忆能力组由 `architecture/memory.md` 建立主承载。尚未进入稳定基线的 API、event payload、状态机或数据模型必须由后续 OpenSpec change 先选择唯一主承载文档再实现。

## 风险与取舍

- [行为过早固化] 当前稳定基线只固化架构边界；用户可见 contract 通过后续 capability 定义。
- [框架泄漏] Fastify 只在 Web adapter 和 app composition 中出现；contract package 禁止依赖 Fastify。
- [类型误判安全] 编译期 TS 类型不能代替 runtime schema validation。
- [双语行为过早固化] 当前稳定基线只定义 language/locale 的架构位置，不定义提示词模板、术语表或语言检测算法。
- [事件协议过早固化] 当前稳定基线只定义事件流 ownership 和 projection 边界，不定义事件类型全集或 payload schema。
- [同步 SQLite 阻塞] SQLite access 限制在 local gateway 短事务；容量不足时在 adapter 内部优化。
- [日志泄漏敏感内容] 日志统一通过 structured logging helper、redaction policy 和测试 fixture 约束，不允许直接散落 `console.*`。
- [动态执行逃逸] shell、python、脚本和模型生成代码只能通过 sandbox gateway contract 执行，architecture gate 禁止 capability、hook、policy 直接绕过 sandbox gateway 或直接依赖 PaaS sandbox SDK。
- [并行导致不可恢复] 后续若启用并行执行，必须保留 dependency graph、checkpoint、idempotency、cancellation 和 deterministic aggregation 边界。
- [路由变成全局业务规则] request routing 位于 Agent 内部 policy，runtime 不承担业务语义路由。
- [package 数量膨胀] 第一阶段采用聚合的 `agent-contracts` 和 `agent-capability`；只有附件可信处理和长期记忆这类已有独立 lifecycle/安全 owner 的职责单独成包，而上下文选择策略维持在 Context Engine 职责内。

## 发布与切换计划

当前稳定基线建立 NextAgent TS 后端架构骨架、本地单实例/PaaS 多实例两种部署形态边界，以及 `backend-only` / `with-frontend` 两种 fullstack serving profile。仓库根 `npm run dev:fullstack` 只是开发阶段 convenience entry，不作为候选运行包 evidence、正式打包入口、release qualification 输入或 release verdict 来源。完整本地运行包打包/升级、端口、配置项、数据目录、流量切换、历史数据处理、接口兼容性、验证和回滚方式，必须通过后续 OpenSpec change 定义。

## 验证门禁

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run test:contract`
- `openspec validate --all --strict`

## Capability 失败处置跨模块路径

Capability 从可信 routing/assembly 经 catalog、governed invocation、Agent/Workflow consumer、runtime durability 到 channel/Web projection 的完整 owner 链，统一由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 展开。该路径不得改变本页定义的 package 方向：retry 只在 `agent-capability`，Agent budget/finalizing 只在 `agent-core`，checkpoint/terminal 只在 `agent-runtime`，provider mapping 只在 `agent-model`，Web 只投影。
