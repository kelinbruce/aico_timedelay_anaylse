## ADDED Requirements

### Requirement: 最小问答主流程
TS 后端 SHALL 提供一个基于核心契约的最小 Agent 问答内核，使用户通过 Web 入口提交一个问题后，系统能够创建或使用会话、用核心契约的 submit command 接受 request、执行 Agent、调用模型、发布流式输出、提交唯一终态，并通过 history 读取一致结果。该主流程不得使用测试 provider、mock Agent 或 no-op core 替代真实问答执行路径。

#### Scenario: 用户完成一次最小问答
- **WHEN** 已配置默认 Agent assembly、真实 model provider profile、可用 session gateway 和 Web channel 的用户提交一条合法问题
- **THEN** Web channel MUST 返回 accepted response
- **AND** Runtime MUST 基于携带 `sessionId` 的 `RuntimeCommandPort.submit` command 创建或推进一个 `RequestRun`
- **AND** Agent core MUST 至少完成一次 context render 和 model invocation
- **AND** 用户 MUST 能通过 SSE stream 看到模型输出和 terminal stream event
- **AND** history MUST 能读取到该用户问题和最终 assistant message

#### Scenario: 创建或使用会话
- **WHEN** 客户端调用 `POST /api/v1/sessions`
- **THEN** Web channel MUST call the runtime session facade
- **AND** Runtime MUST resolve trusted Agent Scope through its internal resolver before delegating to `agent-session`
- **AND** Runtime MUST 委托 `agent-session` 创建 owner-scoped and agent-scoped empty `UserSession` and initialize appendable active context state
- **AND** 该 route MUST NOT 提交 request、触发 Agent core 或调用 model
- **AND** request body MUST only allow `locale?`
- **AND** `tenantId` and `subjectId` MUST come only from trusted identity boundary
- **AND** `agentId` MUST come only from Runtime internal Agent Scope resolver
- **AND** request body containing `sessionId`、`idempotencyKey`、owner fields、agent fields、title、status、deploymentMode、channel、metadata、stream path、websocket path 或其他 session detail fields MUST fail schema validation
- **AND** Web channel MUST generate a safe server-side idempotency key before session write
- **AND** repeated owner-scoped and agent-scoped session create with the same server-side/internal `idempotencyKey` MUST return the first created session and MUST NOT create a second session
- **AND** 成功响应 MUST 只返回与 session list entry 相同字段集的安全 metadata: `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** create-session response metadata MUST contain only `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** 成功响应 MUST NOT 返回 `streamPath`、`websocketPath`、conversation messages、request accepted fields、cursor 或 timeline sequence
- **WHEN** 客户端调用 `POST /api/v1/requests` 且 payload 未携带 `sessionId`
- **THEN** Web channel MUST call the runtime session facade to create an owner-scoped and agent-scoped session, then use the created `sessionId` to construct `RuntimeCommandPort.submit` command
- **AND** the child session create command MAY derive its server-side idempotency key from the submit `idempotencyKey` so repeated convenience submit returns the first accepted run without leaking extra empty sessions
- **WHEN** 合法 Web submit path 或 payload 携带 `sessionId`
- **THEN** Runtime MUST 通过 owner-scoped and agent-scoped session lookup 校验该 session 属于当前 trusted `tenantId`、`subjectId` and `agentId`
- **AND** Runtime 接收的 `RuntimeCommandPort.submit` command MUST 始终携带核心契约必填的 `sessionId`
- **AND** 该 `sessionId` MUST 写入 accepted response、`RequestRun`、user message、timeline 和后续 history query
- **AND** 跨 owner、跨 agent、缺失或不可用 session MUST 返回 safe not-found outcome and MUST NOT reveal whether the session exists under another owner or agent

#### Scenario: 同 session 并发 submit 不串写
- **WHEN** 两个合法 submit 同时进入同一个 owner-scoped and agent-scoped session
- **THEN** Runtime MUST guarantee at most one active `RequestRun` for the same owner+agent scoped session
- **AND** if an active run already exists for that session, the later submit MUST return a safe conflict/rejection
- **AND** this change MUST NOT create queued run facts, FIFO lane scheduling, replacement behavior, or terminal-pending dispatch protection
- **AND** 两个 submit MUST NOT 交叉写入彼此的 `requestId`、`runId`、timeline sequence、visible history 或 active context item
- **WHEN** 两个合法 submit 进入不同 owner-scoped or agent-scoped sessions
- **THEN** 系统 MUST NOT 串写 session、request、run、timeline 或 history 标识

#### Scenario: 测试替身不能替代产品路径
- **WHEN** 最小内核在产品 app composition 中启动
- **THEN** 测试 provider、mock Agent 或内存-only fake gateway MUST NOT 被作为唯一产品实现装配
- **AND** 测试替身只能通过 test fixture 或 test composition 显式注入

#### Scenario: Gateway-local uses dedicated fact tables and anchor idempotency
- **WHEN** SQLite gateway-local persists main-path runtime facts
- **THEN** it MUST use dedicated business tables for request runs、sessions、messages、active context state/items、timeline events and checkpoints
- **AND** it MUST NOT use a generic business record table such as `records(store,key,json)` to carry main-path persisted facts
- **AND** every idempotent write MUST define an anchor fact table and store `idempotencyKey` on that anchor table by default
- **AND** the scoped uniqueness for `idempotencyKey` MUST be built from trusted owner scope and the relevant agent/session/request/run coordinates
- **AND** duplicate scoped `idempotencyKey` writes MUST return the first anchor fact result and MUST NOT repeat side effects
- **AND** session create MUST anchor idempotency on the `sessions` fact table
- **AND** accepted request run create MUST anchor idempotency on the `request_runs` fact table
- **AND** RequestRun state updates such as executing, terminal pending and diagnostic failure MUST be modeled as version CAS transitions and MUST NOT use unanchored pseudo idempotency operation keys
- **AND** composite writes such as message append plus active context update MUST be exposed as one gateway write and complete in a single SQLite transaction
- **AND** `SessionMessageStoreGateway` MUST expose `appendSessionMessage(record, options?)` as the only public message write contract for the minimal kernel and MUST NOT expose a standalone `saveMessage(record, options?)` contract
- **AND** message append duplicates MUST be retry-safe through the same `messages` anchor fact and active-context uniqueness constraints, including the case where the message anchor exists but the active context item is missing
- **AND** persistence MUST NOT introduce a synthetic `operationKind` field when the domain fact does not contain it
- **AND** this change MUST NOT add request payload hash conflict detection; same scoped `idempotencyKey` returns the first result in this change
- **AND** an independent idempotency table/store is allowed only when an operation has no clear anchor fact table, and that exception MUST be documented in this change before implementation

### Requirement: Runtime 接受请求并固化 Agent Assembly
Runtime SHALL own trusted Agent Scope resolution for session and request admission. Runtime SHALL 在 request acceptance 阶段解析 runtime-ready Agent assembly，并将 resolved `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。请求被接受后，core、context、capability routing 和 recovery 路径 SHALL 读取同一个 assembly version，不得重新按 active version 选择。

#### Scenario: Runtime 内部解析 Agent Scope
- **WHEN** Web channel calls runtime session or submit boundaries
- **THEN** Runtime MUST resolve `agentId` through a trusted internal resolver provided by app composition
- **AND** the resolver MUST NOT be exposed as an `agent-contracts` public port
- **AND** client request body、client metadata、model output and capability arguments MUST NOT provide or override `agentId`
- **AND** current single hosted Agent product path MAY resolve the configured active hosted Agent id
- **AND** future multi hosted Agent selection MUST plug into the same runtime-owned resolver shape without making channel own Agent routing

#### Scenario: 接受请求时解析 active assembly
- **WHEN** Runtime 接受一个不携带已解析 Agent version 的 submit command
- **THEN** Runtime MUST 调用 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.active(agentId)` 解析当前 active assembly
- **AND** Runtime MUST 将 resolved `agentId`、`agentVersion` 和 `agentAssemblyRef` 持久化或记录到 `RequestRun` 和 `RequestContext`
- **AND** missing active assembly MUST produce a safe unavailable error and MUST NOT fallback to an implicit default Agent
- **AND** Runtime MUST NOT fallback 到隐式默认 Agent

#### Scenario: 已接受请求使用固定 assembly
- **WHEN** 已接受 request 进入 Agent core、Context Engine、Capability routing 或 recovery 路径
- **THEN** 调用方 MUST 通过 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.require(agentId, agentVersion)` 获取 assembly 或消费 runtime 传入的 accepted assembly facts
- **AND** active version selection MUST NOT 再用于该 request
- **AND** 后续 active assembly 变化 MUST NOT 影响该 request 的执行和恢复

#### Scenario: Session facts bind owner and agent scope
- **WHEN** Runtime creates, requires, lists or reads conversation for a session
- **THEN** Runtime MUST call `agent-session` through a domain `UserSessionPort`
- **AND** `UserSessionPort` inputs MUST carry trusted `IdentityContext` and trusted `agentId`
- **AND** returned `UserSession` MUST contain `tenantId`、`subjectId`、`agentId`、`sessionId`、optional `title`、`createdAt` and `updatedAt`
- **AND** `UserSessionPort` MUST NOT return gateway `*Record` values or Web DTO aliases
- **AND** gateway session/message/active-context queries and records MUST explicitly carry `agentId` in addition to `tenantId` and `subjectId`
- **AND** session create/list/conversation MUST fail closed for cross-owner or cross-agent access

### Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation
最小内核 SHALL 使用目标态 TS 配置所有权模型启动产品主路径。配置输入面 SHALL separate `Config`、`Resources`、`ResourceProviders` and `Plugins`; ownership SHALL separate infrastructure/adapter config、NextAgent system/component config and Agent business config. Configuration awareness SHALL belong only to `agent-app`: it reads and validates the built-in default config files plus env secret override, then converts them into internal component options、typed registries、ports and runtime-safe assembly. `agent-app` SHALL compile the hosted Agent definition and registered resources into a runtime-safe `AgentAssemblyRegistry` from `agent-contracts/agent-assembly` before runtime acceptance. Runtime、core、context、model、capability、session and gateway packages MUST consume compiled registries、typed registries and ports only and MUST NOT parse raw env/file configuration and app-internal compiler input DTOs.

#### Scenario: Current change uses built-in default configuration files
- **WHEN** product composition starts in this change
- **THEN** `agent-app/config` MUST read `packages/agent-app/config/default-system.yaml` as the built-in default system/component config
- **AND** `agent-app/assembly` MUST read `packages/agent-app/config/default-agent.yaml` as the built-in default Agent business config
- **AND** `default-system.yaml` MUST contain only active agent id、model profile credential reference、SQLite local gateway path、workspace root、local identity、local channel/auth mode and explicit no-op boundary mode
- **AND** `default-system.yaml` MUST NOT contain Agent workspace binding、Agent capability binding、client request metadata、provider raw secret、framework internal wiring and low-level adapter implementation details
- **AND** `default-agent.yaml` MUST contain only default Agent identity/version、workspace ref、model/prompt refs、capability bindings、runtime settings and resource refs
- **AND** `default-agent.yaml` MUST NOT contain SQLite file、channel transport、gateway endpoint、tenant id、subject id、provider raw secret and provider endpoint
- **AND** system runtime data required by this change MUST default under `data/system/`
- **AND** the default Agent workspace MUST resolve under `workspaces/default-agent`
- **AND** startup initialization in this change MUST only create and validate directories required by the Web question-answer main path, including the SQLite parent directory and default Agent workspace, without overwriting existing data and workspace content
- **AND** `config/application.yaml`, `config/agents/default-agent/agent.yaml`, full binary package staging, `bin/` start/stop scripts, frontend static hosting, complete logs/run management, attachment/archive/upload-temp initialization and upgrade-retention workflow MUST remain deferred from this change
- **AND** env secret override MUST provide credential values only through the app-owned credential resolver path, and `agent-app` MUST validate it before downstream composition

#### Scenario: Config ownership is not a SystemConfig catch-all
- **WHEN** product app composition starts
- **THEN** `agent-app/config` MUST be the only place that reads built-in system config and env secret override for this product composition
- **AND** `agent-app/config` MUST convert app-owned config into internal component options for local SQLite gateway, channel transport, observability/no-op boundary and provider adapter setup
- **AND** system components MUST NOT read configuration files, environment variables, secret files, config file paths, merge precedence rules and default-file creation logic
- **AND** a TS `SystemConfig`, if present, MUST be app-local validated input for NextAgent system-level facts such as deployment/auth mode、active agent id and trusted roots
- **AND** `SystemConfig` MUST NOT include adapter-owned details such as Fastify listen configuration, Kysely/SQLite driver options, OpenTelemetry/Pino wiring, provider HTTP client internals and no-op provider implementation details as a public cross-package contract
- **AND** `SystemConfig` MUST NOT contain Agent workspace、model/prompt/capability bindings、per-request owner identity、user input、current session selection、model output、capability arguments and Agent-owned runtime facts
- **AND** raw credential values MUST NOT enter system/component config and model profiles; profiles MUST use a credential reference
- **AND** raw env/file keys MUST NOT be passed to runtime、core、context、model、capability、session and gateway packages

#### Scenario: Resources and resource providers are registered separately from Agent binding
- **WHEN** product composition builds resources for the active Agent
- **THEN** it MUST register model profiles、prompt templates and capability descriptors as resources
- **AND** it MUST register resource providers such as the built-in read provider, OpenAI model profile provider and built-in Agent config loader
- **AND** resource registration MUST NOT by itself grant Agent access to any registered capability, prompt and model profile
- **AND** an Agent MUST receive access only when its `AgentDefinition` references the resource and the compiler validates the binding
- **AND** plugins, if present as definitions, MUST NOT directly mutate effective Agent assembly in this change

#### Scenario: AgentDefinition owns only per-Agent business configuration
- **WHEN** `agent-app/assembly` loads an Agent definition for the hosted active agent
- **THEN** the product definition MUST come from `packages/agent-app/config/default-agent.yaml`
- **AND** the definition MUST contain `agentId`, `agentVersion`, `displayName`, `description`, optional `workspaceDir`, `modelProfileIds[]`, `promptTemplateIds[]`, `capabilityBindings[]`, `runtimeSettings` and `resources[]`
- **AND** `runtimeSettings` MUST only allow `defaultLanguage?`, `defaultModelProfileId?`, `defaultPromptTemplateId?`, `maxToolIterations?`, `maxContextMessages?` and `requestTimeoutMs?`
- **AND** `AgentDefinition` MUST NOT contain raw credentials、provider endpoints、provider-native request bodies、database paths、SQLite file、channel transport、gateway endpoints、tenant id、subject id and client-supplied metadata
- **AND** resource paths and workspace paths MUST be normalized and MUST NOT escape trusted workspace/resource roots

#### Scenario: Startup compiler produces the only product AgentAssemblyRegistry
- **WHEN** product composition builds runtime dependencies
- **THEN** it MUST compile the hosted active `AgentDefinition` and registered resources through an app-internal startup compiler
- **AND** compiler validation MUST reject unsafe ids、active agent mismatch、missing model/prompt/capability references、invalid capability type/source、disabled bindings and unsafe workspace/resource paths
- **AND** compiler input/output DTOs, `ResourceInventory` and AgentDefinition parser/loader details MUST remain inside `agent-app`
- **AND** product composition MUST inject only the compiled `AgentAssemblyRegistry`, typed model profile registry, capability catalog and local SQLite gateway port into downstream packages
- **AND** product composition MUST NOT directly create a hardcoded default assembly registry
- **AND** runtime acceptance MUST fail closed when the registry has no active assembly
- **AND** missing `packages/agent-app/config/default-agent.yaml` MUST fail closed before runtime acceptance

#### Scenario: Model prompt and capability selection follow accepted assembly
- **WHEN** an accepted request is executed
- **THEN** model profile selection MUST use `runtimeSettings.defaultModelProfileId` when present, otherwise the first `modelProfileIds[]` entry from the accepted assembly
- **AND** the selected profile MUST exist, be enabled and use `providerKind=OPENAI` in this change
- **AND** unselected model profiles MUST NOT affect this request
- **AND** prompt selection MUST use the accepted assembly's default prompt template when present, otherwise the first prompt template reference
- **AND** capability tool visibility MUST come from accepted assembly bindings
- **AND** the built-in read capability MUST NOT be visible to the model unless it is bound in the accepted assembly

### Requirement: RequestContext 使用可恢复执行坐标
最小内核 SHALL 使用核心契约定义的 `RequestContext` 表达可恢复执行坐标。`RequestContext` SHALL NOT 包含 `attempt`、`deadlineAt` 或 `messageRefs`；这些事实必须分别从 `RequestRun`、ActiveContextView 或 current request message query 读取。

#### Scenario: RequestContext 不携带 run 控制字段
- **WHEN** Runtime 构造 `RequestContext` 并调用 Agent core
- **THEN** `RequestContext` MUST 包含 session、`requestId`、run、identity、locale、agent id/version、assembly ref、next lifecycle stage、tool batch state 和 flow variables
- **AND** `RequestContext` MUST NOT 包含 `attempt`
- **AND** `RequestContext` MUST NOT 包含 `deadlineAt`
- **AND** `RequestContext` MUST NOT 包含 `messageRefs`

#### Scenario: 当前 request 消息通过专用查询读取
- **WHEN** runtime、session 或 core 在同一次 request 主流程中需要重建 current-run message、tool-use 或 capability-result state
- **THEN** 系统 MUST 调用 `SessionMessageStoreGateway.listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)`
- **AND** 查询 MUST 携带 `tenantId`、`subjectId`、`sessionId`、`requestId`、`runId`、`includeHidden`、`offset` 和 `limit`
- **AND** 系统 MUST NOT 只按 `requestId` 查询当前 request 消息
- **AND** this change MUST NOT implement process restart recovery、checkpoint lookup recovery、`claimRun`/`listRecoverableRuns` scheduling、tool replay or multi-instance takeover

#### Scenario: ToolCallState 可恢复且结构化
- **WHEN** 模型产生 tool-use 并进入 capability invocation 阶段
- **THEN** `ToolCallState` MUST 包含 `toolCallId`、`capabilityId`、结构化 JSON arguments 和 status
- **AND** `currentToolBatchMessageId` MUST 指向当前 tool batch 的 assistant tool-use message
- **AND** current-run tool state reconstruction MUST NOT depend on reparsing raw model output
- **AND** full recovery replay of pending tool calls MUST remain deferred in this change

### Requirement: Agent Core 通过目标执行边界运行
Runtime SHALL 通过 `Agent.execute(run, context, timeline, messages, signal): Promise<void>` 调用 Agent core。Agent core SHALL 负责最小请求处理路径、context assembly、model invocation、最小 capability loop、中间执行消息追加和最终 agent message 发布，但 SHALL NOT 拥有 request lifecycle 终态。

#### Scenario: Runtime single-run dispatcher 调度 accepted run
- **WHEN** Runtime has persisted an accepted run with fixed assembly identity
- **THEN** Runtime dispatcher MUST only dispatch a persisted run that has not reached terminal state
- **AND** Runtime dispatcher MUST use `RequestRunRecord + { expectedVersion }` to CAS the run from `status=ACCEPTED` to `status=EXECUTING` before invoking Agent
- **AND** Runtime dispatcher MUST NOT invoke Agent when that CAS update does not update the run
- **AND** Runtime dispatcher MUST NOT dispatch a run whose assembly identity is missing or unresolved
- **AND** Runtime dispatcher MUST NOT create queued run facts, FIFO lane scheduling, replacement behavior, or terminal-pending dispatch protection in this change
- **AND** dispatch failure before `Agent.execute` MUST be normalized as safe failure and enter terminal commit path when a run has been accepted

#### Scenario: Runtime 调用 Agent.execute
- **WHEN** Runtime 将 accepted run 调度到执行阶段
- **THEN** Runtime MUST 调用 `Agent.execute(run, context, timeline, messages, signal)`
- **AND** `run` MUST 是 authoritative `RequestRun`
- **AND** `signal` MUST 是 runtime-owned `AbortSignal`
- **AND** `timeline` MUST be the runtime-owned timeline wrapper that canonicalizes emitted events
- **AND** `messages` MUST be the runtime-owned message append port that stamps trusted run/context coordinates before writing session messages
- **AND** Agent.execute 正常 resolve MUST 表示 Agent 主体执行完成
- **AND** Agent.execute reject MUST 由 Runtime 归一化为 request failure path

#### Scenario: Agent 通过 timeline 发布事实
- **WHEN** Agent 产生 planning、model delta、capability lifecycle、capability result 或 final agent message
- **THEN** Agent MUST 调用 `RunTimelineEventPort.emit(event): Promise<void>`
- **AND** Runtime MUST 填充或覆盖 runtime-owned timeline 字段后才使事件成为 canonical
- **AND** Agent MUST NOT 发布 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`

### Requirement: Context 和 Model 调用边界
Agent core SHALL 通过 Context Engine 组装和渲染模型输入，并在进入 `agent-model` 前将 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`。`agent-model` SHALL 只接收模型调用契约，不接收 context assembly、rendered input、provider SDK 类型或 runtime streaming context。

#### Scenario: Context Engine 生成 RenderedModelInput
- **WHEN** Agent core 准备调用模型
- **THEN** Agent core MUST 调用 `ContextEnginePort.assemble(...)` 和 `ContextEnginePort.render(...)`
- **AND** `ContextAssemblyRequest` MUST only carry `sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale` and `purpose`
- **AND** `ContextAssemblyRequest` MUST NOT carry `rootMessageId`、`historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` or `budget`
- **AND** Context Engine MUST 从 active context view 和必要 session message records 生成模型可见上下文
- **AND** Context Engine MUST 包含当前 request、必要会话历史、locale、owner metadata 和可见 capability metadata
- **AND** RenderedModelInput MUST 包含 request locale/language hint
- **AND** `RenderedModelInput` MUST NOT contain complete `ContextAssembly`
- **AND** 默认 system prompt section MUST 明确要求保留电信术语原文
- **AND** 模型可见 user、assistant tool-use、capability result 和 assistant terminal message MUST use a gateway composite write that persists the message and appends the active context item in one transaction
- **AND** standalone `ActiveContextStoreGateway.appendItem` MUST still use `expectedActiveContextVersion` and `activeContextVersion` version conflict results when the active-context CAS primitive is invoked directly

#### Scenario: ModelInvocationRequest 扁平化
- **WHEN** Agent core 调用 `ModelInvocationService.complete(...)` 或 `ModelInvocationService.stream(...)`
- **THEN** 请求 MUST 是扁平 `ModelInvocationRequest`
- **AND** 请求 MUST 包含 `requestId`、`stepId`、`providerKind`、`modelName`、`baseUrl`、`credentialRef`、`ChatMessage[]`、tools、`temperature`、`maxTokens`、`topP`、`thinking`、provider options 和 `timeoutMs`
- **AND** 请求 MUST NOT 包含 `ContextAssembly`
- **AND** 请求 MUST NOT 包含 `RenderedModelInput`
- **AND** 请求 MUST NOT 包含 provider SDK、AI SDK 或 runtime streaming context 对象

#### Scenario: 调用模式由方法选择
- **WHEN** Agent core 需要非流式或流式模型调用
- **THEN** 非流式调用 MUST 使用 `ModelInvocationService.complete(...)`
- **AND** 流式调用 MUST 使用 `ModelInvocationService.stream(...)`
- **AND** request payload MUST NOT 使用字段表达调用模式

### Requirement: 最小真实 Model Provider
最小内核 SHALL 在 `agent-model` 中提供一个可配置的真实 OpenAI provider 路径，并提供可替换测试 provider fixture。真实 provider SHALL 负责 provider request 构造、stream normalization、tool-use normalization 和 safe provider error mapping 的最小可用能力。最小端到端发布验收 SHALL 使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint；deterministic/test provider 可以用于单元、contract 和 characterization tests，但不得替代最小 E2E 发布验收。

#### Scenario: 产品配置使用真实 provider
- **WHEN** app composition 加载启用的 model profile
- **THEN** 产品路径 MUST 使用 `providerKind=OPENAI` 的共享 model profile
- **AND** model name、base URL、credential reference、model options、provider options 和 `timeoutMs` MUST 来自产品配置映射后的共享 profile shape
- **AND** OpenAI-specific env 或 raw credential MUST NOT 穿透到 runtime、core 或 `ModelInvocationRequest`
- **AND** OpenAI provider adapter MUST 在 provider 边界内通过安全 credential resolver 解析 `credentialRef`
- **AND** raw credential MUST NOT 进入 stream、history、audit、timeline、safe error、gateway record 或日志 payload
- **AND** provider unavailable、timeout 或 provider error MUST 被映射为 SafeError
- **AND** product composition MUST NOT use deterministic/test provider as its default model provider
- **AND** product configuration MUST NOT allow selecting deterministic/test provider as a product model provider in this change

#### Scenario: 最小 E2E 使用真实 OpenAI endpoint
- **WHEN** developer runs the minimal product-path E2E acceptance for this change
- **THEN** the test MUST use product composition with the OpenAI adapter factory
- **AND** the model call MUST reach a real OpenAI endpoint using a configured `credentialRef`
- **AND** deterministic/test provider results MUST NOT satisfy this E2E acceptance
- **AND** fake HTTP server or provider test fixture MAY be used only for adapter/unit tests and MUST NOT replace the product-path E2E acceptance

#### Scenario: 模型流被归一化
- **WHEN** 真实 provider 返回 thinking、content、tool-use 或 final result stream fragment
- **THEN** `agent-model` MUST 转换为核心模型 contract 中的 stream delta 或 final result
- **AND** provider-native chunk、SDK object 和 raw error MUST NOT 泄漏到 core、runtime、channel 或 contracts
- **AND** OpenAI tool-use arguments 分多块返回时，adapter MUST 按稳定 `toolCallId` 聚合为结构化 tool call
- **AND** OpenAI profile 不支持 thinking 输出时 MUST NOT 伪造 `LLM_THINKING_DELTA`

#### Scenario: 模型超时失败
- **WHEN** OpenAI provider 或 model boundary 超时且本 change 没有 fallback 路径
- **THEN** 系统 MUST 归一化 safe timeout error
- **AND** runtime/core MUST 发布 canonical `DEGRADATION_NOTICE`
- **AND** request MUST 以 safe `REQUEST_FAILED` terminal outcome 结束

### Requirement: 最小 Capability Read Tool
最小内核 SHALL 使用统一 capability catalog/invocation 边界处理模型 tool calls。当前产品 assembly SHALL 只启用一个内置 `read` 工具。该工具 SHALL 作为 capability descriptor 进入 context/model tool metadata，并通过 `CapabilityInvocationPort` 调用。`CapabilityInvocationRequest` SHALL contain only `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs` and `idempotencyKey?`; it SHALL NOT contain `workspaceDir` or `recoveryReplay`. 未启用或不可解析的 capability/tool call SHALL NOT 绕过 capability boundary，MUST 以 unavailable safe outcome 处理。

#### Scenario: read 工具被披露并可调用
- **WHEN** 默认 Agent assembly 启用内置 `read` capability
- **THEN** Context Engine MUST 能把 read tool 的 schema 披露给模型
- **AND** read tool model-visible input schema MUST use canonical argument names: required `file_path`, optional `offset`, optional `limit`
- **AND** `file_path` MUST mean workspace-relative single-file path
- **AND** Agent core MUST 能把模型产生的 read tool call 映射为 capability invocation
- **AND** assistant tool-use message MUST 先带 tool call metadata 持久化，之后 capability invocation 才能被视为当前 batch state
- **AND** capability lifecycle timeline/SSE projection MUST carry stable `toolCallId`
- **AND** capability invocation result MUST 以 visible `role=CAPABILITY_RESULT` 的 `SessionMessage` 进入同一 request/run
- **AND** 普通 history 默认不返回 capability result message，`includeCapabilityResults=true` 时可返回 visible capability result records
- **AND** 后续 model render MUST 通过 active context view 看到 assistant tool-use message 和 capability result

#### Scenario: 未启用 capability 不进入产品路径
- **GIVEN** 当前产品 assembly 只启用内置 `read`
- **WHEN** 模型返回 `write`、`bash`、Skill tool、remote Agent 或其它未启用 capability/tool call
- **THEN** Agent core MUST NOT execute the tool outside `CapabilityInvocationPort`
- **AND** Runtime/Core MUST publish `DEGRADATION_NOTICE` and end the request with safe `REQUEST_FAILED`
- **AND** logs、stream、history 和 SafeError MUST NOT expose raw tool arguments or host paths

#### Scenario: read 工具遵守 workspace 边界
- **WHEN** read capability 请求读取文件
- **THEN** 工具 MUST 只接受 `file_path` as workspace-relative 单文件路径
- **AND** 绝对路径、路径逃逸、目录读取、glob pattern、权限拒绝、timeout 或 abort MUST 返回 safe capability failure，并导致 request 发布 `DEGRADATION_NOTICE` 后以 `REQUEST_FAILED` 结束
- **AND** 缺失文件或普通 IO failure MAY 作为 safe tool result 交给模型继续生成答复
- **AND** `offset` MUST mean 0-based start line and default to `0`
- **AND** `limit` MUST mean maximum line count and default to `2000`
- **AND** `offset` and `limit` MUST be integers, `offset` MUST be greater than or equal to `0`, and `limit` MUST be between `1` and `2000`; invalid values MUST fail capability input schema validation
- **AND** successful payload MUST 受 line-based `offset`、`limit` 和最大输出大小约束
- **AND** successful payload MUST contain `file_path`、`offset`、`limit`、`content`、`truncated` and optional `nextOffset`
- **AND** successful payload `file_path` MUST be a normalized workspace-relative path and MUST NOT expose host absolute path
- **AND** 超限时 MUST 返回 bounded slice，并显式包含 `truncated=true` 和 `nextOffset`
- **AND** safe failure MUST NOT 泄漏未脱敏宿主路径、credential 或未授权对象内容

#### Scenario: tool loop 受最小上限约束
- **WHEN** 同一模型响应产生多个 read tool calls
- **THEN** Agent core MUST 按出现顺序串行执行，不并行执行
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=3`
- **AND** 每轮最多执行 `maxToolCallsPerRound=5`
- **AND** 超过上限时 MUST NOT 执行部分集合后继续
- **AND** 系统 MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效

### Requirement: Web Submit Stream And History
`agent-channel-web` SHALL 提供最小 submit、SSE stream 和 history read 行为。Web channel SHALL 只负责 transport、runtime facade 调用、runtime timeline 订阅、Web DTO schema/projection 和 stream projection，不得拥有 request lifecycle、Agent routing、session contract、canonical replay truth 或 terminal history truth。

#### Scenario: Web route table 与最小范围一致
- **WHEN** 产品 Web API 启动
- **THEN** route registry MUST expose `GET /api/v1/sessions`
- **AND** route registry MUST expose `POST /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation`
- **AND** route registry MUST expose `POST /api/v1/sessions/{sessionId}/requests`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/stream`
- **AND** route registry MUST expose TS convenience submit `POST /api/v1/requests`
- **AND** route registry MUST NOT expose `GET /api/v1/sessions/{sessionId}` in this change
- **AND** route registry MUST NOT expose WebSocket、user-input、cancel、retry、edit、attachment upload/download、title 或 feedback routes as product behavior in this change

#### Scenario: Submit 返回最小 accepted response
- **WHEN** Web channel 接受合法 submit request
- **THEN** channel MUST 从 auth/channel boundary 注入可信 identity
- **AND** channel MUST call runtime session/request boundaries and MUST NOT call `agent-session` directly
- **AND** channel MUST NOT define a channel-owned session abstraction
- **AND** channel MUST 调用 Runtime command boundary
- **AND** `RuntimeCommandPort.submit` command MUST 携带 `sessionId`
- **AND** session-scoped submit request body MUST require non-blank `inputText` and `idempotencyKey`
- **AND** submit request body MAY include `locale?` and `attachments?: []`
- **AND** public `attachments?: []` in this change MUST mean empty attachment id refs and MUST be mapped to core `attachmentIds=[]`
- **AND** `agent-channel-web` MUST be the only boundary that accepts the public `attachments?: []` compatibility field
- **AND** `agent-runtime`、`agent-session`、`agent-core` and gateway ports MUST NOT receive `attachments`; channel MUST normalize it to core `attachmentIds=[]` before calling Runtime command boundary
- **AND** TS convenience submit request body MAY include `sessionId?` in addition to the same submit fields
- **AND** submit request body containing client-provided `requestId`、`language`、`submittedAt`、owner 字段、agent 字段、metadata 或其他 non-minimal envelope fields MUST fail schema validation
- **AND** `attachmentIds` field, non-empty `attachments`, attachment object, upload ref or attachment metadata MUST fail runtime schema validation
- **AND** 本 change 中 `RuntimeCommandPort.submit` command 的 `attachmentIds` MUST 为空数组
- **AND** Runtime 持久化 `RequestRun`、session message、active context item、timeline event 和 terminal commit 时 MUST 使用核心契约定义的 `idempotencyKey`、`expectedVersion` 或 `expectedActiveContextVersion`
- **AND** accepted response MUST 只返回 `sessionId`、`requestId`、`runId` 和 `attempt`
- **AND** `POST /api/v1/requests` 与 `POST /api/v1/sessions/{sessionId}/requests` 成功时 MUST 返回相同 accepted DTO
- **AND** accepted response MUST NOT 返回 `streamPath`、`createdSession`、stream cursor、`acceptedSequence` 或 timeline sequence 字段

#### Scenario: SSE 从 runtime timeline 投影
- **WHEN** 客户端在提交后打开 SSE stream
- **THEN** channel MUST 默认使用 `lastSeenSequence=0`，也可使用客户端持有的 session-scoped cursor
- **AND** channel MUST 调用 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence, requestId?, runId? })`
- **AND** channel MUST project runtime events to public `StreamEnvelope` rather than exposing runtime timeline records as Web DTOs
- **AND** optional `requestId/runId` MUST only be filters and MUST NOT reset session-scoped sequence
- **AND** channel MUST 将 canonical timeline event 投影为 `StreamEnvelope`
- **AND** stream event name MUST match shared canonical `StreamEventType` vocabulary
- **AND** 最小可投影子集 MUST include `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`REQUEST_COMPLETED`、`REQUEST_FAILED` 和 `DEGRADATION_NOTICE`
- **AND** 未实现能力对应的 `REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 和 `USER_INPUT_CANCELED` MUST NOT be produced by product path in this change
- **AND** channel MUST NOT 伪造与 runtime timeline 冲突的执行事实
- **AND** WebSocket 行为不属于本变更验收范围

#### Scenario: History 通过 runtime session facade 读取
- **WHEN** 客户端读取 session list 或 conversation history
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST 将 domain `ListUserSessionsQuery` 映射为 gateway-owned `SessionHistoryRecordQuery` 后调用 `SessionStoreGateway.listSessions(...)`
- **AND** `agent-session` MUST 将 domain `ListSessionMessagesQuery` 映射为 gateway-owned `ListSessionMessagesRecordQuery` 后调用 `SessionMessageStoreGateway.listMessages(...)`
- **AND** public `GET /api/v1/sessions` query MUST only allow `offset?` and `limit?`
- **AND** `SessionHistoryRecordQuery` MUST 携带 `tenantId`、`subjectId`、`agentId`、`offset` 和 `limit`
- **AND** `SessionHistoryRecordQuery` MUST NOT contain `includeSuperseded`
- **AND** session list MUST be stably ordered by `updatedAt desc, sessionId asc`
- **AND** session list response MUST contain `entries`、`offset`、`limit` and `hasMore`
- **AND** each session list entry MUST contain only `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** session list entry `displayTitle` MUST be projected from internal `title?` or a safe default title
- **AND** session list entry `lastActivityAt` MUST be projected from internal `updatedAt`
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `displayTitle` and `lastActivityAt` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use canonical/internal fields such as `title?` and `updatedAt`, and MUST NOT receive or return public session list alias names
- **AND** `agent-session` and gateway/internal contracts MUST NOT return non-minimal session list summary fields such as `lastMessagePreview`、`lastRequestStatus` or `hasInFlightRequest`
- **AND** session list response MUST NOT expose `tenantId`、`subjectId`、`agentId`、`includeSuperseded`、`nextCursor`、`title`、`updatedAt`、`lastMessagePreview`、`lastRunStatus`、`hasInFlightRequest`、stream path、websocket path or conversation messages
- **AND** `ListSessionMessagesRecordQuery` MUST 携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选 `requestId`、可选 `locale`、固定 `includeHidden=false`、`includeCapabilityResults`、可选 `beforeCursor` 和 `limit`
- **AND** conversation history MUST default to latest visible message window
- **AND** conversation response items MUST be ordered by `createdAt asc, messageId asc`
- **AND** public conversation query MUST use `cursor?` as the older-record cursor and map it to internal `beforeCursor`
- **AND** internal conversation page MUST return optional `nextBeforeCursor`; channel MUST project it to public `nextCursor`
- **AND** conversation response MUST return `nextCursor` for loading older records and MUST set it to null or omit it when no older records remain
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `cursor` and `nextCursor` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use `beforeCursor` and `nextBeforeCursor` for older-record pagination, and MUST NOT receive or return public conversation cursor alias names
- **AND** public Web API MUST NOT expose `includeHidden`
- **AND** `includeCapabilityResults` MUST default to `false`
- **AND** history MUST 使用 visible SessionMessage records 作为最终对话内容来源

### Requirement: Terminal Consistency And Safe Error
最小内核 SHALL 保证每个 accepted request 产生唯一终态，并保证 terminal stream、RequestRun terminal state 和 visible history 一致。所有跨边界失败 SHALL 被归一化为 SafeError，不得向用户、stream、history、audit 或日志泄漏敏感原始内容。

#### Scenario: 请求产生唯一终态
- **WHEN** 本 change 范围内的 Agent execution 正常完成或失败
- **THEN** Runtime MUST persist or update `RequestRun.terminalCommitState=PENDING` before attempting durable terminal commit
- **AND** Runtime MUST 通过 terminal commit contract 在一个 gateway transaction 内持久化 terminal message、active context item、terminal event 和 RequestRun terminal state
- **AND** terminal commit MUST 同时使用 compare-and-set 和 idempotency key 防止双终态
- **AND** successful terminal commit MUST persist `RequestRun.terminalCommitState=COMMITTED`
- **AND** channel-visible `REQUEST_COMPLETED` 或 `REQUEST_FAILED` terminal stream event MUST only appear after runtime terminal commit succeeds
- **AND** terminal durable commit failure MUST NOT publish completed/failed final stream
- **AND** terminal durable commit failure after `PENDING` MUST attempt to update the run to diagnosable internal `FAILED` terminal commit state
- **AND** if that diagnostic update also fails, the run MUST remain in diagnosable internal `PENDING` terminal commit state
- **AND** diagnosable terminal commit failure state MUST NOT be treated as a user-visible terminal outcome in this change
- **AND** canceled 或 superseded 用户能力不属于本 change 验收范围，不能通过本 change 新增用户可见 control route 或 replacement 行为

#### Scenario: Stream terminal 与 history 一致
- **WHEN** stream 已投影 request terminal event
- **THEN** 后续 history read MUST 能看到与该 terminal event 一致的最终 visible assistant message 或 safe failure outcome
- **AND** stream replay MUST NOT 被作为最终 conversation history 的权威来源

#### Scenario: 输出超限不得静默截断
- **WHEN** model delta、capability result 或 terminal assistant message 超过本 change 配置的持久化或 stream 安全大小限制
- **THEN** 系统 MUST NOT 静默截断用户可见内容
- **AND** except for read capability line-based bounded slices that explicitly return `truncated=true` and `nextOffset`, Runtime、Agent core 或对应 boundary MUST publish `DEGRADATION_NOTICE` and end the request with safe `REQUEST_FAILED`
- **AND** 超限处理 MUST NOT 把 raw prompt、raw model output、tool result、附件内容、credential 或未脱敏路径写入 SafeError、stream、history、audit 或日志
- **AND** 自动 output continuation flow 不属于本 change；若未来恢复该能力，MUST 新增独立 change

#### Scenario: Safe error 不泄漏敏感内容
- **WHEN** runtime、channel、context、model、capability、gateway、hook、checkpoint 或 audit boundary 返回失败
- **THEN** 对外响应 MUST 使用 SafeError shape
- **AND** SafeError、stream payload、history message 和 audit safe summary MUST NOT 包含 raw prompt、model output、stream delta、raw provider error、tool arguments、tool result、raw credential、token、附件内容或未脱敏路径

#### Scenario: 内部 cancellation 传播但不暴露用户 cancel route
- **WHEN** runtime、core、model、capability 或 timeline stream 慢边界执行
- **THEN** 调用 MUST 使用 async contract and accept `AbortSignal`
- **AND** Gateway public port MUST 使用 async contract
- **AND** 当前 gateway-local SQLite local atomic persistence transaction MUST 以一致性为先，不承诺事务中途 abort
- **AND** 远程、长耗时或可取消的 Gateway cancellation MUST be deferred from this change
- **AND** internal abort MUST propagate to downstream slow boundaries
- **AND** internal abort trigger in this change MUST be limited to internal timeout、server shutdown、test-injected abort and transport disconnect cleanup
- **AND** internal abort MUST be normalized as safe failure/degradation
- **AND** product Web API MUST NOT expose user-visible cancel route in this change
- **AND** runtime command boundary MUST NOT add user cancel command or request-control command in this change
- **AND** internal abort MUST NOT persist user-canceled terminal state or request-control state
- **AND** internal abort MUST NOT be projected as `REQUEST_CANCELED` unless a later request-control change defines that behavior

### Requirement: Owner Scope And No-op Boundaries
最小内核 SHALL 贯穿 `tenantId` 和 `subjectId` owner scope，并在主路径持久化事实中贯穿可信 `agentId`。hook、checkpoint 和 audit 这些一层直接依赖 SHALL 调用对应 boundary 且装配默认 no-op 实现。No-op SHALL 仅用于不影响一次问答成立的依赖，且不得改变后续真实 provider 的调用语义。

#### Scenario: Owner scope 来自可信 channel/auth boundary
- **WHEN** Web channel 构造 submit、stream 或 history query
- **THEN** `tenantId` 和 `subjectId` MUST 来自可信 identity context
- **AND** 请求体、客户端 metadata、模型输出或 capability arguments 中的 owner 字段 MUST NOT 覆盖当前身份
- **AND** 跨 owner 或跨 agent session、message、run、timeline 或 history 访问 MUST 返回 safe not-found outcome

#### Scenario: No-op hook checkpoint audit 被主流程调用
- **WHEN** 最小内核执行一次合法问答
- **THEN** Runtime 或对应模块 MUST 调用 lifecycle hook boundary in the main flow
- **AND** Runtime MUST 调用 `CheckpointStoreGateway.saveCheckpoint` 或本 change 定义的最小 checkpoint save boundary in the main flow
- **AND** Runtime、capability 或 terminal path MUST 调用 `AuditEventWriter` 或本 change 定义的 audit boundary in the main flow
- **AND** default hook/checkpoint/audit providers MUST be explicit product composition providers, not missing dependencies or test-only stubs
- **AND** 默认 lifecycle hook provider MUST only return continue/no-op outcome and MUST NOT change model profile、tools、context、terminal state、degradation strategy or security decision
- **AND** 默认 checkpoint provider MUST NOT write checkpoint record and MUST NOT support lookup/recovery
- **AND** 默认 audit writer MUST NOT persist audit record、ring buffer or debug read interface
- **AND** real policy hook execution、checkpoint persistence/recovery and durable audit store MUST remain deferred
- **AND** no-op calls MAY be verified through test spy/sink
- **AND** no-op provider MUST NOT 掩盖 owner scope、agent scope、terminal consistency、safe error 或问答结果所需行为

### Requirement: Scope Boundary For In-scope And Deferred Behavior
最小内核 SHALL 严格区分 `real`、`minimal`、`noop` 和 `deferred` 范围。范围内标记为 `real` 或 `minimal` 的行为 MUST 提供真实实现；明确 deferred 的能力 MUST NOT 隐式进入最小内核。

#### Scenario: 范围内行为不得降级为占位
- **WHEN** 行为直接决定问答结果、流式可见性、终态一致性、用户可操作状态或安全边界
- **THEN** TS 最小内核 MUST 提供真实实现
- **AND** 系统 MUST NOT 使用 mock、测试替身、空实现或只返回固定响应的占位逻辑替代该行为
- **AND** any behavior on the Web submit -> terminal/history main path MUST satisfy the concrete contract, schema, state, event, owner-scope, agent-scope and verification requirements defined by this change
- **AND** behavior outside that main path MUST NOT be partially implemented as product behavior

#### Scenario: Deferred 能力不进入最小内核
- **WHEN** 能力属于附件、多工具、多 Skill source、长期记忆、WebSocket、取消/重试/编辑完整能力、多实例 recovery、terminal retry/takeover、远端 Agent 或 output continuation
- **THEN** TS 最小内核 MUST NOT 隐式实现这些二层或 deferred 能力
- **AND** Web submit MUST NOT 接收或绑定用户附件；若请求包含非空附件输入，MUST fail schema validation
- **AND** 若主流程必须保留调用点，只能按本规格 no-op 约束处理

### Requirement: Productized Package Module Structure
最小内核 SHALL 以产品化 TypeScript 后端 package 结构交付。核心 implementation package MUST NOT 将主流程实现集中在单个 `src/index.ts` 中；`src/index.ts` SHALL serve as a public barrel or explicitly documented lightweight factory export only. Package 内部目录结构 SHALL follow `designs/module-structure.md` unless a package is explicitly classified as a minimal stub package by that design.

#### Scenario: Product implementation packages depend only through common and authorized contracts
- **WHEN** product implementation packages other than `agent-app` declare workspace dependencies or import cross-package code
- **THEN** they MUST NOT depend on another implementation package
- **AND** cross-module collaboration MUST use `agent-common` and explicitly authorized `agent-contracts/<subpath>` public exports only
- **AND** this guard MUST cover both TypeScript source imports and `package.json` workspace dependency declarations
- **AND** `agent-app` MAY depend on implementation packages only as the composition root, and that exception MUST NOT be available to other packages
- **AND** tests, fixtures and `agent-test-kit` MAY have a separate test-only dependency policy

#### Scenario: Contract subpath imports follow architecture allowlist
- **WHEN** a product package imports `@nextagent/agent-contracts/<subpath>`
- **THEN** the imported subpath MUST be present in the package-specific allowlist defined by `designs/module-structure.md`
- **AND** product code MUST NOT import from the `@nextagent/agent-contracts` root aggregate export
- **AND** the allowlist MUST be based on architecture ownership and cycle prevention, not on the subpaths currently imported by implementation code
- **AND** runtime-safe Agent assembly facts MUST be imported from `agent-contracts/agent-assembly`, not from `agent-contracts/runtime`
- **AND** `agent-contracts/agent-assembly` MUST NOT contain `Agent`, `AgentDefinition`, compiler/loader/parser types, raw config, provider credential, gateway config or channel config
- **AND** `agent-core` MUST NOT import `agent-contracts/gateway`
- **AND** `agent-context-engine` MUST NOT import `agent-contracts/runtime`
- **AND** `agent-channel-web` MUST import only channel/runtime contracts and MUST NOT import session、gateway、model or capability contracts
- **AND** gateway adapter packages MUST import only gateway contracts
- **AND** model packages MUST import only model contracts
- **AND** capability packages MAY import only capability and agent-assembly contracts
- **AND** any new contract subpath consumption MUST require updating the OpenSpec design and architecture tests before implementation

#### Scenario: 核心 package 不以单文件实现交付
- **WHEN** 开发者检查 `agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app`
- **THEN** each package MUST organize implementation under responsibility-specific directories such as lifecycle、timeline、terminal、agent、tools、routes、schemas、providers、catalog、assembly、services、stores or composition according to `designs/module-structure.md`
- **AND** `src/index.ts` MUST NOT contain request lifecycle implementation、Agent execution loop、Fastify route registration logic、provider SDK calls、capability read implementation、context render logic、gateway store implementation or schema validation bodies
- **AND** preserving all public package exports MUST be part of the refactor acceptance

#### Scenario: 测试夹具和产品 composition 分离
- **WHEN** product composition is built
- **THEN** it MUST NOT import deterministic/test provider、test gateway、test clock/id generator or test-only helpers from `testing/` entries
- **AND** deterministic/test helpers MAY be exported only through explicit `testing/` package entries or test-kit packages
- **AND** unit, contract and characterization tests MAY use those testing entries without introducing cross-package private path imports

#### Scenario: Architecture guard prevents demo-style regression
- **WHEN** `npm run lint:architecture` runs
- **THEN** it MUST fail on cross-package private path imports
- **AND** it MUST fail when product code imports another package's `testing/` entry
- **AND** it MUST include a guard that the core implementation packages listed in this requirement are not delivered as single implementation files
- **AND** productized module restructuring MUST NOT change Web API behavior、stream event vocabulary、runtime command shape、model invocation shape、capability invocation shape、owner scope、safe error handling or terminal consistency

#### Scenario: Architecture and contract guards preserve the session scope boundary
- **WHEN** Web session create, session list, conversation history, convenience submit and session-scoped submit tests run
- **THEN** Web API observable behavior MUST preserve owner+agent isolation, reject client-supplied owner/agent fields, and expose only public Web DTO fields
- **AND** runtime public-boundary tests MUST show accepted session/run facts are scoped by trusted identity and trusted Agent Scope without accepting client-provided Agent Scope
- **AND** session public contract tests MUST expose only domain session objects/read models and MUST NOT expose Web DTO aliases, gateway records or gateway-local rows
- **AND** gateway public contract tests MUST require owner+agent scoped session/message/active-context record/query shapes
- **AND** architecture tests MAY use representative category-level negative fixtures for forbidden cross-package dependencies, runtime-internal resolver leakage, DTO/Record boundary leakage and product-path test fixture leakage
- **AND** these architecture/source assertions MUST correspond only to architecture boundaries or forbidden patterns and MUST NOT lock down private call order, helper names, directory internals or individual historical symbol names

### Requirement: Minimal Kernel Verification
最小内核 SHALL 提供可重复验证路径，覆盖端到端问答、stream/history 一致性、安全边界、assembly 固化、no-op 调用和架构边界。没有可重复验证路径的任务不得视为完成。

#### Scenario: 验证命令覆盖主路径和边界
- **WHEN** 开发者从仓库根目录验证本变更
- **THEN** `npm run build` MUST 编译通过
- **AND** `npm test` MUST 执行最小内核 unit 和 characterization tests
- **AND** `npm run test:contract` MUST 执行 contract tests
- **AND** `npm run lint:architecture` MUST 阻止 forbidden dependency、private import、framework leakage 和 provider SDK 泄漏
- **AND** `openspec validate --all --strict` MUST 通过
- **AND** `npm run lint:architecture` MUST include a dependency-cruiser rule that fails on cross-package private path import
- **AND** `npm run lint:architecture` MUST fail when a non-app product implementation package imports or declares a dependency on another implementation package
- **AND** `npm run lint:architecture` or an equivalent architecture test MUST fail when product code imports an unauthorized `agent-contracts` subpath or the `agent-contracts` root aggregate export

#### Scenario: Negative cases 被断言失败
- **WHEN** 测试触发跨 owner 访问、重复 terminal commit、active assembly 重新选择、缺失 current request query owner scope、provider raw error 泄漏、read 工具路径逃逸或 no-op 边界未调用
- **THEN** 对应测试 MUST 断言系统失败或拒绝
- **AND** 失败 MUST 以 safe error、contract test failure 或 architecture lint failure 表达
