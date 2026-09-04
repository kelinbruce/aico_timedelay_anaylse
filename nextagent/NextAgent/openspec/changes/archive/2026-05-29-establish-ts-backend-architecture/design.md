## 背景和现状（Context）

根 `openspec/` 是 NextAgent TS 后端的规格源。当前阶段尚未建立 TS 后端稳定行为基线；本 change 负责建立第一条架构基线，为后续 Web API、runtime lifecycle、session state、context assembly、capability、platform gateway、observability 等能力规格提供工程和验证边界。

当前仓库根目录尚未初始化为 TS 后端 workspace。本 change 的设计对象是 TS 后端第一阶段架构骨架，不声明完整业务能力已经实现。第一阶段成功标准是：根 workspace、首批 package、schema-first 边界、runtime kernel skeleton、adapter skeleton、composition root 和架构验证命令都可以独立运行并被测试。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 建立仓库根目录作为 NextAgent TS 后端 workspace。
- 定义 TS 后端服务端技术栈和第一阶段 package topology。
- 用轻量 4+1 视图说明顶层架构，便于审查职责划分、运行时流程、装配边界和关键场景。
- 明确 schema-first、bilingual context boundary、async execution boundary、stream event ownership、adapter-contained、runtime-owned lifecycle、package-level replacement、structured logging、explicit composition 的架构原则。
- 明确 human interaction、agent-internal request routing、bounded parallelism 和 sandbox execution 的架构边界。
- 建立编译、测试、contract/schema smoke test、dependency boundary check 的验证门禁。
- 让后续 capability 能在同一 TS 后端架构上逐步定义和实现用户可见行为。

**非目标：**

- 不实现完整 Web API、Agent loop、SQLite schema、远端平台能力或前端行为。
- 除 localhost-only local configured authentication 的最小 Web auth adapter boundary 外，不新增用户可见产品行为、领域对象、业务 Web route、具体 auth endpoint、cookie/ticket 格式、stream event type、具体 runtime state machine、runtime state storage schema 或 gateway port。
- 不规定具体 PaaS 产品拓扑、部署流量切换、生产发布策略、存量数据导入或端口约定；但本次架构切片必须保留本地运行和 PaaS 多实例部署两种交付形态所需的架构边界，首版本地 release 不要求交付完整 PaaS 多实例 runtime。
- 不定义动态插件加载、运行时热插拔、远端加载实现包或第三方包分发协议。

## OpenSpec 规范遵从（OpenSpec Compliance）

本 change 按 OpenSpec 的增量变更职责划分组织：

- `proposal.md` 只说明为什么需要建立 TS 后端架构基线、影响范围、capability 变化和归档前基线提升计划。
- `specs/ts-backend-architecture/spec.md` 只承载外部可验证的架构契约；每个 requirement 使用 `MUST`，并包含可验证 `Scenario`。
- `design.md` 承载唯一选定的架构路径、4+1 视图、技术栈取舍、质量属性审视、文档主承载关系和风险取舍。
- `tasks.md` 只承载可执行实现任务和验证任务，不把质量属性写成泛化检查清单。
- 归档前再把长期有效内容提炼到 `openspec/specs/`、`openspec/designs/`、`openspec/overview.md` 和 `openspec/designs/spec-to-design-map.md`；实施阶段不直接修改长期基线文档。
- active change 阶段不新增独立架构设计文档，避免规范性事实分散；`design.md` 是本 change 的架构设计主文档。归档时再提炼为长期 `openspec/designs/architecture/ts-backend-architecture.md`。

规范性事实只有一个主承载：

- 行为契约主承载：`specs/ts-backend-architecture/spec.md`。
- 跨模块架构主承载：归档后的 `openspec/designs/architecture/ts-backend-architecture.md`。
- 模块职责主承载：归档后的 `openspec/designs/modules/*.md`。
- 技术栈取舍主承载：归档后的 `openspec/designs/adr/0001-ts-backend-stack.md`。
- API、event payload、runtime state machine、runtime state storage schema、gateway data model、领域对象和状态机不在本 change 建立主文档，后续 capability change 定义时再建立。

## 架构需求与关键场景（Architecture Requirements / Key Scenarios）

NextAgent TS 后端的黑盒问题域是电信网络智能体开发框架。顶层诉求是四类：

| 顶层诉求 | 架构推导 |
|---|---|
| 面向电信网络智能体。 | context、model、capability、gateway、assembly 边界必须能承载电信网络任务、领域术语、网络能力治理、运维诊断和客户系统集成；中英文交互必须保留 language/locale 和电信术语一致性所需的架构位置；具体网络域、工具分级、审批、回滚、术语表和提示词策略由后续能力定义。这意味着：框架不是通用聊天机器人，而是专门为"诊断基站告警""分析网络拓扑变更""执行配置审批流程"这类电信任务设计的——边界划分必须从一开始就考虑这些任务的可靠性、安全性和术语精度要求。 |
| 服务两类用户。 | 直接使用者需要开箱即用、流式看到执行进展和结果；开发者和集成者需要二次开发边界。`agent-app` 提供默认装配；`agent-contracts`、`agent-model`、adapter packages、`agent-capability` 和 `agent-test-kit` 提供扩展和验证面；整模块替换必须通过 public contract 进入。 |
| 支持多入口接入。 | 第一阶段定义 channel contract 和 adapter boundary，并创建 `agent-channel-web` 的 Web channel skeleton，用于支持 Web 客户端的 LUI 访问；本阶段只有 `agent-channel-web` 一个实现。runtime command、canonical event boundary、identity propagation、session ownership 和 stream facts 不得写成 Web-only；IM、A2A、AgentLink、事件中心等入口由后续 change 定义具体协议和实现。 |
| 满足电信级质量属性。 | 安全、性能/容量、可靠性/恢复、审计/可追溯、可诊断、可维护、可测试进入 package 边界、runtime ownership、async execution boundary、event stream boundary、observability 和 verification gate。本地运行包是首版本地 release 的交付形态；PaaS 多实例服务部署作为后续交付形态保留架构边界。本地只承诺单实例，PaaS 部署启用时必须通过共享状态、锁/版本和故障接续保证多实例正确性。电信场景对质量的要求远高于一般互联网应用——一个正在处理全网告警的诊断请求不能因为单台服务器重启而丢失执行结果，一个模型生成的配置变更脚本不能在没有审批的情况下直接推送到网络设备。 |

第一阶段关键场景：

- 直接使用者启动默认后端装配，无需编写 runtime glue code。
- Web/LUI 请求通过 channel adapter 进入 runtime command boundary，channel 不拥有请求生命周期。
- 中文或英文请求在 request、context assembly、model/prompt selection、capability metadata、streamed response 和 final result 边界上保留 normalized language/locale。
- 长任务通过 async Agent、Model、Capability、Gateway contracts、bounded scheduler、same-session lane、`AbortSignal` cancellation 和 terminal commit boundary 保持可控。Tool、Skill、Agent capability 都作为 Capability 类型遵守同一执行边界。
- Agent、Model、Capability 等执行组件发布事实事件；runtime 维护 canonical timeline；Web channel 只把事件投影为可流式渲染的 transport envelope。
- PaaS 多实例部署后续启用时，任一实例故障后，其他实例必须能基于共享 RequestRun、checkpoint、pending input、timeline、lock/lease、version 和 terminal commit state 接续或安全终止请求；本地运行态只提供单实例进程重启恢复。
- 模型、hook、policy、capability 或 runtime 需要人参与时，通过统一 human interaction boundary 挂起为 pending input；澄清、确认、授权、选择和人工接管不创建新的 root request。
- Agent 在收到 runtime 调用后，先通过 Agent 内部 routing policy 决定走确定性流程、模型驱动 loop、澄清、拒绝或人工接管；runtime 不做业务语义路由。
- 用户或上游入口提供的处理约束仍进入 Agent 内部 routing policy；Agent 先按 assembly、capability discovery、权限、来源、版本和可用条件校验，再选择执行路径或返回可解释拒绝/降级。
- 非内置 Skill source 进入统一 capability source/catalog 生命周期，不形成独立 Skill 执行机制。
- 会话状态通过 session/gateway 边界承载 session/message/read model、history consistency 和 owner scope；本架构切片不定义会话保留期、过期或自动清理能力。
- 单个 RequestRun 首版可以保持串行执行；后续若启用 Tool、Agent capability、检索和确定性子流程并行，必须受并发预算、依赖图、取消、超时和结果聚合约束。
- shell、python、脚本和模型生成代码等动态可执行内容只能通过 sandbox execution boundary 执行。
- 开发者通过 public contract 添加 adapter/provider 替换包，并由 `agent-app` 显式装配。
- 运维人员通过业务标识、structured logs、traces 和低基数 metrics 定位请求、gateway、能力调用和终态提交路径。

## 术语约定（Terminology）

- `Capability` 是能力的总称，用于描述可以被 Agent 发现、选择、调用和审计的可执行能力。
- `Tool` 是 Capability 的一种，通常表示一次明确的外部动作、查询或本地操作。
- `Skill` 是 Capability 的一种，通常表示可复用的任务能力，内部可以编排模型调用、工具调用或其他能力调用。
- `Agent` 是 Capability 的一种，表示由当前 Agent 调用的另一个 Agent。它可以是本地 SubAgent，也可以是远端 Agent。架构上它不拥有独立的请求生命周期；它通过 capability boundary 接入，由 runtime 继续负责 cancellation、timeline、terminal commit 和审计边界。
- `agent-model` 是模型提供方适配模块。它负责把不同模型 provider 的差异归一化为 NextAgent 的模型调用、流式输出、tool-use 片段和错误结果；具体 provider SDK、开源库或平台 ModelGateway 调用只能放在该模块或 provider adapter 内部。这里的 ModelGateway 表示 PaaS 平台提供的推理网关，只有在配置选择推理网关时才由 `agent-model` 调用。

## 架构原则（Architecture Principles）

本架构只固化会影响后续实现正确性的原则，不把具体 API、状态机、数据库表或业务能力提前写死。

| 原则 | 含义 | 主要保护的诉求 |
|---|---|---|
| Runtime owns lifecycle | 请求接受、调度、取消、checkpoint、terminal commit 和 canonical timeline 由 runtime 统一拥有。如果请求的生命周期分散在多个模块中，任何一个模块的故障都可能让请求处于不确定状态，这在电信运维中不可接受——一个正在处理网络故障诊断的请求不能因为某个模块的bug而无声消失。 | 可靠性/恢复、流式一致性、可审计 |
| Schema-first at trust boundaries | HTTP、stream、config、gateway、persisted JSON、capability input/output 都必须经过 runtime schema validation。来自网络设备的请求可能格式错误或恶意构造，如果不在边界处校验拦截,后续所有处理都建立在不可信数据上,这在电信场景中不可接受。 | 安全、可维护性、可测试性 |
| Adapter contains libraries | Fastify、SQLite、fetch client、provider SDK、PaaS SDK、文件处理库和 OTel SDK 不进入 contracts 或 core packages。这样做的目的是让外部技术栈的升级或替换不影响核心业务逻辑；比如将来从 Fastify 切换到另一个 Web 框架，只需要替换适配层，不需要修改任何业务模块。 | 可维护性、整模块替换 |
| Capability is the executable umbrella | Tool、Skill、Agent 都是 Capability 类型，通过统一 lifecycle 发现、披露、调用和审计。如果不统一，就会出现"工具是一种执行体系、技能是另一种执行体系、委托智能体又是第三种执行体系"的混乱局面，开发者需要学三套不同的调用方式，运维需要查三套不同的审计记录。 | 二次开发、能力治理、可恢复 |
| Context assembly is not memory lifecycle | Context Engine 负责上下文选择和渲染；长期记忆、自学习和记忆生命周期由 `agent-memory` 承载。如果把记忆塞进上下文引擎，那么记忆的自学习失败会破坏主请求的终态提交——一个正在诊断网络故障的请求不能因为后台记忆整理出错而丢失执行结果。 | KISS、职责单一、可维护性 |
| Context Engine owns context selection policy | Context Engine 负责 query policy、window selection、compaction 和 prompt shaping 等上下文选择策略。 | KISS、职责单一、可维护性 |
| Human interaction is one pending boundary | 澄清、确认、授权、选择和人工接管都进入 runtime-owned pending input。无论发起方是模型、钩子还是策略，用户看到的都是同一个"需要您确认"的提示，而不是五种不同形式的确认弹窗；这在电信运维场景中尤为重要——一个高风险操作无论由哪个组件触发，都需要同一套审批流程。 | 用户体验、恢复、审计 |
| Dynamic execution goes through gateway sandbox | 动态可执行内容只能通过 sandbox gateway contract，PaaS sandbox SDK 不泄漏到 core/runtime/capability。电信网络智能体可能生成并执行 shell 命令或 Python 脚本来操作网络设备，这些动态内容必须在受控环境中运行——不能让一个模型生成的脚本直接拥有宿主机的完整权限，否则一个错误的配置命令就可能影响整张网络。 | 安全、平台适配 |
| Explicit composition over hidden DI | `agent-app` 是唯一 composition root，通过 public contracts 和 factory 显式装配。这样做的好处是：系统启动时的装配过程完全可见、可审查，不会出现"某个全局单例在不知不觉中被注入"的情况；对于开发者来说，替换一个模块只需要修改装配入口，不需要追踪隐藏的依赖关系。 | 可测试性、整模块替换 |

## 关键方案和设计决策（Key Solutions / Decisions）

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
| Request routing | Agent 内部 policy | 路由是 Agent 处理请求的一部分，也是开发者可定制点；runtime 不做业务语义路由。实际含义是：用户说"诊断这个基站告警"时，由智能体自己决定是走预设的诊断流程还是让模型自由分析，而不是由后端的某个路由规则预先判断"告警类请求必须走流程A"。这让开发者可以针对不同的网络场景定制不同的处理策略，而不需要修改后端核心代码。 | channel/runtime 前置路由 |
| Multi-channel | contract 支持，多实现后置，本次只实现 Web | 避免 Web-only 生命周期，同时控制首批实现范围。 | 同时实现 IM/A2A 等 channel |
| PaaS 多实例 | 共享状态、lock/lease、version、terminal commit、非粘性请求 | 满足服务部署和故障接续，不把正确性绑到单进程内存。 | sticky session 或 process-local lifecycle |

## 逻辑视图（Logical View）

TS 后端按职责划分逻辑组件，而不是按框架目录划分：

```text
agent-app
  -> agent-channel-web
  -> agent-channel-web-auth-local
  -> agent-runtime
  -> agent-core
  -> agent-context-engine
  -> agent-model
  -> agent-capability
  -> agent-session
  -> agent-attachment-runtime
  -> agent-memory
  -> agent-platform-gateway-local / agent-platform-gateway-remote
  -> agent-observability
  -> agent-contracts
  -> agent-common
```

核心职责（以下每个 package 只做自己职责范围内的事，不做其他 package 的职责；跨 package 交互只能通过 `agent-contracts` 中定义的 public contract，就像不同公司之间只通过合同约定的条款合作，而不是互相翻看对方的内部文件）：

- `agent-common`：shared ids、value objects、JSON value、language/locale value skeleton、SecretReference、safe error shape、基础 enum。
- `agent-contracts`：boundary schemas 和 public interfaces，通过 subpath exports 暴露 `runtime`、`channel`、`session`、`attachment`、`context`、`model`、`capability`、`core`、`gateway`、`observability`、`app` 等 contract namespace，并为后续 memory contract 保留 extension placeholder；subpath export 对应架构 owning module 的 public surface，不为 reserved alias 或概念分类单独建立 owning namespace；同时为 async execution、parallel execution、human interaction、timeline event、stream envelope、sandbox execution request 和 bilingual context metadata 保留骨架。
- `agent-runtime`：request admission、scheduler、same-session lane、cancellation、timeline publication、terminal commit boundary skeleton。
- `agent-session`：session/message read model skeleton、latest-request policy skeleton、history consistency 和 owner scope boundary skeleton。
- `agent-attachment-runtime`：request attachment validation、staging、metadata extraction boundary、attachment refs、availability check 和 cleanup policy skeleton；不定义具体 upload route 或文件解析实现。
- `agent-context-engine`：context assembly boundary skeleton；在该 package 内负责 query policy、window selection、compaction、prompt shaping 和 disclosure budget 等上下文选择策略；不定义具体 prompt 文本、retrieval ranking 或 memory lifecycle 行为。
- `agent-memory`：long-term memory、self-learning、memory lifecycle、long-term memory retrieval 和 memory prompt profile boundary skeleton；不直接拥有 request lifecycle、Web API 或 context window selection。
- `agent-core`：Agent orchestration skeleton，包含 Agent 内部 request routing policy 边界；不实现完整 loop 或具体路由规则。
- `agent-model`：model provider adapter boundary skeleton；负责模型 profile、请求归一化、stream normalization、tool-use 片段归一化、fallback 结果和 provider error safe mapping，不把 provider SDK 类型、平台 ModelGateway 细节或远端推理错误类型暴露给 core 或 contracts。
- `agent-channel-web`：Fastify route plugin、SSE/WS stream adapter、presentation-safe errors。
- `agent-channel-web-auth-local`：本地运行包的 local Web auth adapter boundary；作为可选 composition package 暴露 Web auth plugin/factory 占位，只在 localhost-only local configured authentication 产品入口中由 `agent-app` 显式 import；本 change 不定义具体 credential 校验、identity 解析协议、public gateway auth contract、endpoint、request/response payload、cookie/ticket 格式或签名规则，不访问 session、message、memory、attachment、RequestRun 或 capability durable facts。
- `agent-platform-gateway-local`：SQLite/Kysely adapter skeleton 和 schema versioning/update entrypoint。
- `agent-platform-gateway-remote`：fetch-compatible remote adapter skeleton、PaaS sandbox gateway adapter skeleton 和 failure normalization。
- `agent-capability`：capability registry/execution boundary skeleton；统一承载 Tool、Skill、Agent 等能力类型，后续可按 provider ownership 拆分。
- `agent-observability`：AsyncLocalStorage request/run context、Pino structured logging helper、OTel integration wrapper、metric tag policy、redaction policy。
- `agent-app`：config schema parsing、Agent definition/config directory loading boundary、adapter selection、dependency wiring、server factory。
- `agent-test-kit`：schema samples、fake gateway、architecture test helpers。

逻辑边界规则：

- Runtime owns lifecycle：request lifecycle、terminal commit、timeline event 和 latest-request policy 不分散到 channel、adapter 或 core。
- Bilingual context is explicit：language/locale 是 request、context assembly、model/prompt/capability metadata 的显式 contract 字段，不靠隐式 prompt 或 UI 状态传递。
- Async contracts at slow boundaries：Agent、Model、Capability、Gateway 等可能长时间运行或等待外部 IO 的边界使用 Promise、AsyncIterable、event publisher/subscriber 和 `AbortSignal`，不暴露同步阻塞 contract；Tool、Skill、Agent capability 按 Capability 类型继承该规则。
- Bounded parallelism is explicit：并行不是隐式 Promise fanout。首版可以保持单个 RequestRun 内串行；后续若启用 Agent、Tool、Agent capability、检索和确定性子流程并行，必须声明依赖、预算、取消、超时、事件排序和结果聚合边界。
- Event facts are owned by executors：执行事实由实际执行组件发布，runtime 维护 canonical timeline，channel 只做 transport projection。
- Gateway contracts use Records：gateway logical ports 只接收或返回 gateway-owned `*Record` persistence DTO/PO；session、runtime、attachment 等领域 DO 归各自业务边界，领域实现负责 DO/read model 与 Record 的映射，gateway adapter 只存取 Record 且不解释领域状态机。checkpoint、pending input、hook lifecycle 和 timeline 归 runtime；content/artifact/feedback 归 session；sandbox execution port 归 gateway。
- Human interaction is one boundary：澄清、确认、授权、选择和人工接管都进入 runtime-owned pending input，不因发起方是模型、hook、policy、capability 或 runtime 而分裂成多套状态。
- Identity and owner scope are explicit：当前身份由 channel/auth 边界解析，tenant/subject owner scope 进入 runtime command、session、attachment、memory、gateway、capability 和 audit 边界；请求体、模型输出或 capability 参数中的 owner 字段不能作为授权依据。
- Local auth adapter boundary is isolated：本地运行包保留 local Web authentication adapter boundary，但它不定义具体 endpoint、cookie/ticket 或认证协议，不拥有 request lifecycle、session state 或 identity storage；远端/IAM 运行形态不依赖该 package。
- Local auth is localhost-only：首版本地认证只面向本机浏览器访问；默认 loopback-only，不承诺 LAN/公网直接暴露；不提供页面修改认证配置、多用户管理、注册、密码修改、remember-me、refresh token 或服务端认证 session store。
- Local auth is build-graph optional：local configured authentication 产品入口显式 import/register `agent-channel-web-auth-local`；remote/IAM 产品入口不得 import/register、bundle 或暴露它；首阶段不为该边界引入运行时动态插件系统、热加载或隐藏 DI。
- Attachments are trusted by backend only after runtime validation：附件上传、暂存、可用性检查和 cleanup 是 `agent-attachment-runtime` 边界；`agent-channel-web` 只接收 transport input，`agent-runtime` 在 request acceptance 前校验 attachment refs，`agent-context-engine` 只消费安全 descriptor、摘要或 refs。
- Memory lifecycle is separate from context assembly：`agent-memory` 拥有长期记忆、自学习和记忆生命周期边界；后续 memory changes 启用长期记忆时，`agent-context-engine` 只按 query policy 和披露预算选择已授权长期记忆/上下文引用，不直接实现记忆抽取、promotion、decay 或 dreaming。
- Request routing belongs inside Agent：request routing 位于 Agent 接口之后，由 AgentAssembly 绑定的 routing policy 选择 deterministic flow、model-driven loop、clarify、reject 或 handoff；runtime 只负责生命周期和治理边界。
- Routing constraints are routed, not bypassed：用户或上游入口提供处理约束时，channel 和 runtime 仍只传递 typed request；Agent routing policy 必须校验 assembly、agent-scoped capability 清单、source/version、权限和可用条件后，再选择执行路径。
- Capability lifecycle is separated：registration、agent-scoped discovery、prompt/context disclosure、invocation、result consumption 和 audit/recovery 是不同架构阶段。Source/provider 只贡献 descriptor 或 provider factory；Agent 配置和可用条件决定最终清单；MCP Server 和 API-backed capability 都是 Tool 场景，而不是第二套 Tool 或 Skill HTTP 执行体系；执行必须经过 ToolExecutor、SkillTool 或 Agent capability executor；结果进入后续上下文、历史、审计或归档必须由 runtime/context 边界明确处理。
- Hook lifecycle is runtime-owned：Hook 阶段至少覆盖 request accept、planning、model invoke、model result、capability invoke、capability result、context compact 和 terminal event。Hook 可以作为扩展点参与治理、变换或观测，但不拥有 RequestRun、checkpoint、terminal commit 或 channel state。
- Session state ownership is explicit：session/message/read model、history consistency、active/pending/handoff facts 和 owner scope 通过 session/runtime/gateway contract 访问；本架构切片不定义会话保留期、过期或自动清理能力。
- Dynamic execution is sandboxed：shell、python、脚本、模型生成代码和其他动态可执行内容必须通过 sandbox gateway boundary；capability、hook 或 policy 不得直接绕过 platform gateway sandbox port 使用进程权限。PaaS 部署由 remote gateway 调用平台 sandbox，本地运行态提供明确的 unavailable/deny-by-default 或受限占位实现。
- Adapters contain libraries：Fastify、SQLite、fetch client、OpenTelemetry SDK、model SDK、capability runner 等外部库停留在 adapter 或 composition 边界。
- Contracts are explicit exports：跨 package 只通过 package `exports` 暴露 public contract，不使用 sibling `src` private import。
- Replacement is package-level：整模块替换以 package 为单位，通过 public contract、provider factory 和 `agent-app` 显式 composition 接入。

### Capability 生命周期视图（Capability Lifecycle View）

Capability 体系的黑盒目标是让 Agent 能稳定、可解释、可恢复地使用 Tool、Skill 和 Agent capability，而不是把所有来源和执行方式混在一个抽象里。

```text
source/provider
  -> registration/catalog
  -> agent-scoped discovery
  -> prompt/context disclosure
  -> invocation
  -> result consumption
  -> audit/recovery
```

生命周期边界：

- Registration：内置、插件、本地目录、Agent 配置、SkillHub、MCP Server、AgentRegistry、客户导入、运营商注入等来源只把 Tool、Skill、Agent descriptor 或 provider factory 带入 catalog；source/provider 不是 capability 本身。
- Discovery：`agent-app` 装配出的 Agent configuration、enabled sources、allowed kinds、routingTags、language/locale、availability、source priority 和 conflict policy 共同决定该 Agent 当前可用清单。客户导入、运营商注入或本地目录 Skill 只是 source 差异，不改变 discovery 模型。
- Prompt/context disclosure：Context Engine 根据预算和阶段把可用能力暴露给模型。Tool 进入 tool schema；Skill 先进入轻量 listing，完整内容通过 SkillTool 按需加载；Agent capability 进入可委托目标说明。
- Invocation：Tool 通过 ToolExecutor 执行；面向 NMS、网管、OSS/BSS 或客户既有 HTTP API 的集成也作为 API-backed Tool 场景进入同一 Tool boundary，由后续 capability change 定义具体 schema；Skill 通过唯一 SkillTool 进入 inline 或 fork 模式；Agent capability 通过 Agent capability executor 执行，本地 SubAgent 可按配置继承主 Agent 上下文，远端 Agent 通过 gateway 调用。
- Result consumption：能力结果必须明确进入后续模型上下文、会话历史、审计、归档或摘要的路径。inline Skill 可以影响主上下文；fork Skill 和 Agent capability 默认只回写状态、摘要、必要结果和 artifact refs。
- Audit/recovery：能力调用必须能关联 source、descriptor、selection reason、executor、gateway、run、checkpoint 和 terminal commit；重连、重试或服务重启不得导致重复副作用。

### 模块间数据流（Module Data Flow）

下图说明第一阶段架构骨架中各模块如何交互。它只表达责任和数据流方向，不定义具体 API route、event payload 或数据库表结构。

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
                                                |       |       |                                |---- reads long-term memory -> agent-memory ----> platform gateway
                                                |       |       |                                |---- reads capability disclosure -> agent-capability
                                                |       |       |                                |                                   |---- Tool / Skill / Agent descriptors
                                                |       |       |                                |---- returns model input / prompt skeleton
                                                |       |       |---- invokes model -----------> agent-model
                                                |       |       |                                |---- provider SDK / platform ModelGateway / remote inference
                                                |       |       |---- invokes capability ------> agent-capability
                                                |       |       |                                |---- Tool / Skill / Agent providers
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
- `agent-channel-web-auth-local` 只负责本地 Web auth adapter boundary，不定义具体登录/登出 endpoint、cookie/ticket 或认证协议，不拥有 request lifecycle、session/message state、identity storage 或 IAM integration；禁用 local configured authentication 时不得提供本地认证能力；它是可选 composition package，不是 `agent-channel-web` 的必需依赖；首版只保留 localhost-only local auth 的架构位置。
- `agent-runtime` 是请求生命周期和 canonical timeline 的唯一 owner。
- `agent-attachment-runtime` 是附件可信校验、暂存、可用性和 cleanup policy 的 owner；channel、runtime、context 和 session 不直接处理文件系统细节。
- `agent-memory` 是长期记忆、自学习和记忆生命周期的 owner；后续 memory changes 启用长期记忆时，Context Engine 只消费 owner-scoped、可披露的长期记忆引用或检索结果。
- `agent-core` 编排 Agent 内部 request routing 和 Agent loop；在 model-driven loop 内先请求 `agent-context-engine` 生成 context/prompt，其中包含 history、memory 和 capability disclosure，再调用 `agent-model`，并在需要时调用 `agent-capability`。
- request routing 是 Agent 内部 policy 扩展点，不是 channel 或 runtime 的前置规则。
- 用户或上游入口提供的处理约束是 Agent 内部 routing policy 的输入，不允许绕过 discovery、capability invocation、sandbox gateway、policy 或审计边界。
- `agent-capability` 用统一能力模型承载 Tool、Skill、Agent，不把它们拆成相互竞争的执行体系。
- 非内置 Skill source 只是来源差异，进入统一 catalog、priority/conflict、availability、SkillTool、sandbox gateway 和 audit 机制。
- session/message/read model、history consistency 和 owner scope 由 `agent-session` 与 platform gateway 边界负责，其他 package 不直接操作会话相关存储。
- identity owner scope 必须贯穿 runtime、session、attachment、memory、capability、gateway 和 audit；任何跨 owner 访问都不能依赖下游存储偶然过滤。
- `sandbox gateway contract` 是动态可执行内容的唯一执行边界；capability、hook、policy 不直接启动 shell、python 或脚本，不直接依赖 PaaS sandbox SDK。
- `platform gateway` 表示 local 或 remote gateway adapter；具体选择由 `agent-app` 装配。

## 开发视图（Development View）

仓库根目录采用标准 TS backend workspace 结构，`packages/` 使用 responsibility topology。第一阶段创建稳定责任包，后续只有在 ownership 或验证边界需要时才继续拆分：

```text
.
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.base.json
├── dependency-cruiser.config.*
├── src/
│   └── main.ts
├── tests/
│   ├── contract/
│   └── architecture/
└── packages/
    ├── agent-common/
    ├── agent-contracts/
    ├── agent-runtime/
    ├── agent-session/
    ├── agent-attachment-runtime/
    ├── agent-context-engine/
    ├── agent-memory/
    ├── agent-core/
    ├── agent-model/
    ├── agent-channel-web/
    ├── agent-channel-web-auth-local/
    ├── agent-platform-gateway-local/
    ├── agent-platform-gateway-remote/
    ├── agent-capability/
    ├── agent-observability/
    ├── agent-app/
    └── agent-test-kit/
```

Npm package names 使用 `@nextagent/<directory-name>`，例如 `@nextagent/agent-runtime` 和 `@nextagent/agent-contracts`。

Dependency rules 由 dependency-cruiser 强制：

- `agent-common` 不导入任何 NextAgent package。
- `agent-contracts` 只导入 `agent-common` 和 contract definition 所需的 schema/runtime validation libraries。
- `agent-contracts` 不导入 Fastify、SQLite、Kysely、OpenTelemetry SDK、model SDKs、gateway adapters、PaaS sandbox SDK、runtime implementation、channel implementation 或 app composition。
- Domain packages 依赖 `agent-common` 和 `agent-contracts`；不导入 transport framework、persistence driver、remote client 或 composition packages。
- `agent-runtime` 依赖 contracts、session、attachment、core/context/capability boundaries、gateway contracts 和 observability integration helpers；不导入 Web channel、app composition 或 tracing/metrics SDK 类型。
- `agent-attachment-runtime` 依赖 contracts、common、gateway contract 和 observability integration helpers；不导入 Web channel、runtime implementation、file upload framework、app composition 或 tracing/metrics SDK 类型。
- `agent-context-engine` 可以依赖 `agent-memory` public boundary，并在 package 内实现 query policy、window selection、compaction 和 prompt shaping 职责；这些职责当前不单独提升为独立架构边界。
- `agent-memory` 依赖 contracts、common、gateway contract 和 observability integration helpers；不直接导入 Web channel、runtime implementation、context-engine private paths、model provider SDK、app composition 或 tracing/metrics SDK 类型。
- `agent-core` 可以依赖 context、model、capability 和 gateway public contracts 或 service boundary；不导入 provider SDK、gateway adapter、PaaS sandbox SDK、Web channel 或 app composition。
- `agent-model` 依赖 contracts、common、gateway contract 和 observability integration helpers；provider SDK、开源模型库或平台 ModelGateway 调用只能留在 `agent-model` 内部或后续 model provider adapter package 内，不泄漏到 contracts、core、runtime 或 context。
- `agent-channel-web` 依赖 contracts、common、runtime/service boundary、attachment runtime 和 observability integration helpers；Fastify route/plugin、SSE 和 WebSocket-compatible transport 细节不得泄漏到 runtime、core、session、context、capability 或 contracts。
- `agent-channel-web-auth-local` 只依赖 adapter-local Web framework types，可在 adapter 内部使用 Fastify plugin 机制并通过 package exports 暴露 Web auth plugin/factory 占位；不得在本 change 定义具体 route、payload、cookie/ticket、credential 校验、identity 解析协议、public gateway auth contract 或认证协议；不得导入 contracts/gateway、runtime、session、core、context、capability、attachment runtime、memory、gateway adapter private paths、`agent-channel-web` private paths 或 app composition。
- `agent-platform-gateway-remote` 可以在 adapter 内部对接 PaaS sandbox SDK 或平台 API；具体隔离实现、OS isolation、container/runtime API 或 PaaS sandbox SDK 不泄漏到 contracts、core、runtime、capability 或 model。
- Adapters 依赖 contracts 和 domain/runtime services；它们把外部库行为转换为 typed NextAgent contracts。
- `agent-app` 可以导入所有 package，并且是唯一装配具体实现的位置。
- Cross-package import 必须使用 package name 和 public `exports`；private path import 触发 architecture lint 失败。

整模块替换边界：

- 可替换对象必须是 adapter/provider responsibility，例如 gateway adapter、channel adapter、capability provider、model/provider adapter、observability sink 或后续 change 定义的同类边界。Sandbox 实现随 platform gateway adapter 替换，不作为第一阶段独立 package。
- 替换 package 只依赖 `agent-common`、`agent-contracts` 和自身职责所需的 adapter-local libraries。
- 替换 package 通过 package `exports` 暴露 provider factory 或 adapter factory。
- `agent-app` 通过显式 composition/config 选择和装配替换 package。
- 可选 composition package 必须由对应产品入口显式 import/register；其他产品入口不得通过隐藏 DI、全局副作用或宽泛 barrel import 意外打包该 package。
- 替换 package 必须通过 contract tests、schema tests、architecture lint 和 test-kit fixtures。
- 替换 package 不得依赖现有实现 package 的 private path、内部类型、全局单例或启动副作用。

## 运行视图（Runtime / Process View）

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

TS runtime skeleton 定义：

- submit/cancel/retry/edit command interfaces。
- request acceptance boundary 和 lifecycle transition placeholder。
- bounded queue 和 global concurrency abstraction。
- same-session lane abstraction。
- latest-request supersession signal。
- cancellation 和 timeout 的 `AbortSignal` propagation。
- checkpoint 和 terminal commit coordinator interfaces。
- timeline event publisher interface。
- async Agent、Model、Capability、Gateway invocation boundaries；Tool、Skill、Agent capability 通过 Capability invocation boundary 表达。
- bounded parallel execution extension boundary placeholders。
- human interaction pending input interfaces。
- sandbox execution gateway interfaces。

运行时规则：

- Scheduler 使用 Promise workers 和 explicit semaphores，不使用隐式 event-loop fanout。
- 长时间运行的 agent、model、capability、gateway 和 stream operations 必须是 async contract，并接收 cancellation context。
- 单个 RequestRun 首版可以串行执行；后续若启用 Tool、Agent capability、检索和确定性子流程并行，必须受 explicit concurrency budgets、dependency graph、result aggregation、timeout 和 cancellation propagation 约束。
- request routing 在 `agent-core` 的 Agent boundary 内执行。`agent-runtime` 不根据业务语义选择确定性流程或模型 loop；runtime 只负责 admission、lane、cancellation、checkpoint、timeline 和 terminal commit。
- routing policy 可以选择 deterministic flow、model-driven loop、clarify、reject 或 human handoff；routing decision 必须保留可审计 evidence 的接入位置。
- 用户或上游入口提供处理约束时仍走 routing policy；routing boundary 必须保留约束来源、校验结果、source/version、选择或拒绝原因的接入位置。
- Model stream、capability progress、capability lifecycle、agent planning 和 runtime lifecycle 都进入 timeline event ownership model；具体事件类型和 payload 由后续 capability change 定义。
- 模型、hook、policy、capability 或 runtime 需要人参与时，必须通过同一个 human interaction pending input boundary 进入澄清、确认、授权、选择或人工接管；响应回来后继续同一个 RequestRun。
- shell、python、脚本和模型生成代码等动态可执行内容必须通过 sandbox execution gateway boundary；PaaS sandbox 或本地受限实现负责资源限制、文件系统范围、网络、环境变量、凭据、工作目录、输出大小和安全错误归一化。
- SSE 和 WebSocket delivery 只投影 runtime timeline events；慢客户端和 replay gap 是 channel delivery concern，不修改 runtime lifecycle，也不伪造执行事实。
- terminal stream event 和 visible conversation history 只能在 terminal durable-write boundary 成功后对客户端可见。
- HTTP、stream、config、gateway response、persisted JSON、capability input/output 必须做 runtime schema validation。
- 双语相关 language/locale 值必须在 request acceptance 后进入 context assembly、model/prompt selection、capability descriptor filtering、stream metadata 和 final result skeleton。
- 当前身份和 owner scope 必须由 channel/auth 边界解析并进入 runtime command；session、attachment、memory、capability、gateway 和 audit 写入必须保留 owner scope，不信任请求体、模型输出或 capability 参数中的 owner 值。
- request acceptance 前必须通过 `agent-attachment-runtime` 校验 attachment refs、owner、可用性和安全摘要；附件内容进入 context 前仍受 Context Engine 预算和安全投影约束。
- 长期记忆、自学习和记忆维护通过 `agent-memory` 与 gateway owner-scoped memory ports 处理；这些后台或异步 lifecycle 不参与 request terminal commit 的必要写入。
- 本地运行和后续 PaaS 多实例部署复用同一 runtime/gateway contracts；本地 adapter 可以用单实例本地状态实现，PaaS adapter 启用时必须把 RequestRun、checkpoint、pending input、timeline、terminal commit、lock/lease 和 version 作为共享权威状态处理。
- 后续 PaaS 多实例正确性不得依赖 process-local memory、单进程 scheduler 或 sticky session；channel reconnect、stream resume 和 request control 必须能路由到任意健康实例。
- Tool 不默认支持幂等。执行有副作用的 Tool 或 Agent capability 前，runtime 必须有 checkpoint/idempotency boundary；如果目标能力未声明可安全重放，恢复逻辑不得盲目重复调用。
- Session/message/read model、active RequestRun、pending input 和 human handoff 事实必须通过 session/runtime/gateway contract 访问；其他 package 不得绕过 owner scope 直接操作会话状态。

## 部署和物理视图（Deployment / Physical View）

第一阶段物理视图定义本地后端工程、运行时基线、装配边界和 PaaS 多实例运行正确性边界。本 change 不定义具体 PaaS 产品拓扑、流量切换、端口或发布策略；首版本地 release 可只交付本地单实例运行包，package 和 contract 必须为后续远端 PaaS 多实例服务部署保留边界。

仓库根目录就是 TS 后端 workspace。`src/` 只承载最薄的进程启动入口；具体装配仍由 `packages/agent-app` 负责。`packages/` 承载内部 package；`tests/` 承载跨 package 的 contract、architecture 和 integration 验证；`openspec/` 是规格源。非 TS 后端源码或外部材料不属于 TS build、test、runtime 或 architecture lint 输入。

选定技术路径：

- **Runtime**：Node.js LTS，使用内置 `fetch`、`AbortController`、Web Streams 和 AsyncLocalStorage。
- **Language**：TypeScript strict ESM，启用 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、project references 和 package `exports`。
- **HTTP**：Fastify，用于 REST、SSE 和 WebSocket-compatible adapter。Fastify 类型不进入 contract 或 domain packages。
- **Structured logging**：Pino。Fastify request logging 复用 Pino；应用日志通过 `agent-observability` structured logging helper 创建 child logger、注入 sessionId、requestRunId、messageId、trace id 等安全关联字段，并执行 redaction policy。
- **Schema**：TypeBox + Ajv。TypeBox 负责 JSON Schema 和静态类型共源；Ajv 负责 runtime validation。
- **Testing**：Vitest。Web contract tests 使用 Fastify inject；schema tests 直接调用 validator。
- **Architecture lint**：dependency-cruiser，检查 layer、forbidden dependency、private import、framework leakage。
- **Local persistence**：Kysely + better-sqlite3。SQLite 调用集中在 local gateway adapter，使用短事务和 owner-scoped query。
- **Attachment runtime**：附件可信处理集中在 `agent-attachment-runtime`。文件类型识别、可读性检查、暂存路径和安全摘要是该 package 内部实现选择，不泄漏到 channel、runtime、context 或 contracts。
- **Memory**：`agent-memory` 承载长期记忆、自学习和记忆生命周期边界；Context Engine 负责 query policy、window selection 和 compaction 等上下文选择策略。
- **Remote calls**：fetch-compatible client，统一 timeout、AbortSignal、trace headers、safe failure normalization。
- **Model provider adapters**：`agent-model` 定义 NextAgent 自己的模型调用和流式结果边界。Provider SDK、Vercel AI SDK、LangChain、OpenAI-compatible client 或平台 ModelGateway 只能作为 adapter 内部实现选择，不作为跨模块 public contract。ModelGateway 是 PaaS 推理网关；当选择该推理路径时，`agent-model` 通过 gateway contract 调用它。
- **Sandbox**：sandbox execution contract 属于 `agent-contracts/gateway` 的 dynamic execution gateway boundary。PaaS 部署由 `agent-platform-gateway-remote` 对接平台 sandbox；本地运行态可以提供 unavailable/deny-by-default 或受限占位实现。具体隔离机制只能作为 gateway adapter 内部实现选择，不进入 core、runtime、capability 或 contracts 的具体类型。
- **Observability**：OpenTelemetry API/SDK、Pino、AsyncLocalStorage request/run context。Tracing 和 metrics 由 observability 实现层通过 middleware/interceptor、port wrapper/decorator、auto-instrumentation 和 timeline/event subscriber 接入；核心契约不暴露 tracing/metrics SDK 类型。Metrics 通过 OTel SDK 提供，不引入独立的 prom-client 体系——两个 metrics 体系违反 KISS 原则。
- **Composition**：显式构造注入。`agent-app` 是唯一 composition root；不使用全局 DI container。

`agent-app` owns startup composition：

- 从 environment 和 files 读取 raw config。
- 读取 Agent definition 或 Agent config directory 的入口引用；具体目录结构和字段全集由后续 Agent assembly capability 定义。
- 通过 runtime schema 校验配置。
- 构造 typed system config。
- 选择 local 或 remote gateway adapter。
- 装配 runtime、Web channel、context engine、core、model provider skeletons、capability provider skeletons、gateway adapters（含 sandbox port）和 observability。
- 提供产品特定 composition entry/factory；local configured authentication 入口显式 import `agent-channel-web-auth-local` 作为边界包，remote/IAM 入口不得 import/register、bundle 或暴露该 package。
- 装配 attachment runtime 和 memory boundary skeleton。
- 暴露 Fastify server factory，用于 tests 和 local startup。

Secrets 只用 env/file credential sources 表示。Raw credentials 不得进入 config examples、stream payloads、messages、traces、logs、metrics 或 health details。Local auth 的正式产品配置、认证协议、endpoint、cookie/ticket 和配置修改方式由后续 auth/API change 定义。

备选方案取舍：

- Bun 不作为第一阶段生产 runtime 基线；第一阶段选择 Node.js LTS，以降低企业后端运行时、observability、Fastify、工具链和长期维护风险。Bun 可由后续 change 作为实验性 runtime profile 评估。
- NestJS 不作为第一阶段选择；decorator/DI/module metadata 容易扩散到 contract packages，削弱 package-level ownership。
- Express 不作为第一阶段选择；schema-first、type-safe route 和 inject testing 需要额外拼装，长期 contract 验证成本更高。
- tRPC 不作为第一阶段选择；NextAgent 需要可由 OpenSpec 管理的 REST/SSE/WS contract，而不是 TS-only RPC contract。
- 单包服务不作为第一阶段选择；runtime、gateway、channel、context、capability 和 observability 的 ownership 需要自动化边界检查。

## 可观测和日志设计（Observability）

`agent-observability` 提供小型集成能力：

- request/run context through AsyncLocalStorage。
- structured logging helper through Pino child loggers。
- OTel middleware/interceptor and port wrapper/decorator integration。
- low-cardinality metrics integration。
- safe diagnostic summary。
- metric tag allow/block policy。
- log redaction and field allow/block policy。

Logs 是可维护性和诊断能力的一部分，不是散落的 console output。Runtime、channel、gateway、capability、core 和 app code 在确需显式日志时必须使用 `agent-observability` structured logging helper，不直接使用 `console.*` 作为诊断入口。Tracing 和 metrics 优先通过 middleware/interceptor、port wrapper/decorator、auto-instrumentation 和 timeline/event subscriber 实现，避免把 manual span 或 manual metric 分散到业务代码。

日志使用 structured JSON、stable event names、service/package context、severity、timestamp、业务标识字段、trace id 和 safe error shapes。日志不得包含 prompt text、model output content、stream deltas、raw provider errors、local paths、credentials、tokens、user-uploaded content 或 high-cardinality object dumps。

Metrics 不得把 `requestId`、`runId`、`sessionId`、prompt、payload、content、deltas、local paths、provider raw errors 或 secrets 用作 labels。Trace/log payloads 使用 safe summaries 和 stable refs。

## 验证策略（Verification）

Required commands：

- `npm run build`：TypeScript project references compile。
- `npm test`：unit and skeleton tests run。
- `npm run test:contract`：schema and contract smoke tests run。
- `npm run lint:architecture`：dependency-cruiser and package boundary checks run。

Architecture gate 必须包含 negative fixtures，证明 forbidden imports、private imports、framework leakage、missing runtime schema 和 logging redaction 违规会失败。

## 架构需求满足关系（Requirement-to-Architecture Fit）

本节说明 `specs/ts-backend-architecture/spec.md` 中的 requirement 为什么属于架构需求，以及由哪些设计元素承载。具体 API、事件 payload、状态机、数据表和业务能力仍由后续 capability change 定义。

| 架构需求 | 架构元素 | 关键决策 | 验证入口 |
|---|---|---|---|
| 顶层架构驱动、架构驱动覆盖 | 架构需求与关键场景、架构原则、质量属性设计 | 只固化影响后续实现正确性的边界，不提前定义业务行为。 | OpenSpec strict、README/设计审查 |
| 双语交互架构边界 | `agent-common` language/locale value、context/model/capability/stream metadata | language/locale 是 contract 字段，不靠 prompt 或 UI 隐式传递。 | schema/contract smoke tests |
| 根 Workspace 后端范围、规格基线来源 | 根 workspace、`openspec/`、`packages/`、`tests/` | TS 后端以仓库根为后端 workspace；浏览器 UI 不进入后端 build。 | build、architecture lint |
| 服务运行时模型、异步执行边界 | Node.js LTS、Promise/AsyncIterable、AbortSignal、AsyncLocalStorage | 所有慢边界 async 化，取消、requestRunId 和 trace/log 上下文由 runtime/observability 协作贯穿。 | async boundary tests |
| 事件流架构边界 | runtime canonical timeline、channel projection | 执行组件发布事实，channel 只投影，不拥有领域事件。 | event ownership tests |
| Package 拓扑、Package 边界强制、整模块替换边界 | responsibility packages、package exports、dependency-cruiser、`agent-app` composition root | 边界通过 package 和 public exports 强制；替换通过显式 composition。 | package export tests、negative dependency fixtures |
| Identity 和 Owner Scope 边界 | channel/auth、runtime command、gateway owner-scoped operations、audit refs | owner scope 来自当前 identity，不信任请求体、模型输出或 capability 参数。 | owner-scope contract tests、safe error tests |
| Attachment Runtime 边界 | `agent-attachment-runtime`、attachment refs、availability check、cleanup policy | 附件可信处理独立成包，避免散落到 channel/runtime/context。 | attachment boundary smoke tests |
| Memory Lifecycle 边界 | `agent-memory`、gateway memory ports、Context Engine memory consumption | 记忆生命周期独立于上下文组装，不参与 terminal commit 必要写入。 | memory boundary smoke tests |
| Capability 分类和 Agent capability 边界、Capability 生命周期边界 | `agent-capability`、catalog、discovery、SkillTool、ToolExecutor、Agent capability executor | Capability 是上位概念；Tool/Skill/Agent 不形成三套运行时。 | capability contract smoke tests |
| Agent 内部 Request Routing 边界 | `agent-core` routing policy、AgentAssembly、runtime lifecycle boundary | request routing 属于 Agent 内部 policy，runtime 不做业务语义路由。 | routing boundary smoke tests |
| Model provider adapter boundary | `agent-model`、provider stream normalization、ModelGateway 调用边界 | provider SDK/ModelGateway 细节不泄漏到 core/runtime/contracts。 | model contract tests、dependency lint |
| 模块间数据流说明 | 模块间数据流图、动态执行图、诊断信号图 | 用数据流审查模块交互，不定义 route/payload/schema。 | design review、OpenSpec strict |
| Runtime Kernel Ownership | `agent-runtime`、scheduler、same-session lane、checkpoint、terminal commit、hooks | 请求生命周期、hook lifecycle 和终态可见性统一由 runtime 拥有。 | runtime skeleton characterization tests |
| 本地与 PaaS 运行形态边界 | local/remote gateway adapters、shared RequestRun/checkpoint/timeline/lock/version | 首版本地 release 可只交付本地单实例；PaaS 多实例后续启用时正确性不依赖 sticky session。 | PaaS boundary smoke tests |
| 会话状态边界 | `agent-session`、gateway owner-scoped state access、runtime facts | session/message/read model 和 active/pending/handoff facts 通过 owner-scoped contract 访问。 | session state boundary tests |
| Human Interaction 统一边界 | runtime-owned pending input | 澄清、确认、授权、选择、人工接管共用一个 pending boundary。 | pending input smoke tests |
| Bounded Parallel Execution 扩展边界 | runtime scheduler、parallel budget、dependency graph、deterministic aggregation | 首版可保持单个 RequestRun 内串行；后续并行必须有预算、依赖、取消、checkpoint 和聚合边界。 | parallel boundary tests |
| Sandbox Execution 边界 | sandbox gateway contract、remote platform gateway PaaS sandbox adapter | TS 后端控制和审计，PaaS 提供隔离；不新增 `agent-sandbox` package。 | sandbox gateway contract tests |
| Adapter Ownership、结构化日志边界 | adapter packages、`agent-observability` integration helpers、Pino/OTel/metrics | 外部库和诊断 sink 留在 adapter/integration 内，不泄漏到 core/contracts。 | architecture lint、log redaction tests |
| 架构验证门禁 | build/test/contract/architecture scripts、negative fixtures | 架构完成必须可重复验证。 | `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` |

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 电信网络智能体可能接触网络拓扑、告警、日志、客户系统凭据和用户画像；所有不可信边界 runtime schema validation；identity 从 channel/auth 解析并贯穿 runtime、session、attachment、memory、capability、gateway 和 audit；附件只有经过 `agent-attachment-runtime` 可信处理后才能进入请求；gateway owner scope 由 gateway contract 和 adapter 共同约束；adapter 输出 presentation-safe errors；shell、python、脚本和模型生成代码等动态可执行内容必须走 sandbox gateway boundary，控制文件系统、网络、环境变量、凭据、资源和安全错误。 | schema tests、Web contract smoke tests、owner-scope fixtures、attachment boundary tests、sandbox gateway contract tests、secret scan、safe error tests |
| 性能/容量 | 电信任务可能涉及长时间诊断、多源检索和持续流式输出；Fastify + compiled schema 降低 route 开销；Agent、Model、Capability、Gateway 边界采用 async contracts；runtime scheduler 显式并发和 backpressure；单个 RequestRun 首版可串行执行，后续并行必须在预算、依赖图、取消和聚合约束下启用；SQLite 短事务集中在 gateway adapter。Tool、Skill、Agent capability 作为 Capability 类型遵守同一并发和取消边界。 | architecture skeleton tests、async boundary tests、parallel boundary tests、后续 load/benchmark tests |
| 可靠性/恢复 | 电信运维场景不能把请求终态、能力副作用和历史可见性做成 best-effort；runtime kernel owns lifecycle、checkpoint、terminal commit；本地运行态承诺单实例进程重启恢复；PaaS 运行态后续启用时必须具备共享状态、lock/lease、version、非粘性请求和故障接续边界；Tool 不默认幂等，恢复必须依赖显式 idempotency contract 或安全失败；memory lifecycle 不参与 terminal commit 必要写入，避免自学习失败破坏主请求。通俗解释：如果智能体正在帮运维人员诊断一个严重的网络故障，诊断过程必须从头到尾完整记录，不能因为服务器重启就丢失已经发现的线索；如果诊断中途调用了修改网络配置的工具，恢复时不能盲目重复调用这个工具（因为可能已经成功执行了），必须确认是否已经执行过再决定下一步。 | runtime characterization tests、gateway idempotency tests、PaaS boundary tests、memory lifecycle smoke tests |
| 可维护性 | 开发框架需要长期承载 Agent、Model provider、Capability provider、gateway 和 channel 扩展；package topology 以 responsibility 分层；package exports + dependency-cruiser 阻止边界腐化；composition 集中在 app；附件和记忆因独立生命周期成包，上下文选择策略并入 `agent-context-engine`，避免把仅服务上下文装配的策略再拆出额外架构边界；Pino structured logs 提供稳定诊断入口，避免散落的 console 输出。 | `npm run lint:architecture`、package export tests、log helper tests、code review |
| 可测试性 | 二次开发能力必须可在无真实外部依赖下验证；schema validator、Fastify inject、fake gateway、test-kit fixtures 支持无端口、无真实外部依赖测试。 | Vitest unit/contract tests、test-kit fixtures |
| 审计/可追溯性 | 电信级诊断需要定位请求、模型、工具、gateway、事件事实来源、语言上下文和终态提交路径，同时避免暴露敏感内容；业务标识字段、Pino structured logs、OTel spans、low-cardinality metrics 和 safe trace summary 分工明确。 | observability tests、event ownership tests、log redaction tests、metric tag policy tests、trace smoke tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：归档后由 `openspec/specs/ts-backend-architecture/spec.md` 主承载 `[TS] NextAgent backend architecture`。
- 跨模块架构：归档前新增 `openspec/designs/architecture/ts-backend-architecture.md`。
- 模块职责：归档前为第一阶段 TS package 新增 `openspec/designs/modules/*.md`。
- ADR：归档前新增 `openspec/designs/adr/0001-ts-backend-stack.md`。
- 导航：归档前新增或更新 `openspec/designs/spec-to-design-map.md`。
- 领域模型、状态机、API、event、schema：本 change 不建立长期主文档；后续能力 change 定义具体行为时再建立。

## 风险与取舍（Risks / Trade-offs）

- [行为过早固化] -> 本 change 只固化架构边界；用户可见 contract 通过后续 capability 定义。
- [框架泄漏] -> Fastify 只在 Web adapter 和 app composition 中出现；contract package 禁止依赖 Fastify。
- [类型误判安全] -> 编译期 TS 类型不能代替 runtime schema validation。
- [双语行为过早固化] -> 本 change 只定义 language/locale 的架构位置，不定义提示词模板、术语表或语言检测算法。
- [事件协议过早固化] -> 本 change 只定义事件流 ownership 和 projection 边界，不定义事件类型全集或 payload schema。
- [同步 SQLite 阻塞] -> SQLite access 限制在 local gateway 短事务；容量不足时在 adapter 内部优化。
- [日志泄漏敏感内容] -> 日志统一通过 structured logging helper、redaction policy 和测试 fixture 约束，不允许直接散落 `console.*`。
- [动态执行逃逸] -> shell、python、脚本和模型生成代码只能通过 sandbox gateway contract 执行，architecture gate 禁止 capability、hook、policy 直接绕过 sandbox gateway 或直接依赖 PaaS sandbox SDK。
- [并行导致不可恢复] -> 后续若启用并行执行，必须保留 dependency graph、checkpoint、idempotency、cancellation 和 deterministic aggregation 边界。
- [路由变成全局业务规则] -> request routing 位于 Agent 内部 policy，runtime 不承担业务语义路由。
- [package 数量膨胀] -> 第一阶段采用聚合的 `agent-contracts` 和 `agent-capability`；只有附件可信处理和长期记忆这类已有独立 lifecycle/安全 owner 的职责单独成包，而上下文选择策略维持在 Context Engine 职责内。

## 发布与切换计划（Release Plan）

无运行时切换。本 change 只建立 NextAgent TS 后端架构骨架和两种交付形态的架构边界：首版本地单实例运行包、后续 PaaS 多实例服务部署。具体启动命令、端口、配置项、数据目录、流量切换、历史数据处理、接口兼容性、验证和回滚方式，必须通过后续 OpenSpec change 定义。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/ts-backend-architecture/spec.md`：提升 `[TS] NextAgent backend architecture` 行为契约。
- `openspec/overview.md`：建立 NextAgent TS 后端作为独立后端实现形态和根 OpenSpec 规格源。
- `openspec/designs/architecture/ts-backend-architecture.md`：提炼轻量 4+1 架构视图、技术栈、package topology、模块间数据流、依赖边界、runtime kernel、model、gateway、channel、capability、app、observability 和 verification 策略。
- `openspec/designs/modules/*.md`：按实际 package skeleton 提炼职责、非职责和依赖。
- `openspec/designs/adr/0001-ts-backend-stack.md`：记录 TypeScript 后端技术栈取舍。
- `openspec/designs/spec-to-design-map.md`：新增 capability 导航和验证入口。

## 待确认问题（Open Questions）

无。`[TS]` 前缀用于 spec 显示标题和 requirement 名称；capability 目录名继续使用 `ts-backend-architecture`，以满足 OpenSpec capability kebab-case 命名规则。
