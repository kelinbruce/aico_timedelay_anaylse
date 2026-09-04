# [TS] NextAgent 后端架构规格

## ADDED Requirements

### Requirement: [TS] 顶层架构驱动

TS 后端架构 MUST（必须）围绕 NextAgent 的四类顶层诉求组织：面向电信网络智能体、服务两类用户、支持多入口接入、满足电信级质量属性。本架构切片不得把 runtime lifecycle、stream event shape、capability governance、gateway data model、网络域工具分级、审批流或具体入口协议等推导出的设计细节当作顶层行为契约。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 架构说明顶层诉求

- **WHEN** 评审 TS 后端架构基线
- **THEN** proposal、design 和 backend README 说明四类顶层诉求
- **AND** bilingual context、async execution、event stream、runtime、gateway、context、capability、observability 和 package 边界都映射到这些诉求之下

#### Scenario: 架构支持两类用户但不过早定义扩展细节

- **WHEN** 创建 TS 后端骨架
- **THEN** `agent-app` 负责开箱即用的默认后端装配边界
- **AND** contracts、model boundaries、adapters、capability boundaries、package-level replacement boundaries 和 test-kit boundaries 为后续开发者与集成者使用保留
- **AND** Capability 被定义为 Tool、Skill、Agent 等可执行能力的上位概念
- **AND** 具体 Agent configuration、Skill、Agent capability、Tool、gateway、channel、policy 和 hook 语义由后续 capability change 定义

#### Scenario: 架构兼容后续入口

- **WHEN** 第一阶段骨架创建 channel contract 和 Web channel adapter
- **THEN** request lifecycle、session ownership、identity propagation 和 event fact ownership 不得绑定到 Web-only 实现假设
- **AND** 本阶段只有 `agent-channel-web` 一个 channel implementation
- **AND** 后续入口协议必须先通过后续 OpenSpec change 定义，再进入实现

### Requirement: [TS] 架构驱动覆盖

TS 后端架构 MUST（必须）把 package 边界、adapter 边界、runtime ownership、contract ownership 和 verification gate 追溯到四类顶层诉求。request lifecycle、stream payload、context policy、capability governance、gateway data model、domain tool、approval flow、memory behavior 或具体入口协议等详细行为，必须先由后续 OpenSpec change 定义，再进入实现。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Package 边界映射到架构驱动

- **WHEN** TS 后端骨架定义 package boundary、adapter boundary、runtime ownership rule 或 verification gate
- **THEN** design 文档说明该边界保护的黑盒后端诉求
- **AND** 该边界可以通过 build、test、contract 或 architecture lint 入口验证

#### Scenario: 架构驱动不提前定义详细行为

- **WHEN** 后续实现需要具体 API route、stream payload、runtime state machine、runtime state storage schema、gateway data model、context policy、memory behavior、capability schema 或 tool execution semantics
- **THEN** 这些行为必须先由后续 OpenSpec change 定义

### Requirement: [TS] 双语交互架构边界

TS 后端 MUST（必须）为中文和英文交互保留显式 language/locale 架构边界。Normalized language/locale 必须进入 request/context/model/prompt/capability/stream/final result 的 contract skeleton；本架构切片不得定义具体提示词模板、术语表、语言检测算法或语言转换策略。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Language metadata 进入上下文组装边界

- **WHEN** TS 后端骨架定义 request context、context assembly request 或 model-facing query skeleton
- **THEN** contract skeleton 包含 normalized language/locale 字段或专用 value object
- **AND** context engine 边界可以按 language/locale 选择 prompt template profile 或 model profile 的占位 contract

#### Scenario: Capability 和 model 元数据保留语言空间

- **WHEN** TS 后端骨架定义 capability descriptor、model/provider profile 或 prompt profile skeleton
- **THEN** descriptor 或 profile 保留 supported languages、language variant 或 locale metadata 的扩展位置
- **AND** 具体路由规则、术语表和提示词内容由后续 capability change 定义

#### Scenario: Stream 和 final result 保留语言一致性上下文

- **WHEN** TS 后端骨架定义 stream envelope、timeline event metadata 或 final result skeleton
- **THEN** 它们保留关联 request language/locale 的能力
- **AND** 不把语言状态存放为 Web-only UI state

### Requirement: [TS] 根 Workspace 后端范围

TS 后端 MUST（必须）以仓库根目录作为 NextAgent TS 后端 workspace。该 workspace 只负责后端 service entrypoint、后端 packages、后端 runtime configuration、后端 tests 和后端 build tooling，不负责 browser UI source、browser state、frontend routing 或 static asset build behavior。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 根 workspace 只包含 TS 后端构建关注点

- **WHEN** 创建 TS 后端骨架
- **THEN** 仓库根目录包含 `package.json`、`tsconfig.json`、`tsconfig.base.json`、`src/`、`packages/`、`tests/` 和后端 build files
- **AND** browser UI source 不进入 TS backend workspace 的 build、test、runtime 或 architecture lint 输入

#### Scenario: 架构骨架不引入用户可见行为

- **WHEN** 实现本架构切片
- **THEN** 除 localhost-only local configured authentication 的最小 Web auth adapter boundary 外，不新增业务 Web route、具体 auth endpoint、cookie/ticket 格式、stream event type、具体 runtime state machine、runtime state storage schema、gateway port、Agent loop behavior 或 frontend behavior

### Requirement: [TS] 规格基线来源

TS 后端 MUST（必须）使用根 `openspec/` 作为规格来源。在第一阶段架构 change 中，只有本 change 定义的架构边界属于范围内。后续任何 TS 后端 Web API、stream event、runtime command、context contract、capability contract、gateway contract、persistence owner、security boundary 或 observability signal，都必须先由 OpenSpec change 定义，再进入实现。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 架构骨架不发明行为

- **WHEN** 实现工作需要尚未被 accepted OpenSpec change 定义的 route、event type、runtime status、gateway owner、persisted object、state transition 或 domain object
- **THEN** 实现必须暂停，直到新的 OpenSpec change 定义该行为

#### Scenario: 归档后的架构成为稳定基线

- **WHEN** 本 change 被归档
- **THEN** `ts-backend-architecture` 成为后续 TS 后端 change 的稳定架构基线
- **AND** 后续 change 通过它引用 package、runtime、adapter、composition 和 verification 边界

### Requirement: [TS] 服务运行时模型

TS 后端 MUST（必须）面向 Node.js service runtime 设计，使用 async I/O semantics、explicit concurrency limits、backpressure-aware stream handling、runtime schema validation、`AbortSignal`-compatible cancellation，并通过 AsyncLocalStorage 传播 request/run 上下文。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 不可信数据在运行时校验

- **WHEN** 数据通过 HTTP、stream subscribe/resume、platform gateway response、configuration file、environment variable、persisted JSON payload 或 capability input 进入系统
- **THEN** TS 后端必须先用 runtime schema 校验，再把它当作可信应用数据处理

#### Scenario: Cancellation 通过异步边界传播

- **WHEN** runtime cancellation、timeout 或 latest-request supersession 被触发
- **THEN** 下游 async operations 接收 runtime-owned cancellation signal
- **AND** 无法消费 `AbortSignal` 的 adapters 返回 typed cancellation 或 timeout outcome

#### Scenario: Streams 尊重 backpressure

- **WHEN** SSE 或 WebSocket delivery 投影 runtime timeline events
- **THEN** channel adapter 处理慢客户端时不得阻塞 request execution，也不得修改 runtime lifecycle state

### Requirement: [TS] 异步执行边界

TS 后端 MUST（必须）把 Agent、Model、Capability、Gateway 和 stream delivery 等可能长时间运行或等待外部 IO 的边界定义为 async contract。此类边界必须使用 Promise、AsyncIterable、event publisher/subscriber、execution handle 这类 TS async primitive，并接受 runtime-owned cancellation context；不得把同步阻塞调用作为跨 package public contract。Tool、Skill、Agent capability 作为 Capability 类型遵守同一异步边界。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 长耗时边界暴露 async contract

- **WHEN** `agent-contracts` 定义 Agent、Model、Capability、Gateway 或 stream delivery 的 public interface skeleton
- **THEN** 长耗时操作返回 Promise、AsyncIterable、execution handle 或 event stream abstraction
- **AND** public contract 不要求调用方阻塞等待同步结果

#### Scenario: Cancellation 进入所有长耗时边界

- **WHEN** runtime cancellation、timeout 或 latest-request supersession 被触发
- **THEN** Agent、Model、Capability、Gateway 和 stream delivery 边界接收 runtime-owned cancellation context
- **AND** 无法原生消费 `AbortSignal` 的 adapter 返回 typed cancellation 或 timeout outcome

#### Scenario: 并发限制由 runtime 或 adapter 边界显式表达

- **WHEN** Agent、Model、Capability 或 Gateway 可能并发执行
- **THEN** skeleton contract 保留 per-request、per-session、per-adapter 或 global concurrency limit 的接入位置
- **AND** 并发控制不得隐藏在 Web channel 或 provider SDK 内部

### Requirement: [TS] 事件流架构边界

TS 后端 MUST（必须）把事件流作为执行事实的架构边界。Agent、Model、Capability、Gateway 和 Runtime 等执行组件拥有各自事实事件的发布责任；Runtime 维护 canonical timeline；Channel adapter 只把 timeline events 投影为 transport stream envelope。本架构切片不得定义具体 event type 全集或 stream payload schema。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 执行组件拥有事实事件

- **WHEN** Agent planning、model streaming、capability progress、capability lifecycle、gateway degradation 或 runtime lifecycle 产生可观察事实
- **THEN** 对应执行组件通过 public event publisher boundary 发布事实事件
- **AND** Web channel adapter 不伪造执行事实事件

#### Scenario: Runtime 维护 canonical timeline

- **WHEN** 多个执行组件发布事件
- **THEN** runtime timeline publisher 负责统一 ordering boundary、terminal visibility boundary 和业务标识字段
- **AND** channel、core、context、capability、gateway 和 app packages 不创建竞争性的 timeline ownership

#### Scenario: Web stream 只做投影

- **WHEN** SSE 或 WebSocket-compatible delivery 向客户端发送流
- **THEN** `agent-channel-web` 从 runtime timeline 投影 transport-ready stream envelope
- **AND** slow client、resume cursor、replay gap 和 backpressure 是 channel delivery concern
- **AND** 具体 stream payload 由后续 OpenSpec change 定义

### Requirement: [TS] Package 拓扑

TS 后端 MUST（必须）按服务职责组织代码，而不是按框架目录组织。第一阶段架构切片必须创建 `agent-common`、`agent-contracts`、`agent-runtime`、`agent-session`、`agent-attachment-runtime`、`agent-context-engine`、`agent-memory`、`agent-core`、`agent-model`、`agent-channel-web`、`agent-channel-web-auth-local`、`agent-platform-gateway-local`、`agent-platform-gateway-remote`、`agent-capability`、`agent-observability`、`agent-app` 和 `agent-test-kit`。只有后续 OpenSpec change 识别出独立 owner、dependency layer 和 verification boundary 时，才允许新增 package。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Packages 表达 ownership

- **WHEN** 开发者查看根 `packages/`
- **THEN** package 名称能识别 stable responsibilities，包括 common primitives、contracts、runtime、session、attachment runtime、context engine、memory lifecycle、core orchestration、model provider adapter、Web channel、local Web authentication endpoint adapter、platform gateways、capability、observability、app composition 和 test-kit

#### Scenario: 新 package 需要 ownership 理由

- **WHEN** TypeScript runtime、validation、stream 或 configuration 关注点需要另一个 package
- **THEN** 该 package 必须有明确 owner、dependency layer、public exports 和 architecture verification rule

#### Scenario: Context Engine 拥有上下文选择策略职责

- **WHEN** 第一阶段创建 context window、compaction、prompt shaping 或 context selection policy skeleton
- **THEN** 该策略作为 `agent-context-engine` 内部组件实现
- **AND** `agent-context-engine` 负责 query policy、window selection、compaction 和 prompt shaping
- **AND** 该策略不被提升为独立架构边界，除非后续 OpenSpec change 明确定义新的 owner、复用方或验证边界

### Requirement: [TS] Identity 和 Owner Scope 边界

TS 后端 MUST（必须）把当前身份和 owner scope 作为跨模块安全边界。Channel/auth 边界负责解析当前身份，runtime、session、attachment、memory、capability、gateway、audit 和 observability 边界必须携带 tenant/subject owner scope；请求体、模型输出、Capability 参数或客户端 metadata 中的 owner 字段不得作为授权依据。除 localhost-only local configured authentication 的最小 Web auth adapter boundary 外，本架构切片不得定义具体认证 endpoint、cookie/ticket 格式、session token 格式、完整认证协议或 IAM 集成细节。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 当前身份来自 channel/auth

- **WHEN** Web/LUI channel 接收 request submit、stream subscribe、history query、attachment upload 或 request control 命令
- **THEN** channel/auth boundary 解析当前 identity context
- **AND** runtime command skeleton 接收 owner scope
- **AND** 请求体中的 tenant、subject、session owner 或 capability owner 字段不得覆盖当前 identity context

#### Scenario: Owner scope 贯穿存储和能力边界

- **WHEN** runtime、session、attachment、memory、capability 或 gateway package 读取或写入 session、message、RequestRun、checkpoint、timeline、attachment、artifact、memory 或 audit fact
- **THEN** 调用边界必须携带 tenant/subject owner scope
- **AND** gateway operation 必须保留 owner-scoped query 或 write guard 的接入位置
- **AND** 跨 owner 访问必须返回 presentation-safe rejection 或 not-found outcome

#### Scenario: Identity 不泄漏敏感信息

- **WHEN** stream event、log、metric、trace、health 或 safe error 输出 identity 相关诊断
- **THEN** 输出只能包含允许的 stable refs 或 safe summary
- **AND** raw credential、token、cookie、IAM payload 或 local identity secret 不得进入可见输出

#### Scenario: Local Web auth adapter boundary is isolated

- **WHEN** local runtime mode reserves local configured authentication
- **THEN** `agent-channel-web-auth-local` MUST own the optional local Web auth adapter boundary
- **AND** this architecture slice MUST NOT define public gateway auth contracts, credential validation semantics or identity resolution protocols for local configured authentication
- **AND** this architecture slice MUST NOT define concrete auth endpoint paths、request/response payloads、cookie/ticket formats、signing behavior、token lifetime、server-side auth session storage or IAM protocol
- **AND** the local auth adapter MUST NOT access session、message、memory、attachment、RequestRun or capability durable facts
- **AND** when local configured authentication is not composed, local auth capability MUST NOT authenticate requests or expose local credential behavior
- **AND** IAM or remote authentication flows MUST NOT depend on `agent-channel-web-auth-local`

#### Scenario: Local auth is scoped to localhost-only deployment

- **WHEN** local configured authentication is enabled for the first local release
- **THEN** this architecture slice MUST reserve loopback-only local auth as the first local release boundary
- **AND** local auth MUST NOT define multi-user management, signup, password-change API, remember-me, refresh token, server-side auth session store or in-app authentication configuration editing
- **AND** product credential configuration MUST use env/file secret references and MUST NOT require raw credential values
- **AND** concrete ticket transport、ticket signing、cookie attributes、query-parameter behavior and process-restart invalidation semantics MUST be defined by a later auth/API change before implementation

#### Scenario: Local auth package is composed only by local product entry

- **WHEN** TS backend is assembled for local configured authentication
- **THEN** the local product composition entry MUST import `agent-channel-web-auth-local` as an explicit Web authentication adapter boundary package
- **AND** `agent-channel-web` MUST remain usable without importing `agent-channel-web-auth-local`
- **AND** IAM or remote product composition entries MUST NOT import, register, bundle or expose `agent-channel-web-auth-local`
- **AND** product-specific composition MUST happen in `agent-app` entry or factory code and MUST NOT require runtime dynamic plugin loading, hot loading or hidden dependency injection
- **AND** architecture verification MUST check local and IAM/remote composition dependency graphs separately

### Requirement: [TS] Attachment Runtime 边界

TS 后端 MUST（必须）通过 `agent-attachment-runtime` 承载请求附件的后端可信处理边界。Attachment upload transport、request acceptance、context assembly、session history 和 gateway storage 不得各自实现一套附件校验、暂存、可用性检查或 cleanup 规则。本架构切片只定义模块责任和依赖边界，不定义具体 upload API、文件类型全集、文件解析算法或存储 schema。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 附件由后端可信校验

- **WHEN** Web/LUI channel 接收用户随问题提交的附件
- **THEN** channel adapter 把 upload input 和当前 owner scope 交给 `agent-attachment-runtime`
- **AND** `agent-attachment-runtime` 保留数量、大小、类型、可读性、损坏文件、密码保护、暂存和 safe metadata extraction 的接入位置
- **AND** 任一附件未通过后端可信校验时，请求不得进入 Agent execution

#### Scenario: Request acceptance 校验附件引用

- **WHEN** runtime 接受带 attachment refs 的 request、retry 或 edit-resubmit
- **THEN** `agent-runtime` 通过 `agent-attachment-runtime` 校验 refs 的 owner、availability 和 safe descriptor
- **AND** `agent-context-engine` 只能消费 attachment refs、安全 descriptor、摘要或受控内容引用，不直接读取任意上传文件路径

#### Scenario: 附件 cleanup 不绕过 owner scope

- **WHEN** explicit attachment cleanup 或 attachment lifecycle 释放附件相关存储
- **THEN** cleanup 必须通过 `agent-attachment-runtime` 和 platform gateway owner-scoped operations 执行
- **AND** cleanup outcome 进入 audit boundary 的接入位置

### Requirement: [TS] Memory Lifecycle 边界

TS 后端 MUST（必须）通过 `agent-memory` 承载长期记忆、自学习、记忆生命周期和长期记忆检索的架构边界。后续 memory changes 启用长期记忆时，Context Engine 可以请求 owner-scoped 长期记忆检索结果并按 query policy 使用，但不得直接实现长期记忆抽取、promotion、decay、curation、dreaming 或 memory storage behavior。本架构切片不定义具体 memory contract、memory schema、抽取算法、检索 ranking、记忆管理 API 或后台调度策略。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Context Engine 只消费可披露记忆

- **WHEN** 后续 memory change 使 `agent-context-engine` 需要把长期记忆纳入模型输入
- **THEN** 它通过 `agent-memory` public boundary 或 gateway memory contract 获取 owner-scoped 长期记忆检索结果
- **AND** context assembly 仍负责 window budget、language/locale、query policy 和 disclosure control
- **AND** `agent-context-engine` 不直接导入 memory implementation private paths

#### Scenario: Memory lifecycle 不阻塞 terminal commit

- **WHEN** 交互、执行结果或后台任务触发自学习、知识抽取、promotion、decay、curation 或 dreaming
- **THEN** 这些行为属于 `agent-memory` lifecycle boundary
- **AND** 失败不得破坏 request terminal durable-write boundary
- **AND** 写入 memory gateway 时必须携带 owner scope 和 audit refs 的接入位置

#### Scenario: Memory provider 实现不泄漏

- **WHEN** 本地运行或 PaaS 部署选择不同 memory store、retrieval provider 或 learning implementation
- **THEN** provider details 保持在 `agent-memory` 或 platform gateway adapter 内部
- **AND** context、runtime、channel、core 和 contracts 不依赖具体 store driver、index SDK 或 extraction algorithm type

### Requirement: [TS] Capability 分类和 Agent capability 边界

TS 后端 MUST（必须）把 Capability 作为可执行能力的上位概念。Tool、Skill、Agent 都是 Capability 类型或由后续 capability change 定义的能力子类，不得在架构文档中被建模为与 Capability 平级的独立执行体系。Agent capability 表示由当前 Agent 调用的另一个 Agent，可以是本地 SubAgent，也可以是远端 Agent。Agent capability 调用必须通过 capability boundary 接入，并继续受 runtime lifecycle、cancellation、timeline、terminal commit 和 observability 边界约束。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Capability taxonomy 不重复建模

- **WHEN** 架构文档描述可执行能力
- **THEN** 它使用 Capability 表达统一发现、选择、调用、事件和审计边界
- **AND** Tool、Skill、Agent 只作为 Capability 类型出现
- **AND** 文档不得把 Tool 和 Capability 写成两个互相竞争的执行抽象

#### Scenario: Agent capability 不拥有独立 runtime lifecycle

- **WHEN** 后续能力需要调用另一个 Agent 作为 Agent capability
- **THEN** Agent capability invocation 通过 `agent-capability` 的 public boundary 接入
- **AND** request lifecycle、cancellation、timeline ordering、terminal visibility 和 audit 业务标识关联仍由 `agent-runtime` 负责

### Requirement: [TS] Capability 生命周期边界

TS 后端 MUST（必须）把 Capability 的 registration、agent-scoped discovery、prompt/context disclosure、invocation、result consumption 和 audit/recovery 建模为不同架构阶段。Source/provider 只能贡献 descriptor、metadata 或 provider factory；Agent 配置和可用条件决定最终可用清单；Tool、Skill、Agent capability 必须通过各自 public invocation boundary 执行；能力结果进入后续模型上下文、会话历史、审计、归档或恢复状态时，必须通过 runtime、context、session 或 gateway 的显式边界处理。本架构切片不得定义具体 capability schema、业务工具参数、Skill 内容格式全集或远端 Agent 协议。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Registration 不泄漏执行实现

- **WHEN** TS 后端骨架从内置包、插件包、本地目录、Agent 配置、SkillHub、MCP Server、AgentRegistry、客户导入或运营商注入来源引入 capability
- **THEN** registration boundary 只把 descriptor、source metadata、availability metadata 或 provider factory 放入 catalog
- **AND** catalog 不保存 provider SDK object、远端 client object、脚本执行器实例或 Web framework object

#### Scenario: MCP Tool 作为远端 Tool source

- **WHEN** Agent assembly 启用 MCP Server source
- **THEN** MCP tool descriptor 通过 platform gateway 和 capability catalog 进入 Tool capability discovery
- **AND** MCP tool 仍按 ToolExecutor、capability governance、timeline、audit、timeout、cancellation 和 degradation boundary 执行
- **AND** MCP source 不得创建独立于 Tool capability 的第二套 prompt disclosure 或 invocation 语义

#### Scenario: 外部 API 调用作为 Tool 场景

- **WHEN** Skill、Agent routing policy 或模型驱动 loop 需要调用 NMS、网管、OSS/BSS 或客户既有 HTTP API
- **THEN** 该调用必须作为 API-backed Tool 进入 Tool capability boundary
- **AND** Skill 调用此类 API 时仍表现为 Skill 调用 Tool，经 ToolExecutor、credential/auth、timeout、safe error、gateway policy、timeline 和 audit boundary 处理
- **AND** retry、rate-limit handling 和具体 HTTP schema 由后续 capability change 定义
- **AND** API-backed Tool 不得创建独立于 Tool capability 的 Skill HTTP 执行通道

#### Scenario: 非内置 Skill 使用统一 source 模型

- **WHEN** 本地目录、Agent 配置、SkillHub、客户导入或运营商注入等来源引入 Skill
- **THEN** 该 Skill 作为 Skill source 进入统一 registration/catalog 生命周期
- **AND** descriptor 保留 tenant/customer ownership、source identity、version、审核状态、启用范围、优先级和冲突诊断的接入位置
- **AND** 该 Skill 不得创建独立于 SkillTool、sandbox、policy、capability governance、timeline 或 audit 的第二套执行机制

#### Scenario: Discovery 生成 Agent 作用域清单

- **WHEN** 一个 Agent 被 `agent-app` 装配为 runtime-ready assembly
- **THEN** discovery boundary 根据 Agent configuration、enabled sources、allowed kinds、routingTags、language/locale、availability、source priority 和 conflict policy 生成该 Agent 当前可用 capability 清单
- **AND** 不可用、冲突、被禁用或 source 不可达的 capability 不得静默进入模型上下文

#### Scenario: Prompt disclosure 受预算和阶段约束

- **WHEN** Context Engine 为一次模型调用渲染 capability 信息
- **THEN** Tool 以 tool schema 或等价模型工具描述进入模型输入
- **AND** Skill 先以轻量 listing 进入模型输入，完整内容必须通过 SkillTool 或后续 capability change 定义的按需加载边界进入
- **AND** Agent capability 以可委托目标说明进入模型输入
- **AND** prompt/context disclosure 必须保留预算、去重、阶段和主上下文污染控制的接入位置

#### Scenario: Invocation、结果消费和恢复边界一致

- **WHEN** Agent 调用 Tool、Skill 或 Agent capability
- **THEN** Tool 通过 ToolExecutor 执行，Skill 通过 SkillTool 进入 inline 或 fork 边界，Agent capability 通过 Agent capability executor 执行
- **AND** timeout、cancel、concurrency、event、safe error、audit、checkpoint 和 idempotency 由统一 governance boundary 保留
- **AND** 能力结果进入后续模型上下文、会话历史、审计、归档或恢复状态时，必须通过显式 result consumption boundary
- **AND** fork Skill 和 Agent capability 不得默认把完整中间上下文写回主 Agent 上下文

### Requirement: [TS] Agent 内部 Request Routing 边界

TS 后端 MUST（必须）把 request routing 放在 Agent 接口之后、Agent 内部。`agent-runtime` 只负责请求生命周期、admission、same-session lane、cancellation、checkpoint、timeline 和 terminal commit；`agent-core` 在 Agent boundary 内根据 AgentAssembly 绑定的 routing policy 选择 deterministic flow、model-driven loop、clarify、reject 或 human handoff。本架构切片不得定义具体路由规则、业务流程或规则库格式。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Runtime 不做业务语义路由

- **WHEN** Web/LUI channel 提交一个 request
- **THEN** `agent-runtime` 接受并管理该 RequestRun
- **AND** `agent-runtime` 调用 Agent boundary
- **AND** `agent-runtime` 不根据电信业务语义、SOP 名称、规则命中或模型意图直接选择执行路径

#### Scenario: Agent routing policy 选择处理路径

- **WHEN** Agent 接收到 normalized request、AgentAssembly、语言上下文、能力视图、session/context summary 和 risk hints
- **THEN** Agent 内部 routing policy 产生 routing decision
- **AND** decision 只能选择 deterministic flow、user-directed Skill flow、model-driven loop、clarify、reject 或 human handoff 这类架构路径
- **AND** deterministic flow 和 model-driven loop 的具体行为由后续 OpenSpec change 定义

#### Scenario: 显式处理约束不绕过治理边界

- **WHEN** 用户或上游入口为请求提供显式处理约束
- **THEN** Web channel 和 runtime 只传递 typed request 和 request metadata
- **AND** Agent routing policy 校验该约束是否在当前 Agent、tenant、subject、language/locale、source/version、availability 和 policy 条件下可用
- **AND** 通过校验时才选择相应 Tool、Skill、Agent capability 或 deterministic flow 边界
- **AND** 不可用、无权限、冲突、版本不可接受或 source 不可信时返回可解释拒绝或降级
- **AND** 该路径不得绕过 discovery、capability governance、sandbox、timeline 或 audit boundary

#### Scenario: Routing decision 可观测和可审计

- **WHEN** routing policy 做出路径选择
- **THEN** decision evidence 进入 runtime timeline 和 audit boundary
- **AND** evidence 至少保留 policy identity/version、命中或未命中原因、选择路径、fallback 原因和风险提示的接入位置

### Requirement: [TS] Model provider adapter boundary

TS 后端 MUST（必须）通过 `agent-model` 适配不同模型 provider 的差异。`agent-model` 负责模型 profile、请求归一化、stream normalization、tool-use 片段归一化、fallback 结果和 safe provider error mapping。Provider SDK、Vercel AI SDK、LangChain、OpenAI-compatible client 或平台 ModelGateway 可以作为 adapter 内部实现选择，但不得成为跨 package public contract。ModelGateway 表示 PaaS 平台提供的推理网关；当配置选择推理网关路径时，`agent-model` 通过 gateway contract 调用它。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Model provider SDK 不泄漏到核心模块

- **WHEN** `agent-core`、`agent-runtime`、`agent-context-engine` 或 `agent-contracts` 调用模型能力
- **THEN** 它们只依赖 NextAgent model contracts 或 `agent-model` public boundary
- **AND** provider-native request、response、stream chunk、error type、SDK client 或 ModelGateway 调用细节不得泄漏到这些 package

#### Scenario: Model stream 被归一化

- **WHEN** 模型 provider 返回流式 thinking、content、tool-use 或 error 片段
- **THEN** `agent-model` 把这些片段转换为 NextAgent 的模型事件或结果边界
- **AND** 具体 event payload 由后续 OpenSpec change 定义

### Requirement: [TS] 模块间数据流说明

TS 后端架构 design MUST（必须）包含模块间数据流图，说明 Web/LUI channel、runtime、session、attachment runtime、context engine、memory、core、model、capability、gateway、sandbox execution boundary、observability 之间的交互方向。数据流图只表达架构责任和边界，不得定义具体 API route、stream payload、runtime state machine、gateway data model 或数据库表结构。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Design 包含数据流图

- **WHEN** 评审 TS 后端架构 design
- **THEN** design 包含模块间数据流图
- **AND** 数据流图覆盖 request command flow、identity/owner scope propagation、attachment validation flow、Agent 内部 request routing flow、context/memory/model/capability invocation flow、sandbox execution flow、human interaction pending flow、timeline event flow 和 observability signal flow
- **AND** 数据流图不提前定义后续业务 capability 的具体 contract

### Requirement: [TS] Package 边界强制

TS 后端 MUST（必须）用 TypeScript project references、package `exports` 和 automated dependency graph checks 强制 package 边界。Architecture verification 必须拒绝 upward dependencies、contract-to-implementation dependencies、framework leakage into `agent-contracts` 和 cross-package private imports。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Contract package 不能导入实现

- **WHEN** `agent-contracts` 导入 runtime、channel、app、local gateway、remote gateway、model implementation、capability implementation、PaaS sandbox SDK、Fastify、SQLite、Kysely、OpenTelemetry SDK 或 provider SDK packages
- **THEN** architecture verification command 失败

#### Scenario: Private imports 被阻止

- **WHEN** 一个 package 通过 `../other-package/src/*` 或任何非 exported path 导入另一个 package
- **THEN** architecture verification command 失败

### Requirement: [TS] 整模块替换边界

TS 后端 MUST（必须）支持对选定 adapter 或 provider responsibility 进行 whole-package replacement。替换 package 必须实现 public contracts，通过 package `exports` 暴露 provider factory，并由 `agent-app` explicit composition 选择。本架构切片不得要求 dynamic runtime loading、hot swapping、remote implementation loading，也不得要求 private imports into existing implementation packages。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 替换 package 使用 public contracts

- **WHEN** 开发者添加 replacement gateway adapter、channel adapter、capability provider、model provider adapter、observability sink 或后续定义的 adapter/provider package
- **THEN** 该 package 只依赖 `agent-common`、`agent-contracts` 和 approved adapter-local libraries
- **AND** 它通过 package `exports` 暴露 provider factory
- **AND** `agent-app` 通过 explicit composition 或 typed configuration 装配它

#### Scenario: 替换 package 不能依赖实现内部

- **WHEN** replacement package 通过 private source path、internal type、global singleton 或 startup side effect 导入现有 implementation package
- **THEN** architecture verification 失败

#### Scenario: 第一阶段限制替换范围

- **WHEN** 开发者需要 marketplace-style package discovery、dynamic runtime loading、hot swap、remote implementation loading、version negotiation、signature validation 或 rollback lifecycle
- **THEN** 该行为必须先由后续 OpenSpec change 定义，再进入实现

### Requirement: [TS] Runtime Kernel Ownership

TS runtime kernel MUST（必须）拥有 request submit、cancel、retry、edit、scheduling、same-session lane policy、latest-request handling、checkpoint recovery boundary、lifecycle hooks boundary、terminal commit boundary 和 canonical timeline event publication。Channel、core、context、capability、model、gateway 和 app packages 不得创建与之竞争的 request lifecycle state machine。

Lifecycle hooks boundary MUST（必须）为 request accept、planning、model invoke、model result、capability invoke、capability result、context compact 和 terminal event 这些关键边界保留阶段位置。具体 Hook schema、mutation policy、failure mode、执行顺序和 extension API 由后续 OpenSpec change 定义；本架构切片只确保 runtime 是 Hook lifecycle owner，且 Hook 不拥有 RequestRun、checkpoint、terminal commit 或 channel state。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Web command 进入 runtime

- **WHEN** Web request 提交、取消、重试或编辑一个请求
- **THEN** Web channel adapter 调用 runtime command boundary
- **AND** 它不得直接创建 request lifecycle state、写入 terminal conversation history 或执行 hosted Agent loop

#### Scenario: 终态可见性遵循 durable commit boundary

- **WHEN** Agent execution 产生 final result
- **THEN** client-visible terminal stream events 和 visible conversation history 只能在 runtime terminal durable-write boundary 成功后出现

### Requirement: [TS] 本地与 PaaS 运行形态边界

TS 后端 MUST（必须）保留两种交付形态的架构边界：首版本地 release 可只交付本地单实例运行包，后续 PaaS 多实例服务部署必须沿用同一 runtime/gateway contracts。本地运行态只承诺单实例进程重启恢复；PaaS 运行态后续启用时正确性不得依赖 process-local memory、单实例 scheduler 或 sticky session，必须通过共享 RequestRun、checkpoint、pending input、timeline、terminal commit state、lock/lease、CAS/version 和 idempotency boundary 保证故障接续与终态一致性。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 本地运行包使用单实例恢复边界

- **WHEN** NextAgent TS 后端以本地运行包启动
- **THEN** runtime、session、gateway 和 app contracts 支持单实例进程重启后的 RequestRun/checkpoint/terminal state 恢复
- **AND** 本地运行态不得声明多实例集群调度或跨进程接管保证

#### Scenario: PaaS 多实例故障接续后续启用时不依赖 sticky session

- **WHEN** 后续 change 启用 PaaS 多实例部署，且其中一个实例在 active RequestRun 执行期间故障
- **THEN** 其他健康实例可以基于共享 RequestRun、checkpoint、pending input、timeline、lock/lease、version 和 terminal commit state 接续、取消或安全终止该请求
- **AND** channel reconnect、stream resume、cancel、retry 和 history query 不要求回到原实例
- **AND** runtime 不得以进程本地内存作为请求生命周期、latest-request policy、terminal visibility 或审计事实的唯一权威来源

#### Scenario: 副作用能力恢复必须尊重幂等声明

- **WHEN** PaaS 多实例恢复路径遇到已经开始执行的 Tool 或 Agent capability 调用
- **THEN** runtime recovery boundary 使用 checkpoint 和 capability idempotency declaration 判断是否可以重放、等待结果、标记未知或安全失败
- **AND** 未声明可安全重放的副作用能力不得被恢复逻辑盲目重复调用

### Requirement: [TS] 会话状态边界

TS 后端 MUST（必须）为 session/message/read model、history consistency、active RequestRun、pending input、human handoff 和 owner scope 保留统一状态访问边界。会话相关历史、RequestRun、checkpoint、timeline、附件、artifact、summary refs 等状态访问必须通过 session/runtime/gateway boundary 处理；其他 package 不得绕过 owner scope 直接读取或改写会话状态。本架构切片不定义会话保留期、过期、自动清理、后台调度或数据库 schema。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 会话状态读取通过 session/gateway 边界执行

- **WHEN** channel、runtime、context 或 history query 需要读取 session、message、RequestRun、checkpoint、timeline、attachment、artifact 或 summary refs
- **THEN** 它们必须通过 session/runtime/gateway public contract 访问
- **AND** 访问必须携带 tenant/subject owner scope

#### Scenario: 活跃或挂起会话受保护

- **WHEN** 会话包含 active RequestRun、pending input、human handoff 或 terminal commit 未完成的请求
- **THEN** session/read model、stream projection 和 recovery boundary 必须能看到同一可恢复状态
- **AND** 其他 package 不得私自改写或丢弃该状态

#### Scenario: 存储实现不泄漏到上层

- **WHEN** 本地运行或 PaaS 部署选择不同 session store、timeline store、artifact store 或 summary store
- **THEN** `agent-session`、runtime、context 和 channel 只依赖 logical gateway contracts
- **AND** logical gateway contracts that require stable persistence shapes MUST expose gateway-owned `*Record` persistence DTO/PO rather than upper-layer domain objects
- **AND** SQLite、远端存储、对象存储、summary store 或 driver-specific record 的物理细节不得泄漏到这些 package

### Requirement: [TS] Human Interaction 统一边界

TS 后端 MUST（必须）通过统一 human interaction pending boundary 表达智能体与人的主动交互。模型、hook、policy、Tool、Skill、Agent capability 或 runtime 发起的澄清、确认、授权、选择和人工接管，都必须进入同一个 runtime-owned pending input 边界；不得因为发起方不同而创建互相竞争的交互状态机，也不得创建新的 root request。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 不同发起方使用同一 pending input

- **WHEN** model、hook、policy、Tool、Skill、Agent capability 或 runtime 需要用户澄清、确认、授权、选择或人工接管
- **THEN** 发起方发布 typed human interaction request
- **AND** `agent-runtime` 把当前 RequestRun 挂起到 pending input boundary
- **AND** channel 只投影该 pending input，不拥有独立交互状态机

#### Scenario: Hook 高危检查触发确认

- **WHEN** lifecycle hook 或 policy 判断一个能力调用属于高风险操作
- **THEN** 它通过 human interaction boundary 请求确认或授权
- **AND** 确认结果回到同一个 RequestRun、checkpoint、timeline 和 audit chain

#### Scenario: 人工接管保持可恢复

- **WHEN** Agent 判断问题无法处理、风险过高或外部依赖不可用
- **THEN** RequestRun 可以进入 human handoff pending state
- **AND** PaaS 多实例恢复、stream reconnect 和 history query 看到同一 pending/handoff 事实

### Requirement: [TS] Bounded Parallel Execution 边界

TS 后端 MUST（必须）为后续有边界的并行执行保留治理边界。首版可以保持单个 RequestRun 内串行执行；后续若启用 Agent、deterministic flow、Tool、Agent capability、检索或其他外部 IO 分支并行，必须显式表达依赖图、并发预算、取消传播、超时、checkpoint、事件排序和结果聚合边界；不得使用无法治理的隐式 Promise fanout。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Capability 分支启用并行时受治理

- **WHEN** 后续 change 允许 Agent 或 deterministic flow 并行执行多个 Tool、Skill、Agent capability 或 retrieval branches
- **THEN** 它们可以通过 bounded parallel execution boundary 并行运行
- **AND** 每个分支仍遵守 runtime cancellation、timeout、checkpoint、capability governance 和 observability

#### Scenario: 并行结果聚合可解释

- **WHEN** 后续 change 启用的多个并行分支完成、失败、超时或被取消
- **THEN** aggregation boundary 生成确定性的结果顺序、失败摘要和可追踪 evidence
- **AND** terminal result、timeline、audit 和后续 context consumption 不依赖不可复现的完成顺序

#### Scenario: 并行不绕过 session lane

- **WHEN** 后续 change 允许同一 RequestRun 内部存在并行分支
- **THEN** 并行只发生在该 RequestRun 的执行内部
- **AND** same-session lane、latest-request policy 和 terminal commit 仍由 `agent-runtime` 统一控制

### Requirement: [TS] Sandbox Execution 边界

TS 后端 MUST（必须）通过 sandbox execution gateway boundary 执行 shell、python、脚本、模型生成代码和其他动态可执行内容。Capability、hook、policy、Agent loop 或 provider package 不得直接绕过 sandbox gateway 使用宿主进程权限、任意文件系统、网络、环境变量、凭据或无限资源。PaaS 部署由 platform gateway adapter 对接平台 sandbox；本地运行态可以提供明确的 unavailable/deny-by-default 或受限占位实现。Public contract 必须一致，具体 PaaS SDK 或隔离机制不得泄漏到核心模块。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 动态可执行内容必须进入 sandbox

- **WHEN** Tool、Skill-owned script、hook、policy 或模型生成代码需要执行 shell、python、脚本或动态命令
- **THEN** 调用方必须通过 sandbox gateway public boundary 提交 sandbox execution request
- **AND** 调用方不得直接使用 child process、shell、Python runtime、宿主文件系统或宿主环境变量作为跨 package 行为

#### Scenario: Sandbox contract 约束资源和权限

- **WHEN** sandbox execution request 被创建
- **THEN** request 必须保留文件系统范围、网络策略、环境变量、凭据注入、工作目录、超时、CPU/内存、输出大小和 redaction policy 的接入位置
- **AND** sandbox gateway 返回 normalized result、safe error、resource usage 和 audit refs

#### Scenario: Sandbox gateway 可替换但不泄漏

- **WHEN** 本地运行或 PaaS 部署选择不同 gateway adapter
- **THEN** `agent-app` 通过 explicit composition 装配 local 或 remote platform gateway
- **AND** provider-specific SDK、容器 API、OS isolation API 或 PaaS sandbox API 不得泄漏到 `agent-contracts`、`agent-core`、`agent-runtime` 或 `agent-capability`

### Requirement: [TS] Adapter Ownership

TS 后端 MUST（必须）把 transport、persistence、remote service、model provider、capability implementation、authentication 和 observability integrations 隔离在 adapter packages 后面。Adapter packages 必须把外部库行为转换成稳定的 NextAgent contracts，且不得向 core packages 暴露 provider-native errors、secrets、local paths、framework request objects、model SDK objects 或 driver-specific records。Gateway-owned `*Record` DTO/PO 是 logical gateway contract 的稳定数据形态，不等同于 adapter driver-specific records。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: Persistence 保持在 gateway adapter 内部

- **WHEN** TS local runtime state 被持久化
- **THEN** SQLite access 由 local platform gateway adapter 负责
- **AND** runtime、session、context、channel 和 core packages 只依赖 logical gateway contracts

#### Scenario: Transport framework 被隔离

- **WHEN** Fastify 处理 HTTP、SSE 或 WebSocket requests
- **THEN** Fastify request/reply objects 保持在 Web channel adapter 内部
- **AND** lower-level packages 只接收 typed command/query objects

### Requirement: [TS] 结构化日志边界

TS 后端 MUST（必须）通过 `agent-observability` 提供统一 structured logging helper 和 redaction boundary。该 helper 使用 Pino child loggers、AsyncLocalStorage request/run context、safe error shape 和 redaction policy 生成结构化 JSON 日志；runtime、channel、gateway、capability、core 和 app packages 不得直接依赖散落的 `console.*` 作为可维护性诊断入口，也不得把 tracing/metrics SDK 类型暴露为核心契约。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 日志包含稳定诊断字段

- **WHEN** package 记录 request、runtime、gateway、capability 或 terminal commit 相关日志
- **THEN** 日志通过 `agent-observability` structured logging helper 输出
- **AND** 日志包含 stable event name、severity、timestamp、service/package context、trace id 和安全业务标识字段
- **AND** 日志使用 safe error shape 表达错误

#### Scenario: 日志不得泄漏敏感或高噪声内容

- **WHEN** 日志记录请求、模型、工具、gateway、stream 或配置相关事件
- **THEN** 日志不得包含 prompt text、model output content、stream deltas、raw provider errors、local paths、credentials、tokens、user-uploaded content 或 high-cardinality object dumps

#### Scenario: Web request logging 复用统一日志边界

- **WHEN** Fastify 处理 HTTP、SSE 或 WebSocket requests
- **THEN** Web channel adapter 使用 Pino-compatible logger
- **AND** request log 与 runtime request/run context 可以关联
- **AND** Fastify logger 类型不得泄漏到 `agent-contracts`

### Requirement: [TS] 架构验证门禁

TS 后端 MUST（必须）提供可重复执行的命令，用于验证 package compilation、runtime schema contract tests、runtime skeleton characterization tests、package boundary rules 和 architecture skeleton smoke tests。这些命令必须作为本架构切片的 acceptance gate。

设计入口：`openspec/changes/establish-ts-backend-architecture/design.md`

#### Scenario: 架构门禁可在本地运行

- **WHEN** 开发者从仓库根目录运行 TS 后端验证命令
- **THEN** TypeScript project references 可以编译
- **AND** runtime schema/contract tests 被执行
- **AND** runtime skeleton characterization tests 被执行
- **AND** package dependency rules 被检查

#### Scenario: 边界检查失败会阻止完成

- **WHEN** architecture verification 检测到 forbidden dependency、private import、missing runtime schema 或 framework leakage into `agent-contracts`
- **THEN** TS 后端架构任务未完成
