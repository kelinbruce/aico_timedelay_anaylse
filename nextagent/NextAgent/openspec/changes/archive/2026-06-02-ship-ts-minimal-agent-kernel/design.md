## 背景和现状（Context）

TS 后端的架构边界和核心契约已经作为前置 change 实现。本变更不重新定义 port signature 或 event vocabulary，而是在这些契约上交付最小可运行 Agent 问答内核。本变更同时定义产品化 package 内部源码目录结构，避免最小内核以 demo 风格单文件实现作为后续 change 的默认形态。唯一核心契约 refinement 是 user session contract 收敛：public Web alias 只属于 channel，runtime 拥有 Agent Scope resolution，`agent-session` 暴露领域 `UserSessionPort`，gateway/session contract 使用 owner+agent scoped internal fields 和 before-cursor 语义。

相关方包括 runtime/session、Web channel、Agent core/context、model/capability、gateway/observability、app composition 和测试/发布团队。设计分册如下：

- [runtime-channel-session.md](designs/runtime-channel-session.md)：submit、runtime lifecycle、session/message/history、timeline/stream、terminal commit。
- [core-context-model-capability.md](designs/core-context-model-capability.md)：Agent loop、context render、model invocation、capability invocation shape 和当前 read capability。
- [app-gateway-observability.md](designs/app-gateway-observability.md)：composition、gateway adapter、no-op hook/checkpoint/audit、safe error。
- [scope-boundaries.md](designs/scope-boundaries.md)：real、minimal、noop、deferred 的范围控制和后续 change 边界。
- [module-structure.md](designs/module-structure.md)：每个 package 的产品化 `src/` 目标目录结构、`index.ts` public barrel 约束和 architecture guard。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 交付 Web submit/session route -> runtime session/request facade -> runtime-owned Agent Scope resolution -> agent-session -> runtime -> Agent core -> context -> model -> optional enabled capability invocation（当前产品只暴露 read）-> timeline/SSE -> terminal commit -> history 的最小闭环。
- 所有跨模块调用只使用 `agent-common` 和架构授权的 `agent-contracts/<subpath>` public exports；除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 不得依赖其它 implementation package。
- Runtime 拥有 request lifecycle、Agent assembly version binding、single-run dispatcher/scheduler、canonical timeline 和 terminal commit。
- Runtime 在最小范围内保证同一 session active `RequestRun` 不并发串写；同 session 已有 active run 时，新 submit 返回 safe conflict/rejection，不创建 queued run；FIFO lane、scheduler queue、latest-submit replacement 和 terminal-pending 保护由 `add-ts-session-lane-scheduling` 承接。
- Channel 只做 HTTP/SSE transport、runtime facade 调用、Web DTO schema/projection 和 stream projection；不得直接调用 `agent-session`、gateway store 或自定义 session port。
- Web API 冻结已确认最小 route table，并额外提供 TS convenience submit route。
- 非 no-op 的范围内功能按本 change 明确列出的接口、状态机、schema、stream event、gateway query、owner scope 和验证项实现。
- Web submit/session route -> runtime session/request facade -> runtime-owned Agent Scope resolution -> agent-session -> runtime -> Agent core -> context -> model -> enabled capability invocation（当前产品只暴露 read）-> follow-up model -> timeline/SSE -> terminal commit -> history 主流程实际经过的路径必须满足本 change 对应的可验收规格；不在该主流程路径上的能力不得半实现，只能按 no-op、disabled descriptor 或 unavailable safe outcome 处理。
- Context render 携带 locale/language hint 和电信术语原文保留约束。
- 产品路径提供固定 OpenAI provider，并通过共享 model profile shape 注入配置。
- 产品配置使用 `Config/Resources/ResourceProviders/Plugins -> AgentDefinition -> app-internal assembly compiler -> AgentAssemblyRegistry -> app composition` 的唯一启动路径；当前主路径只选择一个已启用 OpenAI profile 和内置 read binding，但配置所有权必须区分 system/component 配置、Agent 业务配置、资源注册和 runtime-safe assembly，不得用一个 `SystemConfig` 总对象承载全部配置。
- Agent core 使用通用 capability catalog/invocation 形态处理已启用 tool calls；当前产品 assembly 只暴露 read tool，read 只支持 workspace-relative 单文件切片读取，多个 read tool calls 按出现顺序串行执行且受上限约束。
- 模型 delta、capability result message 或 terminal assistant message 命中硬安全大小/长度上限时，必须发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束；read capability 的 line-based bounded slice 使用 `truncated=true`/`nextOffset` 表达正常切片，不作为静默截断。
- Hook、checkpoint、audit 作为一层直接依赖必须在主流程调用，并装配默认 no-op provider。
- 内部 cancellation propagation 覆盖 runtime、core、model、capability 和 stream delivery 慢边界；这些边界统一接收并传播 `AbortSignal`；触发源限定为内部 timeout、server shutdown、测试注入 abort 和 transport disconnect cleanup。Gateway public port 保持 async；当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort。远程、长耗时或可取消的 Gateway cancellation、用户可见 cancel route、cancel runtime command、持久化 canceled terminal state 和 request-control 状态机 deferred。
- 每个核心 implementation package 必须按 `module-structure.md` 的目标结构交付；`src/index.ts` 只能作为 public barrel 或明确允许的轻量 composition export，不能承载主业务流程、adapter、schema validation、state machine 或 gateway 实现。
- 提供可重复验证路径，覆盖正向主流程、负向安全/一致性 case 和 architecture boundary。

**非目标：**

- 不实现附件、长期记忆、多 tool set、多 Skill source、远端 Agent、多 provider fallback、WebSocket、完整取消/重试/编辑用户能力、多实例 lease/recovery、真实 checkpoint recovery、完整 glossary/语言检测/双语评测集、容量/SLA benchmark；output continuation flow 不属于本 change。
- 不新增核心契约以外的竞争性 DTO、port、status、stream event 或 gateway record。
- 不把 no-op 扩展为真实 hook/checkpoint/audit 落库。

## 设计决策（Decisions）

### 1. 最小内核只展开问答主流程的一层直接依赖

选择：本 change 只实现一次问答成立所需的一层直接依赖。Web submit 到 terminal/history 的主流程实际经过的行为必须按本 change 的 spec、接口目标矩阵和任务验证项真实实现；影响问答结果、流式可见性、终态一致性、用户可操作状态或安全边界的行为不得 no-op、mock 或半实现。不在该主流程路径上的能力不得为了便利性局部实现，只能以 no-op、disabled descriptor 或 unavailable safe outcome 表达；hook、checkpoint、audit 在本 change 的主流程上只保留调用点和默认 no-op provider，不拥有问答结果或终态事实。

理由：最小内核的价值是验证核心契约和运行主链路。若把附件、memory、完整 replay/recovery、WebSocket 和多 Skill source 一并纳入，会让 terminal correctness 和 contract 对齐难以审查。

放弃方案：按模块引用关系递归补齐全部依赖。该方案会扩大范围，并把多个后续 change 的行为混入最小内核。

### 2. Runtime 是唯一 request lifecycle owner

选择：`agent-runtime` 负责 session/request admission、runtime-owned Agent Scope resolution、RequestRun 创建、同 owner+agent+session active run 冲突检测、Agent assembly 固化、single-run dispatcher/scheduler、canonical timeline、execution message append、terminal commit 和 failure normalization。当前 dispatcher 只调度已持久化、assembly 已固化且未进入 terminal 的 accepted run；启动前必须用 `RequestRunRecord + { expectedVersion }` 将同一 run 从 `status=ACCEPTED` CAS 推进到 `status=EXECUTING`，CAS 未更新时不得调用 Agent，从而防止同一 run 被重复启动。成功进入 `EXECUTING` 后，dispatcher 向 `Agent.execute(run, context, timeline, messages, signal)` 传入 runtime-owned timeline/message ports 和 `AbortSignal`，并把 resolve/reject 归一化到 terminal commit 或 safe failure path。`agent-core` 不返回终态内容，不直接写 gateway message record；`agent-channel-web` 不写终态历史，也不直接创建或查询 session。Runtime session facade 在解析 trusted Agent Scope 后委托 `agent-session` 的领域 `UserSessionPort` 创建、校验、列出 session 和读取 conversation。同一 owner+agent+session 已有 active run 时，新 submit 直接返回 safe conflict/rejection，不持久化 queued run，不启动第二个会写 terminal/history 的执行。

理由：终态唯一性、history consistency 和 stream terminal visibility 必须来自同一个事实源。最终 agent message 通过 timeline 发布，runtime 决定 terminal lifecycle event。

放弃方案：让 Agent 返回 final answer 并由 channel 写 history。该方案会形成 competing lifecycle state machine。

放弃方案：让 channel 直接依赖 `agent-session` 或在 channel 内自定义 session abstraction。该方案在 single hosted Agent 下可运行，但会把 Agent Scope selection 分散到 channel/session，multi hosted Agent 阶段会与 runtime-owned agent routing 冲突。

唯一实施路径：

```
agent-channel-web
  -> agent-runtime session/request facade
  -> runtime internal Agent Scope resolver
  -> agent-session UserSessionPort
  -> gateway owner+agent scoped records
```

该路径是 session create、session list、conversation history、convenience submit 和 session-scoped submit 的唯一产品路径。历史路径必须清理，而不是通过兼容 shim、deprecated alias 或二次包装保留：包括 channel 直连 session implementation、channel-owned session abstraction、owner-only session lookup、parallel session history API、public runtime agent routing contract、gateway-local row/entity 泄漏到上层等类别。T004/T005/T050/T051 中已完成的 route、DTO 和分页事实继续成立，但其中关于 channel 直连 session 或 owner-only session lookup 的实现描述由 T096-T102 覆盖。

架构用例按 AGENTS.md 验证门禁设计，但不为某个具体实现坏味道逐一新增命名级负例，也不约束私有调用顺序或内部 helper 形状。优先用正向、黑盒或 public-boundary 用例证明边界语义成立：Web API 的可观察结果符合 session create/list/conversation/submit 契约；runtime public boundary 接收可信 identity 并使用 trusted Agent Scope 产生 owner+agent scoped session/run 事实；session public contract 返回领域对象/read model；gateway public contract 要求 owner+agent scoped record/query。负向架构用例只覆盖类别级边界逃逸、非法依赖、testing fixture 泄漏、产品路径 mock/no-op 替代和 source-level forbidden pattern，并且必须由 dependency-cruiser、architecture tests 或 contract/API assertions 实际触发并断言失败；不得只用人工检查或“搜索确认”替代。source assertion 仅用于架构边界和 forbidden pattern，不用于锁死私有实现细节；行为正确性仍以 Web/runtime/session/gateway contract 和 characterization tests 覆盖。

### 2a. SQLite gateway-local 使用专用事实表和锚点幂等

选择：本 change 的 SQLite gateway-local 是最小内核的本地持久化基础底座，必须使用专用业务表承载主路径持久化事实，不允许用 `records(store,key,json)` 这类 generic business record store 承载 request run、session、message、active context、timeline event 或 checkpoint。每类事实表显式保存 owner scope 和主路径需要的 agent/session/request/run 坐标；JSON payload 可作为 row-to-record 映射实现细节保留，但不得替代列级 scope、排序、查询和唯一约束。

幂等原则固定为“锚点事实表优先”：每个幂等 write operation 必须定义一个锚点事实表；默认把 `idempotencyKey` 放在该锚点表上，并通过 trusted scope + 相关 agent/session/request/run 坐标建立 scoped unique index。重复 scoped key 返回首次锚点事实结果，不重复分配 sessionId、requestId/runId、messageId、timeline sequence、checkpointId、active context ordinal 或 terminal fact。session create 的锚点事实是 `sessions` row；accepted request run create 的锚点事实是 `request_runs` row。RequestRun 后续 `ACCEPTED -> EXECUTING`、`terminalCommitState -> PENDING` 和 diagnostic failure 更新是同一 run 事实的 version CAS state transition，不声明独立幂等 key，也不引入独立 operation store。本 change 不引入 `operationKind`，因为当前领域对象没有该字段；也不引入 request hash conflict detection，同 scoped key 的重复写返回首次结果。独立 idempotency 表/store 只允许在没有明确锚点事实表或幂等生命周期确实独立于业务事实生命周期时作为受控例外，且必须先写入本 change 的设计说明。

复合写入必须以 gateway composite write 和一个 SQLite transaction 保证整体语义。message append 的锚点事实是 `messages` row；runtime-owned append 写入 message、更新 session `updatedAt`、追加 active context item 时，必须调用 `SessionMessageStoreGateway.appendSessionMessage(record, options)`，重复 key 必须返回首次 messageId，并确保 active context 不因重试重复追加，也不因首次 message 已写入但 active context 未完成而永久缺失。最小内核的 public `SessionMessageStoreGateway` 只暴露 `appendSessionMessage` 这一种 message write，不暴露 standalone `saveMessage`，避免上层绕过 active context 事务。简单 gateway 写入使用 `Record + write options`；`idempotencyKey` 属于 command/write option，不进入 `*Record`；领域/application 层仍负责把 DO/internal state 映射成 gateway `*Record`。gateway contract 需要复用 owner scope 字段时使用 `OwnerScoped`，不得让 `*Record` 继承名为 `*Request` 的接口。跨多个 contract subpath 共用的 durable scalar vocabulary 由 `agent-common` 定义一次，例如 session message role/content/visibility、attachment media/status 和 pending input kind/status；gateway Record 直接引用 common vocabulary，不定义 `*RecordRole`/`*RecordType`/`*RecordKind`/`*RecordStatus` 副本，也不为了复用这些 vocabulary 依赖 `agent-contracts/session`、`agent-contracts/runtime` 或 `agent-contracts/attachment`。terminal commit 的锚点事实是 `request_runs` terminal state，且 terminal message 和 terminal timeline event 使用同一个 terminal commit key 写入各自事实表；terminal message、active context item、terminal timeline event 和 run terminal state 必须通过 `RequestRunStoreGateway.commitTerminal` 在同一个 gateway transaction 内写入。timeline append 的锚点事实是 `timeline_events` row；checkpoint save 的锚点事实是 `checkpoints` row。

理由：generic record store 会让业务事实、索引事实和 shadow row 混在同一个 list/query 面内，后续只能靠过滤规则补救，容易破坏 history、current request query、审计和迁移。专用表 + scoped unique index 能同时满足性能、可诊断性、owner/agent 隔离和幂等重试语义。锚点事实表优先避免为了幂等性创建平行事实源。

### 3. Assembly version 在 acceptance 时绑定

选择：Runtime 接受 request 时调用 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.active(agentId)`，将 resolved `agentId`、`agentVersion`、`agentAssemblyRef` 写入 `RequestRun` 和 `RequestContext`。接受后所有 core/context/capability/recovery 路径只用 `require(agentId, agentVersion)` 或 runtime 传入的 accepted assembly facts；不得重新读取 active/default Agent。

理由：电信运维请求可能持续较长时间。执行中切换 Agent active version 会破坏可审计性和恢复一致性。

放弃方案：每次 context 或 capability routing 都重新读取 active assembly。该方案会造成同一 RequestRun 内策略漂移。

### 4. 配置按输入面和所有权类实例化为 TS 启动模型

选择：TS 产品启动使用唯一配置路径：`Config/Resources/ResourceProviders/Plugins -> AgentDefinition -> app-internal assembly compiler -> AgentAssemblyRegistry -> app composition`。该路径按 TS 后端目标态分离 system/component config、Agent 业务装配、资源注册和 runtime-safe assembly：`agent-app` 统一感知配置来源，读取和校验内置文件与 env secret override，转换成内部组件构造参数、typed registries、ports 和 runtime-safe `AgentAssemblyRegistry`。下游系统组件不得读取配置文件和环境变量，也不得知道某个参数来自内置默认文件还是 env secret override。

本 change 尚未进入打包部署和本地运行阶段，实施要求必须收紧到唯一可执行方案。当前产品 composition 只读取两份内置配置文件：

| 文件 | owner | 内容 | 规则 |
|---|---|---|---|
| `packages/agent-app/config/default-system.yaml` | `agent-app/config` | active agent id、OpenAI model profile、credentialRef、SQLite local gateway path、local identity、channel/local auth mode、no-op boundary mode、workspace root | 只承载 system/component 默认选择；不得包含 Agent workspace binding、capability binding、provider raw secret、framework internal wiring |
| `packages/agent-app/config/default-agent.yaml` | `agent-app/assembly` | `default-agent` 的 agent identity/version、workspace ref、model/prompt refs、capability bindings、runtime settings、resource refs | 只承载默认 Agent 业务装配；不得包含 SQLite file、channel transport、gateway endpoint、owner identity、provider endpoint/secret |

本地运行包目录语义保留为后续打包 change 的黑盒目标：`bin/` 放启动/停止脚本，`backend/` 放运行时程序，`config/application.yaml` 放用户可编辑 system config，`config/agents/default-agent/agent.yaml` 放默认 Agent 模板，`data/system/` 放 SQLite 与平台数据，`logs/` 放日志，`run/` 放 PID/运行状态，`workspaces/` 放 Agent 授权工作区。该目标不进入本 change 的实施任务。

本 change 只消费问答主流程的最小直接依赖：内置默认 system config、内置默认 Agent config、active workspace、OpenAI model profile、SQLite local gateway path、no-op boundary provider selection。完整本地运行包 staging、用户可编辑配置生成、`bin/` 启停脚本、前端静态资源托管、`logs/`/`run/` 运行状态管理、附件/归档/upload-temp 目录初始化、升级保留策略和服务化 profile 不在本 change 中实现；这些只能作为目标目录语义和后续 change 边界被引用。

配置输入面必须分清：

| 输入面 | TS 实例化 | 本 change 最小目标 |
|---|---|---|
| `Config` | 内置 default-system 文件和 env secret override 只由 `agent-app` 读取；组件只接收内部构造参数和配置对象 | deployment/auth、active agent、paths root、OpenAI profile、SQLite local gateway、Fastify channel、no-op boundary options |
| `Resources` | 可被 Agent 引用的模型 profile、prompt template、capability descriptor、workspace/resource refs | 至少一个 enabled `OPENAI` model profile、默认 telecom prompt、内置 read descriptor |
| `ResourceProviders` | app composition 注册 built-in provider、内置 Agent config loader 和 model profile provider | 只启用 built-in read、OpenAI provider registry 和内置 Agent config loader |
| `Plugins` | 插件只贡献可发现定义，不直接改写 effective Agent assembly | 本 change 不启用动态插件加载；只保留禁止绕过 assembly compiler 的约束 |

配置所有权必须分清：

| 所有权类 | TS owner | 可以包含 | 不得包含 |
|---|---|---|---|
| 基础设施/adapter 配置 | `agent-app` config mapping + owning adapter internal constructor params | Fastify listen host/port、Kysely/SQLite driver options、OpenTelemetry/Pino wiring、provider HTTP client details | `SystemConfig` public contract、`AgentDefinition`、runtime/core/context/model public request、组件自行读取 env/file |
| NextAgent system/component 配置 | `agent-app/config` built-in default-system mapping + internal component config objects | deployment/auth mode、active agent id、trusted roots、component enablement、model profile registry、local gateway component config、no-op provider mode | Agent workspace、capability binding、tenant/subject、client request metadata、provider raw credential、组件自行感知配置文件来源 |
| Agent 业务配置 | `agent-app/assembly` loader/parser for `packages/agent-app/config/default-agent.yaml` | `agentId`、`agentVersion`、display metadata、workspace ref、model/prompt refs、capability bindings、agent runtime settings、resource refs | SQLite file、channel transport、gateway endpoint、owner identity、provider endpoint/secret、component wiring |
| Runtime-safe assembly | `agent-contracts/agent-assembly` and `agent-app/assembly` registry implementation | `agentId`、`agentVersion`、`agentAssemblyRef`、display metadata、workspaceDir、model/prompt ids、capability bindings、runtime settings | raw config、loader/parser details、provider implementation、datasource/channel/secrets |

`SystemConfig` 在 TS 中不是“所有运行配置”的总桶。它只能作为 app-local validated input 表达 NextAgent system 级选择和跨组件需要的最小公共事实；SQLite file、channel config、no-op boundary config、observability 和 provider adapter 细节由 `agent-app` 映射成内部组件构造参数，未共享的 adapter 细节停留在 `agent-app` composition local options。若需要跨组件共享，只共享解析后的 registry/port/factory，不共享 raw component config DTO。组件可以定义自己的内部配置参数类型，但不得拥有配置文件路径、env key、merge precedence 和默认配置文件创建逻辑。

`AgentDefinition` 只表达单 Agent 业务装配：`agentId`、`agentVersion`、`displayName`、`description`、`workspaceDir?`、`modelProfileIds[]`、`promptTemplateIds[]`、`capabilityBindings[]`、`runtimeSettings` 和 `resources[]`。`AgentRuntimeSettings` 只允许 `defaultLanguage?`、`defaultModelProfileId?`、`defaultPromptTemplateId?`、`maxToolIterations?`、`maxContextMessages?`、`requestTimeoutMs?`，不得包含 credential、provider endpoint、database path、gateway endpoint、owner identity、adapter options、provider-native payload。

`AgentAssemblyCompiler`、`ResourceInventory` 和 AgentDefinition parser/loader 是 `agent-app` 内部实现细节，不作为 runtime/core/session/model/capability 的 public contract。`agent-contracts` 只暴露 downstream 需要的稳定边界：`agent-contracts/agent-assembly` 暴露 runtime-safe `AgentAssembly` / `AgentAssemblyRegistry`，model subpath 暴露 model invocation profile shape 和 model profile registry port，capability subpath 暴露 capability descriptor/invocation contract。`Agent` execution port 仍属于 `agent-contracts/runtime`，因为它是 runtime 调用 core 的 request execution boundary。产品 composition 向 runtime/core/context/model/capability/gateway 注入编译后的 registry、typed model profile registry、capability catalog 和 SQLite local gateway store；这些下游模块不得解析 raw env/file config，也不得 import `agent-app/config` 和 `agent-app/assembly` 内部文件。配置到内部组件参数的转换也是 `agent-app` composition 职责，不下放给组件。

资源注册和 Agent binding 必须分离。model profile、prompt template、capability descriptor 被注册后只表示可发现；只有 `AgentDefinition` 引用并经 compiler 校验后才进入该 Agent 的 effective assembly。内置 read 被注册但未被 active Agent 绑定时，不得进入模型可见 tools；OpenAI profile 存在但未被 accepted assembly 选择时，不得影响当前 request。

默认 Agent 定义必须来自 `packages/agent-app/config/default-agent.yaml`。runtime acceptance、core、context 和 capability 路径不得使用 `default-agent` fallback，也不得创建硬编码 default assembly registry。模型选择必须来自 accepted assembly：优先使用 `runtimeSettings.defaultModelProfileId`，否则使用 `modelProfileIds[0]`；被选择 profile 在本 change 中必须是 enabled `OPENAI`。

理由：配置设计的关键不是多几个 DTO，而是把“系统/组件可定制配置”“Agent 业务装配”“资源发现/注册”“运行时安全 assembly”分开。TS 版本若继续扩大 `SystemConfig`，会把 system 和 agent 边界混在一起，并让 runtime/core 依赖启动配置细节。

放弃方案：把 SQLite、channel、provider、no-op、prompt、capability provider switches 全部放进 public `SystemConfig` 并导出 compiler input/output contract。该方案字段看似完整，但会形成傻大粗的配置总线，并模糊 system/component 与 Agent 边界。

放弃方案：产品配置只允许一个 enabled OpenAI profile，并在 composition 中直接创建硬编码默认 assembly。该方案可跑通最小问答，但会把测试便利路径变成目标架构，后续引入多 Agent、prompt profile、capability binding 或 Agent scope 时必须重写启动链路。

放弃方案：让 runtime、core 或 context 在执行中读取 raw config 并决定 model、prompt 或 capability。该方案会破坏 acceptance 时 assembly 固化和 Agent scope 隔离。

### 5. Model invocation 使用扁平请求和方法选择调用模式

选择：Agent core 从 `RenderedModelInput` 生成 `ModelInvocationRequest`，`agent-model` 只接收 `requestId`、`stepId`、`providerKind=OPENAI`、model name、base URL、credential ref、`ChatMessage[]`、tools、`temperature`、`maxTokens`、`topP`、`thinking`、provider options 和 `timeoutMs`。`ModelInvocationRequest` 不包含 `ContextAssembly`、`RenderedModelInput`、provider SDK、AI SDK、runtime streaming context 或调用模式字段。流式与非流式由 `stream(...)` 和 `complete(...)` 方法选择。OpenAI-specific env 只能在 app/config adapter 中映射为共享 profile 字段，raw credential 只能由 provider adapter 通过 credential resolver 解析。

理由：`agent-model` 是 provider adapter，不应理解 context assembly 或 runtime stream。模型流统一使用 TS 的 `AsyncIterable` stream contract。

放弃方案：把 `RenderedModelInput` 或 runtime timeline sink 传给 model layer。该方案会让 model adapter 反向依赖 core/runtime 语义。

### 6. Web stream 只从 runtime event stream 投影

选择：submit 后客户端使用 `lastSeenSequence=0` 或自有 session cursor 打开 SSE；channel 调用 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence, requestId?, runId? })` 并投影为 `StreamEnvelope`。最小内核不实现 WebSocket，不实现完整断连 replay 语义，不在 accepted response 中返回 `acceptedSequence`、`streamPath`、cursor 或 timeline sequence。

理由：canonical timeline 是 runtime truth。TS 最小版必须避免 channel 拥有 replay truth。

放弃方案：channel 订阅 core/model 内部执行信号并自建 stream state。该方案会绕过 canonical timeline。

### 7. Capability loop 使用通用调用形态，当前产品只暴露 read

选择：Agent core 的 tool loop 使用通用 capability 调用规格：从模型 final result 读取 tool calls，按 accepted assembly 中 enabled descriptor 解析 capability id/name，保存 tool-use state，并统一经 `CapabilityInvocationPort` 调用。`CapabilityInvocationRequest` 字段固定为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`；不得包含 `workspaceDir` 或 `recoveryReplay`。当前产品 assembly 只启用内置 `read` capability；未启用、不可解析或 schema validation 失败的 capability/tool call 必须 safe rejected，不允许 core hardcode 文件读取或绕过 capability boundary。模型可见 read input schema 使用 canonical argument names：必填 `file_path`，可选 `offset`、`limit`；`file_path` 只表示 workspace-relative 单文件路径，不接受 `path`、`filePath` 或其它 alias。`read` 拒绝绝对路径、路径逃逸、目录和 glob pattern；`offset`/`limit` 是 line-based slice，`offset` 默认 0 且表示 0-based 起始行，`limit` 默认 2000 且表示最大行数；`offset`/`limit` 必须是整数，`offset >= 0` 且 `1 <= limit <= 2000`，非法值必须在 capability input schema validation 阶段失败；success payload 固定包含 `file_path`、`offset`、`limit`、`content`、`truncated` 和可选 `nextOffset`，其中 `file_path` 只能是 normalized workspace-relative path，不得暴露宿主机绝对路径；输出受 offset/limit 和最大大小限制，超限返回 bounded slice 并显式携带 `truncated=true` 与 `nextOffset`。

理由：read 是验证 model -> capability -> model loop 的最小真实能力；通用 invocation shape 保证后续 capability governance/source change 可以扩展 descriptor 和 policy，而不需要重写 Agent core 主循环。其它工具、Skill source 和远端 Agent 不属于一次问答成立的必要条件。

放弃方案：在 core 内 hardcode 文件读取。该方案会绕过 capability governance 和后续审计/恢复边界。

### 8. Web API 使用已确认最小路由并保留 TS convenience submit

选择：产品 Web API 冻结以下最小 route table：`GET /api/v1/sessions`、`POST /api/v1/sessions`、`GET /api/v1/sessions/{sessionId}/conversation`、`POST /api/v1/sessions/{sessionId}/requests`、`GET /api/v1/sessions/{sessionId}/stream`，并额外提供 `POST /api/v1/requests` convenience submit。所有 session create/list/conversation/submit admission 都由 channel 调用 runtime-facing ports 完成；runtime 内部解析 trusted Agent Scope 并委托 `agent-session`，channel 不直接调用 `agent-session`。`GET /api/v1/sessions` query 只允许 `offset?` 和 `limit?`，response 为 `entries/offset/limit/hasMore`，entry 只包含 `sessionId/displayTitle/lastActivityAt`；`displayTitle` 由内部 `title?` 或安全默认标题投影，`lastActivityAt` 由内部 `updatedAt` 投影；不暴露 owner、agent、`includeSuperseded`、cursor、运行状态摘要、stream/ws path 或 conversation。两种 submit request body 都要求 non-blank `inputText` 和 `idempotencyKey`，可携带 `locale?` 和 `attachments?: []`；public `attachments?: []` 在本 change 中语义为 empty attachment id refs，并映射为核心 `attachmentIds=[]`；convenience submit 可额外携带 `sessionId?`，无 `sessionId` 时的 child session create command 可以从 submit `idempotencyKey` 派生 server-side idempotency key，保证重复 convenience submit 返回首次 accepted run 且不会泄漏额外空 session；客户端提供的 `requestId`、`language`、`submittedAt`、owner 字段、agent 字段、metadata 或其他 non-minimal envelope 字段必须 schema validation failed；`attachmentIds` 字段、非空 `attachments`、附件对象或 upload ref 必须 schema validation failed。所有 public compatibility handling 只属于 `agent-channel-web` DTO 适配：`displayTitle`、`lastActivityAt`、`attachments` 和 public conversation `cursor/nextCursor` 不得进入 runtime、session、core 或 gateway contract；runtime/session 使用 `title?`、`updatedAt`、`attachmentIds=[]`、`beforeCursor` 和 `nextBeforeCursor` 等核心/内部字段。两种 submit 成功响应完全一致，只返回 `sessionId/requestId/runId/attempt`。`POST /api/v1/sessions` 只通过 runtime session facade 创建新的 owner-scoped and agent-scoped 空 session，request body 只允许 `locale?`；`tenantId`/`subjectId` 只来自可信 identity boundary，`agentId` 只来自 runtime internal resolver；请求体中的 `sessionId`、`idempotencyKey`、owner 字段、agent 字段、title、status、deploymentMode、channel、metadata、stream/ws path 或其他 session detail 字段必须 schema validation failed；channel 必须生成安全 server-side idempotency key 后传给 runtime session facade。create-session 成功响应只返回与 session list entry 相同字段集的安全 metadata：`sessionId/displayTitle/lastActivityAt`，且不返回 `streamPath`、`websocketPath`、conversation、request accepted fields、cursor 或 timeline sequence；`GET /api/v1/sessions/{sessionId}` 和 open/resume existing session handle 不进入本 change。已有 session 的继续使用通过 session list、conversation history、session-scoped submit 和 SSE stream 完成。

理由：route table 固化最小 Web API，convenience submit 保留 TS 客户端低摩擦入口，但不改变 runtime submit command 必须携带 `sessionId` 的核心契约。

### 9. Conversation history 默认最近窗口并用 cursor 加载更早记录

选择：`GET /api/v1/sessions/{sessionId}/conversation?limit=50` 默认返回最近一页 visible `SessionMessage`；response items 按 `createdAt asc, messageId asc` 输出以便前端直接渲染。加载更早记录使用 public `cursor=<nextCursor>`，channel 映射为内部 `beforeCursor`；内部 page 返回 `nextBeforeCursor`，channel 投影为 public `nextCursor`，没有更早记录时为 null 或省略。公开 Web API 不暴露 `includeHidden`，内部固定 `false`；`includeCapabilityResults` 保留且默认 `false`。

理由：recent window + older cursor 更符合前端加载最近对话并继续向上加载更早记录的交互，也避免 active session 追加消息时 offset 分页漂移。public 命名保留 `cursor/nextCursor` 以降低前端适配成本，内部仍按 before-cursor 语义处理。

### 10. No-op 是明确 port 上的产品空实现

选择：lifecycle hook、checkpoint save 和 audit writer 在最小内核中装配显式产品 no-op provider，而不是缺失依赖或 test stub。主流程必须真实调用这些 port；hook no-op 只能返回 continue/no-op，不影响 request 决策；checkpoint no-op 不写 checkpoint record、不支持 lookup/recovery；audit no-op 不落库、不保留 ring buffer。真实 policy hook execution、checkpoint persistence/recovery 和 durable audit store 后置。验收通过测试 spy/sink 验证调用和无副作用。

理由：这些是目标主流程的一层直接依赖。省略调用点会导致后续真实实现改动主流程；真实落库又会扩大最小内核范围。

放弃方案：完全不调用 hook/checkpoint/audit。该方案会让后续 change 重新侵入 runtime 主路径。

### 11. 最小内核必须以产品化 package 结构交付

选择：本 change 将 package 内部目录结构纳入交付范围。`agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app` 必须按 `module-structure.md` 拆分主流程实现；`src/index.ts` 只保留 public barrel 或明确允许的轻量 factory export。`agent-contracts` 作为契约包按领域目录组织；minimal stub packages 可以保持小型结构，但不得承载与本 change 主流程无关的半实现。

理由：最小内核是后续电信网络智能体能力的第一版运行骨架。如果核心包以单文件实现落地，后续 change 会默认在同一文件继续堆叠 runtime lifecycle、provider adapter、gateway store 和 Web schema，导致边界无法审查，也削弱 architecture lint 的实际价值。

放弃方案：把目录产品化留给后续 cleanup/refactor change。该方案会让已完成的 `ship-ts-minimal-agent-kernel` 对外呈现 demo 风格，并让后续功能 change 在错误结构上继续扩展。

### 12. Product implementation names describe responsibility, not change scope

选择：`Minimal` 和 `Kernel` 只允许作为本 change/spec scope 描述，不作为产品实现的 public class/factory/type 名称。产品实现使用职责命名：runtime lifecycle 实现为 `RequestLifecycleCoordinator`，session 领域实现为 `UserSessionService`，默认 Agent 实现为 `DefaultAgent`，默认 context engine 实现为 `DefaultContextEngine`。这些名称不通过 deprecated alias 兼容旧名。

session 读取命名统一以 `SessionMessage` 为事实中心。session list 返回 `UserSessionPage.entries: UserSession[]`，不再定义 `UserSessionListEntry`。conversation/history 语义保留在 Web route 文案和用户体验中，但领域/runtime/gateway contract 使用 message 命名：`ListSessionMessagesQuery`、`SessionMessagePage`、`ListCurrentRequestMessagesQuery`、`RuntimeListSessionMessagesQuery`、`ListSessionMessagesRecordQuery`、`ListCurrentRequestMessagesRecordQuery` 和 `SessionMessageRecordPage`。当前 request message query 与 session-level message list query 不合并，因为当前 request query 必须携带 `requestId/runId/offset/includeHidden`，而 session-level query 使用 `beforeCursor/includeCapabilityResults`；两者共享同一个 page/read model。

Channel 的 stream dependency 不命名为 timeline。Runtime 仍拥有 canonical timeline truth，但 channel 注入的 port 命名为 `RuntimeEventStreamPort`，注入对象命名为 `eventStream`；channel 只把 runtime event stream 投影为 public `StreamEnvelope`。`RegisterWebChannelOptions` 改为 `WebChannelDependencies`，表达必需依赖而非可选配置。

本地 gateway 产品路径只保留 SQLite。`LocalGatewayStores` 是组合 root 内部使用的 store bag 类型，聚合 requestRuns/sessions/messages/activeContext/timeline/checkpoints；SQLite 实现命名为 `SqliteGatewayStores`，factory 为 `createSqliteGatewayStores`。不再从 `agent-platform-gateway-local` 导出 in-memory fake；测试需要隔离存储时通过临时 SQLite helper 创建真实 local persistence implementation。

理由：scope word 命名会把一次 change 的范围误当成长期领域模型；`Kernel` 过泛且无法表达 runtime lifecycle、session service 或 gateway store 的实际责任。session/message 双层 read-model 命名会制造平行 API。channel-facing stream port 若直接叫 timeline，会暗示 channel 对外呈现 runtime timeline，而真实职责是 projection。SQLite 是当前唯一 local persistence implementation，继续保留 in-memory product export 会破坏持久化 owner 的唯一性。

放弃方案：保留旧名 alias 以减少修改。该方案会让坏命名继续作为 public API 存在，并与本次清理目标冲突。

放弃方案：合并 current request query 和 session-level message query。该方案会把两种分页和隔离条件混成一个宽接口，反而降低 contract 可验证性。

### 13. Contract subpath consumption follows architecture ownership

选择：本 change 增加两层跨 package 依赖门禁。第一层是 implementation package dependency firewall：除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 不得在源码 import 或 `package.json` 中依赖其它 implementation package。第二层是 contract subpath allowlist：产品 package 只能导入其职责需要的 `agent-contracts/<subpath>`，并禁止从 `@nextagent/agent-contracts` root aggregate import 绕过 allowlist。为避免 runtime lifecycle subpath 被 assembly 消费需求放宽，本 change 新增窄 subpath `agent-contracts/agent-assembly`，只承载 compiled runtime-safe Agent assembly facts。

第二层白名单按循环依赖风险和架构职责定义目标态，而不是按当前实现倒推：

| Package | 允许的 `agent-contracts` subpath | 说明 |
|---|---|---|
| `agent-runtime` | `agent-assembly`, `runtime`, `session`, `gateway`, `observability` | runtime 拥有 lifecycle、session facade、active assembly selection、timeline/terminal persistence coordination 和 audit/safe boundary 调用点。 |
| `agent-session` | `session`, `gateway` | session 只做领域 session/read model 与 gateway record/query 映射。 |
| `agent-attachment-runtime` | `attachment`, `gateway` | attachment runtime 只接触附件契约和持久化/blob gateway；本 change 仍为 minimal/deferred 边界。 |
| `agent-context-engine` | `agent-assembly`, `context`, `capability`, `model`, `gateway` | context engine 可读取 context 所需 message/active context gateway、accepted assembly facts 和 capability/model metadata；不得依赖 runtime lifecycle contract。 |
| `agent-core` | `agent-assembly`, `runtime`, `context`, `model`, `capability`, `observability`, `session` | core 实现 runtime-facing `Agent` 并 orchestrate context/model/capability；`session` 只用于 `SessionMessageDraft`，不得直接消费 gateway persistence contract。中间执行消息必须通过 runtime-owned `RunMessagePort` 追加。 |
| `agent-model` | `model` | provider SDK 和 stream normalization 只实现 model contract。 |
| `agent-capability` | `agent-assembly`, `capability` | capability lifecycle/catalog/invocation 可按 accepted assembly binding 控制可见/可执行能力；不依赖 runtime/core/model implementation 或 gateway contract。 |
| `agent-memory` | none in this change | 未定义 `contracts/memory` 前不得借用 context/runtime/gateway subpath 形成隐式能力。 |
| `agent-channel-web` | `channel`, `runtime` | channel 只做 HTTP/SSE transport、schema/projection 和 runtime-facing port 调用；不得导入 session/gateway/model/capability contract。 |
| `agent-channel-web-auth-local` | none | local auth 只产生 trusted identity，不消费 core contracts。 |
| `agent-platform-gateway-local` | `gateway` | local adapter 只实现 gateway contract，SQLite row/entity 留在私有实现。 |
| `agent-platform-gateway-remote` | `gateway` | remote adapter 只实现 gateway contract。 |
| `agent-observability` | `observability` | observability SDK 不泄漏到其它 package。 |
| `agent-app` | explicit composition whitelist | app 是唯一 composition root，可显式白名单消费装配所需 contract subpath；它的白名单必须单独维护，不得作为其它 package 的先例，也不得让 app 承载 runtime/core/channel/gateway 的业务语义。 |

`agent-contracts/agent-assembly` 的边界只承载本 change 所需的 compiled runtime-safe Agent assembly facts，例如 `AgentAssembly`、`AgentCapabilityBinding`、`AgentRuntimeSettings` 和 `AgentAssemblyRegistry`。它不得依赖 `agent-contracts/runtime`、app/compiler/config contract、gateway/channel/model/capability contract 或 implementation package，也不得成为 Agent execution、raw config 或 app compiler contract 聚合入口。`Agent` 保留在 `agent-contracts/runtime`，因为它是 runtime 调用 core 的 execution port，签名依赖 `RequestRun`、`RequestContext` 和 runtime timeline/message ports。

理由：只禁止 private path import 仍允许 implementation package 通过 public implementation export 形成横向依赖，也允许任意模块通过 `agent-contracts` root 或错误 subpath 形成概念性循环。按 subpath 控制 consumption 可以让 `agent-channel-web -> runtime facade`、`runtime -> session/gateway`、`core -> context/model/capability`、`gateway adapter -> gateway` 等方向被架构工具验证，而不是只靠人工 review。将 compiled assembly facts 放入窄 `agent-assembly` subpath，可以让 runtime、core、context 和 capability 共享 accepted Agent 配置而不把 context/capability 拖入 runtime lifecycle contract。

放弃方案：按当前源码已存在的 contract subpath 导入生成白名单。该方案会把历史实现形态固化为架构规则，无法发现 `agent-core -> gateway` 或 `agent-context-engine -> runtime lifecycle` 这类职责穿透。

放弃方案：新增宽泛 `agent-contracts/agent` subpath 并把 `Agent` execution port 一起迁入。该方案会形成新的 catch-all Agent contract，并迫使 `agent` subpath import runtime lifecycle 类型，削弱 `agent-assembly` 作为 compiled assembly facts 边界的清晰度。

放弃方案：只在 README 或人工检查清单中说明依赖方向。该方案不能满足 AGENTS.md 对边界逃逸和非法依赖必须由测试或命令实际触发失败的要求。

## 接口目标矩阵（Interface Targets）

| 接口/对象 | 规格 | 本 change 责任 |
|---|---|---|
| Runtime session facade | Channel-facing create/list/conversation/require session boundary；runtime 内部解析 trusted `agentId`，调用 `agent-session` 领域 `UserSessionPort`；返回 `UserSession`/conversation read model 给 channel projection，不返回 gateway Record 或 Web DTO alias。 | Channel 只调用 runtime facade；runtime 拥有 Agent Scope resolution 和 session admission。 |
| `RuntimeCommandPort.submit(SubmitRequestCommand)` | command 必须携带可信 `identityContext`、`sessionId`、`inputText`、`attachmentIds=[]`、`locale`、`idempotencyKey`；runtime 使用内部 Agent Scope resolver 并按 persisted session 校验 owner+agent scope；返回 `RequestAccepted(sessionId/requestId/runId/attempt)`，不返回 stream cursor 或 sequence；同 owner+agent+session 已有 active run 时返回 safe conflict/rejection，不创建 queued run。 | Channel 只构造 submit command；runtime 拥有 admission、run 创建和 active-run conflict。 |
| `RequestRun` / `RequestRunRecord` | 固化 `agentId`、`agentVersion`、`agentAssemblyRef`、`attempt`、`version`、`status`、`terminalCommitState` 和 request/session 标识。 | Acceptance 时写入；terminal commit 通过 version/CAS 推进。 |
| `RequestContext` | 只表达恢复坐标、identity、locale、assembly refs、lifecycle stage、tool batch state 和 flow variables；不含 `attempt`、`deadlineAt`、`messageRefs`。 | Runtime 构造，core 消费；消息事实从 active context/current request query 读取。 |
| `AgentAssemblyRegistry.active/require` | 位于 `agent-contracts/agent-assembly`。`active(agentId)` 只用于 runtime acceptance；`require(agentId, agentVersion)` 用于 accepted 后 core/context/capability/recovery 路径。 | 防止同一 RequestRun 内 assembly 漂移，同时避免 context/capability 依赖 runtime lifecycle contract。 |
| Config / Resources / AgentDefinition / Assembly | Config、Resources、ResourceProviders、Plugins 是启动输入面；System/component 配置、Agent 业务配置和 runtime-safe assembly 分属不同 owner；AgentDefinition 只承载单 Agent 业务装配。 | `agent-app/config` 拥有内置 default-system 文件、env secret override 和 component config coordination；`agent-app/assembly` 拥有 AgentDefinition loader/parser/compiler；下游模块只消费 `AgentAssemblyRegistry`、typed registries、catalog 和 gateway/model/capability ports。 |
| `ModelProfileRegistry` | 支持多个 typed model profile；当前主路径只能选择 accepted assembly 指向的 enabled `OPENAI` profile；raw credential 只以 `credentialRef` 表达。 | app composition 注入 registry；core 根据 accepted assembly 选择 profile 并构造扁平 ModelInvocationRequest。 |
| `Agent.execute(run, context, timeline, messages, signal)` | `Promise<void>`；Agent 通过 `RunTimelineEventPort` 发布中间 event，通过 `RunMessagePort.appendMessage(run, context, SessionMessageDraft)` 追加执行中产生的 session message，不发布 terminal lifecycle event。`Agent` interface 位于 `agent-contracts/runtime`。 | Runtime 调度并处理 resolve/reject 后的 terminal commit；runtime 实现 message port，负责 owner/agent/session/run/time stamping，并通过 gateway composite write 持久化 message 和 active context item；append port 不单独接收 `AbortSignal`，取消由 `Agent.execute` 的 runtime-owned `signal` 控制。 |
| `RunTimelineEventPort.emit` / `RuntimeEventStreamPort.stream` | emit 只提交 authoring event，runtime 覆盖 runtime-owned fields；stream 按 `sessionId + lastSeenSequence` 读取，`requestId/runId` 仅过滤。 | Runtime 是 canonical timeline owner；channel 只投影。 |
| `SessionMessageDraft` / `RunMessagePort` | `SessionMessageDraft` 位于 `agent-contracts/session`，只表达 role/content/contentType/visible/metadata/idempotencyKey 等待追加的 message 内容；`idempotencyKey` 是必填 write metadata，不得包含完整 owner/agent/session/run/timestamp 坐标。`RunMessagePort` 位于 `agent-contracts/runtime`，提供 `appendMessage(run, context, draft)`。 | Core 不直接导入 gateway，也不构造 gateway record；runtime 将 draft 与 trusted run/context 合成 durable session message，并委托 gateway composite write 一次性更新 active context。 |
| `ContextEnginePort.assemble/render` | `ContextAssemblyRequest` 只携带 `sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`；不得携带 `rootMessageId`、`historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`。从 active context view、必要 current request/history、locale、owner metadata、assembly refs、默认 prompt profile/system prompt 和 enabled capability metadata 生成 `ContextAssembly` / `RenderedModelInput`。 | Context Engine 实现真实最小 window/budget guard 和电信术语保留指令；不扫描全量 history，不拥有 memory lifecycle、compression 或 prompt profile governance；`RenderedModelInput` 不包含完整 `ContextAssembly`。 |
| `ModelInvocationRequest` / `ModelInvocationService` | 扁平请求，包含 `requestId`、`stepId`、`providerKind=OPENAI`、model profile 字段、`ChatMessage[]`、tools、模型参数、provider options、`timeoutMs`；`complete`/`stream` 方法选择调用模式。 | Core 负责扁平化；model adapter 隔离 provider SDK、raw credential 和 safe error mapping。 |
| `CapabilityCatalogPort` / `CapabilityInvocationPort` | Agent core 按通用 capability descriptor/invocation 形态解析并调用已启用 capability；`CapabilityInvocationRequest` 字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`，且不含 `workspaceDir` / `recoveryReplay`；当前产品路径只暴露内置 `read`，read input schema 使用 `file_path`、`offset`、`limit`。 | Capability boundary 执行 workspace-relative 单文件 line slice，失败安全归一化；未启用 capability 不进入模型可见 tools，若被调用必须 safe rejected。 |
| `UserSessionPort` | `agent-contracts/session` 领域 port；`UserSession` 必须携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、`title?`、`createdAt`、`updatedAt`；list/conversation query 显式携带 trusted `IdentityContext` 和 `agentId`；不定义 Web DTO，不返回 gateway `*Record`。 | `agent-session` 实现，runtime 内部消费；channel 不直接依赖。 |
| `SessionStoreGateway` / `SessionMessageStoreGateway` | gateway 使用 owner-scoped and agent-scoped Record/Query；owner scope 共享字段使用 `OwnerScoped`，不让 Record 继承 Request；session list 使用 `offset/limit` 和内部 `title?/createdAt/updatedAt`；conversation 使用 `beforeCursor/nextBeforeCursor`；current request query 必须带 `agentId + requestId + runId`；message write 只暴露 `appendSessionMessage(record, options?)`。 | `agent-session` 映射 DO/read model 与 gateway record；public alias 只在 channel；runtime message append 不能绕过 active context composite write。 |
| `ActiveContextStoreGateway` | `loadActiveContext` 读取模型可见序列；`appendItem` 是 standalone CAS primitive，使用 `expectedActiveContextVersion` 防覆盖。 | 模型可见 message 主路径通过 message-store composite write 追加 active context item，不由 runtime 拆成两步。 |
| `TerminalCommitRequest` | 同一 CAS/idempotency 操作写入 terminal message、terminal timeline event 和 run terminal state；成功后 `terminalCommitState=COMMITTED`。 | Channel-visible terminal stream 只在 durable commit 成功后发布。 |
| SQLite gateway-local persistence | 主路径事实使用专用 SQLite 表；幂等 key 默认位于锚点事实表；message append 复合写入必须使用 gateway composite write 和单个 SQLite transaction；不得使用 generic `records(store,key,json)` 承载业务事实。 | `agent-platform-gateway-local` 拥有 row/schema/index/transaction 细节，上层只看 gateway record contract。 |
| `LifecycleHookPort` / `CheckpointStoreGateway` / `AuditEventWriter` | 显式产品 no-op provider；主流程真实调用，默认无副作用。 | 保留对应 public contract 调用点，不影响 request 决策、终态或安全边界。 |
| Web route DTO | 只暴露确认 route table；public alias `displayTitle/lastActivityAt/cursor/nextCursor/attachments` 只在 channel DTO 层存在。 | Runtime/session/core/gateway 不接收 public alias 或附件对象。 |

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner scope 只来自 channel/auth 注入的 `IdentityContext`；Agent Scope 只来自 runtime internal resolver 或已持久化 session/run；submit、stream、history、gateway query 均携带 `tenantId`/`subjectId` 和主路径需要的 `agentId`；read tool 限制 workspace；SafeError 和 stream/history/audit 不泄漏 raw prompt、模型输出、provider error、tool args/result、secret 或未脱敏路径。 | owner/agent-scope smoke tests、safe error tests、read path escape negative test、secret scan、architecture lint |
| 性能/容量 | 首版单 RequestRun 内串行执行；SSE delivery 只投影 runtime timeline，不阻塞 Agent execution；conversation history 默认最近窗口并用 cursor 读取更早消息；model stream 使用 `AsyncIterable` 逐步消费；同一 session 通过 active-run conflict guard 保证同时最多一个 active run，跨 session 并发不得串写；单 request 最多 3 轮 tool loop，每轮最多 5 个 read calls。暂不承诺高并发容量数字。 | unit/contract tests、SSE backpressure characterization、history pagination tests、tool loop limit tests、concurrency correctness smoke |
| 可靠性/恢复 | Runtime 持久化 RequestRun 后发布 accepted timeline；terminal commit 使用 `PENDING -> COMMITTED`、CAS/idempotency 防双终态；channel-visible terminal event 只在 `COMMITTED` 后发布；`RequestContext` 只保存恢复坐标；current request message query 支持工具状态重建；硬输出上限触发 degradation + failed terminal，不静默截断；内部 cancellation propagation 覆盖慢边界，但不形成用户 cancel API、cancel runtime command、持久化 canceled terminal state 或 request-control 状态机。完整多实例 takeover、真实 checkpoint recovery、用户 cancel、terminal commit retry/recovery 和自动 output continuation 不属于本 change。 | terminal idempotency tests、stream-terminal-history consistency tests、current-request query tests、assembly binding tests、output guard tests、cancellation propagation tests |
| 可维护性 | 所有跨模块类型从 owning subpath import；模块职责按架构边界实现；实现包不得复制或重定义核心 public contract；产品 implementation package 不得横向依赖其它 implementation package；contract subpath consumption 必须符合 allowlist，且 root aggregate import 被禁止。 | `npm run lint:architecture`、private import negative fixtures、package manifest assertions、contract subpath negative fixtures、source assertions |
| 可测试性 | app composition 支持真实 provider 产品路径和显式 test provider fixture；gateway/model/capability/no-op ports 可替换；unit/contract/characterization tests 可用 deterministic provider fixture；单 package 行为测试归属对应 `packages/<package>/tests/`，根 `tests/` 只承载 architecture、contract、跨模块 agent-kernel、真实 e2e 和 fixtures；最小端到端发布验收必须使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint，不能由 deterministic provider 替代。 | `npm test`、`npm run test:contract`、`npm run test:e2e:openai`、test-kit fixtures |
| 审计/可追溯性 | timeline 记录 canonical execution facts；terminal commit、capability invocation、safe error 和 audit no-op 调用保留 requestRunId/sessionId/messageId 等安全业务标识。首版不要求真实审计落库。 | timeline contract tests、audit no-op invocation test、safe log/assertion tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 最小端到端问答闭环 | T004-T032、T039-T051、T061 | product-path OpenAI E2E minimal QA test、`npm run test:e2e:openai` |
| Web submit/session route 经 runtime 解析 Agent Scope 并准备 owner+agent scoped session | T004-T006、T044-T045、T061、T096-T101 | submit/session characterization tests、Web contract tests、cross-agent owner tests |
| 已确认最小 route table 和 TS convenience submit | T044-T045、T050-T051、T066-T067 | route registry / Web contract tests |
| Runtime acceptance 固化 assembly | T007、T009 | assembly binding characterization test |
| RequestContext 不含 attempt/deadlineAt/messageRefs | T003、T008 | contract tests、type/API review |
| current request message query 携带 owner/run scope | T016-T017、T038 | gateway/session contract tests、tool state reconstruction test |
| active context read/append 和版本冲突 | T012-T015、T023、T037、T043 | active context gateway tests、tool loop integration test |
| locale/language hint 和电信术语原文保留 | T024、T063 | context render contract tests |
| Agent.execute 边界和 timeline emit | T020-T022 | agent core contract tests |
| RenderedModelInput 扁平化为 ModelInvocationRequest | T025-T026 | model boundary contract tests |
| 目标态 TS 配置所有权和 assembly 编译路径 | T087-T091 | config ownership tests、agent definition parser/compiler tests、composition smoke、contract/API review、architecture/source assertions |
| 两层 package dependency firewall 和 contract subpath allowlist | T107-T111 | `npm run lint:architecture`、architecture fixtures、package manifest assertions、contract root import scan、source assertions |
| OpenAI provider、credentialRef 解析和 stream/tool-use normalization | T027-T032、T068 | provider tests、safe provider error tests |
| 通用 capability invocation 形态下的 read capability | T033-T038、T062、T069-T071 | capability catalog tests、tool loop integration test、path escape negative test、tool loop limit tests |
| Web submit accepted response 不暴露 cursor/sequence | T010、T045 | runtime/Web contract tests |
| SSE 从 runtime event stream 投影且事件名与 shared canonical vocabulary 一致 | T046-T049、T105 | stream projection/terminal consistency tests |
| terminal commit 唯一且 history 一致 | T039-T043 | terminal idempotency and history tests |
| 输出超限不静默截断 | T064 | output guard / safe partial tests |
| 同 session active-run conflict 不串写 | T065 | concurrency correctness smoke tests |
| owner/agent scope 和 safe error | T006、T032、T052-T053、T057、T096-T101 | owner/agent-scope/safe-data tests |
| session/scope 唯一实施路径和历史残留清理 | T096-T102 | architecture/contract positive checks、category-level negative fixtures、dependency-cruiser |
| hook/checkpoint/audit no-op 调用 | T054-T056 | no-op boundary smoke tests |
| real/minimal/noop/deferred 范围控制 | T002、T033、T049、T059-T060 | deferred boundary tests、route/catalog/architecture tests |
| package boundary 和 provider SDK 不泄漏 | T026、T058 | `npm run lint:architecture` negative fixtures |
| 内部 cancellation propagation | T020、T028、T035、T047、T052、T072 | cancellation propagation tests；gateway-local SQLite 事务取消 deferred |
| OpenSpec 和全量门禁 | T075 | `openspec validate --all --strict`、build/test/contract/lint/product-path OpenAI E2E |
| 测试归属结构 | T093 | package tests、agent-kernel/e2e path scan、`npm test` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-minimal-agent-kernel/spec.md` 主承载最小内核可验证行为。
- 核心契约 refinement：本 change 的 `ts-core-contracts` spec delta 主承载 user session domain port、owner+agent scoped gateway query 和 Web public alias 隔离。
- 跨模块架构：归档前提升到 `openspec/designs/architecture/runtime-boundaries.md` 和 `openspec/designs/architecture/ts-backend-architecture.md`。
- 领域模型/状态机：`openspec/designs/domain/request-run.md` 主承载 RequestRun、RequestContext、assembly binding 和 terminal uniqueness。
- API/SPI/event/schema：`openspec/designs/contracts/core-contracts.md` 主承载 RuntimeCommandPort、Agent、timeline、stream、ContextEnginePort、ModelInvocationService、CapabilityInvocationPort 和 Gateway port 调用语义。
- Gateway write 和 persistence 原则：本 change 的决策 2a 主承载专用事实表、锚点幂等、`Record + write options`、`idempotencyKey` 不进入 `*Record`、owner scope contract 使用 `OwnerScoped`、shared durable vocabulary 归 `agent-common`、message write 只暴露 `appendSessionMessage`、composite write 单事务和禁止 generic store；归档前提升到 `openspec/designs/contracts/core-contracts.md`、`openspec/designs/modules/agent-platform-gateway-local.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-session.md` 和相关 architecture/domain 文档。
- 同形同策原则：相同语义类别、生命周期阶段、架构边界和安全/一致性不变量的对象或操作，必须使用同一 owner、命名规则、contract shape、write/storage/idempotency 策略和验证方式；例外必须先在 OpenSpec design 中说明原因、范围、owner 和验证路径。归档前提升到 `openspec/designs/contracts/core-contracts.md` 和相关 architecture/module 文档。
- 模块职责：`openspec/designs/modules/*.md` 按模块主承载职责、非职责和依赖。
- 长期开发约束：`AGENTS.md` 承载跨 change 的强制实现原则，包括 DO/DTO/Record/Row 分层、gateway simple write 形态、composite transaction、专用业务 store/table 和锚点事实表幂等。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 capability 到设计和验证入口映射。

## 风险与取舍（Risks / Trade-offs）

- [风险] “最小内核”被理解为 mock-only demo。 -> spec 明确非 no-op 范围必须真实实现，产品 composition 不能用测试 provider 替代真实 provider，最小 E2E 发布验收必须打真实 OpenAI endpoint。
- [风险] 模块数量多导致实现范围外溢。 -> module design 明确 deferred 能力，tasks 只覆盖一层直接依赖。
- [风险] terminal stream 早于 durable terminal fact。 -> Runtime terminal commit 成功后才发布 channel-visible terminal event；测试断言 stream/history 一致。
- [风险] read tool 泄漏本地路径或越权文件。 -> workspace guard、safe failure 和 negative tests 作为验收门槛。
- [风险] 输出或 capability result 超限时被截断但用户不可见。 -> 持久化和 stream 边界加入 no-silent-truncation guard，除 read bounded slice 外，硬上限命中统一发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：提升最小问答内核行为契约。
- `openspec/overview.md`：补充 TS 最小内核背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提升 runtime ownership、timeline/stream、terminal commit 和 no-op 边界。
- `openspec/designs/architecture/ts-backend-architecture.md`：补充最小内核交付切片。
- `openspec/designs/domain/request-run.md`：提升 RequestRun、RequestContext、assembly binding 和 terminal uniqueness。
- `openspec/designs/contracts/core-contracts.md`：提升最小 Web/runtime/context/model/capability/gateway 调用语义；同步清理旧的 `*WriteRequest`/`*AppendRequest` 形态，记录 simple write 使用 `Record + write options`、query/filter 可使用 request object、`TerminalCommitRequest` 等多事实复合事务可保留专门 request type。
- `openspec/designs/contracts/core-contracts.md`：提升同形同策原则，要求同类 contract/persistence/runtime shape 使用统一 owner、命名、shape 和验证策略，文档化例外。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提升专用 SQLite 事实表、row 私有性、锚点 `idempotency_key`、scoped unique index、message append/terminal commit 单事务和禁止 generic `records(store,key,json)`。
- `openspec/designs/modules/agent-runtime.md`：提升 runtime 组装业务语义 Record、通过 runtime-owned message port 调用 gateway composite write、terminal commit 不拆成多个 public store call。
- `openspec/designs/modules/agent-session.md`：提升领域对象/read model 与 gateway `*Record` 的映射职责，禁止向 public return 泄漏 gateway Record 或 Web alias。
- `openspec/designs/modules/*.md`：按实际模块实现提升职责、依赖和验证入口。
- `AGENTS.md`：保留跨 change 强制原则；归档同步时不得与长期 OpenSpec baseline 发生矛盾。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 待确认问题（Open Questions）

无。真实 provider 固定为最小 OpenAI path；其它 provider kind 和 fallback 由后续 change 补齐。
