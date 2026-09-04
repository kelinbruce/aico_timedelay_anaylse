## 背景与问题（Why）

TS 后端已经建立架构边界和核心契约，下一步必须把这些契约落到一个可运行的最小 Agent 内核中。当前风险不是缺少更多抽象，而是 runtime、Web channel、session、core、context、model、capability、gateway 和 app composition 各自按局部假设实现主流程，导致 request lifecycle、Agent assembly 版本绑定、timeline/stream、terminal commit、history consistency、owner scope、agent scope 和 safe error 在跨模块协作时出现竞争事实。

本变更处理“用户通过 Web 提交一个问题并获得一致流式回答和历史结果”的最小闭环。范围内的 `real` 和 `minimal` 能力必须按本 change 明确列出的接口、状态机、schema、stream event、gateway query、owner scope、agent scope 和验证项实现；只有明确不影响一次问答成立、但主流程必须保留调用点的一层直接依赖，才允许使用 no-op。

主流程裁剪原则：Web submit/session route -> runtime session/request facade -> runtime-owned Agent Scope resolution -> agent-session -> runtime -> Agent core -> context -> model -> enabled capability invocation（当前产品只暴露 read）-> follow-up model -> timeline/SSE -> terminal commit -> history 实际经过的路径必须满足本 change 对应的可验收规格；不在该主流程路径上的能力不得半实现，只能按 no-op、disabled descriptor 或 unavailable safe outcome 处理。

本 change 还必须定义并落实每个 package 的产品化源码目录结构。最小内核不能以核心包单文件 `src/index.ts` 的 demo 风格作为完成状态；`index.ts` 必须收敛为 public barrel，runtime/core/channel/model/capability/context/session/gateway/app 等实现必须按职责拆分，并通过 architecture/test 验证防止后续 change 在错误结构上继续扩展。

本 change 进一步收紧跨 package 依赖门禁：除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 不得依赖其它 implementation package；跨模块协作只能通过 `agent-common` 和架构授权的 `agent-contracts/<subpath>`。第二层 subpath 授权必须从循环依赖风险和模块职责边界出发定义目标矩阵，不得因为当前实现已经导入某个 subpath 就把它白名单化。`agent-core` 不应直接消费 gateway persistence contract；`agent-context-engine` 不应把 runtime lifecycle contract 当作 assembly 查询入口；这些若在当前代码中存在，应作为架构收敛任务处理。

配置目标：本 change 的产品主路径必须落地目标态 TS 实例化模型，但当前尚未进入打包部署和本地运行包阶段。当前唯一实施路径是由 `agent-app` 读取两份内置配置文件：`packages/agent-app/config/default-system.yaml` 承载默认系统配置，`packages/agent-app/config/default-agent.yaml` 承载默认 Agent 业务配置。配置输入面分为 `Config`、`Resources`、`ResourceProviders` 和 `Plugins`；配置所有权分为基础设施/adapter 配置、NextAgent system/component 配置和 Agent 业务配置。TS 版本不得把所有配置塞进 public `SystemConfig`，也不得把 Agent 配置、SQLite/channel/no-op/provider adapter 细节混进同一个总配置对象。配置来源只允许 `agent-app` 感知：`agent-app` 读取、校验内置默认配置和 env secret override，再转换为内部组件构造参数、typed registries、ports 和 runtime-safe `AgentAssemblyRegistry` from `agent-contracts/agent-assembly`。runtime、core、context、model、capability、session、gateway 等组件不得读取配置文件和环境变量。最小内核仍只启用当前主路径需要的 OpenAI provider、SQLite session/message/run/timeline/active-context store 和内置 read capability，但不得把“单个全局 OpenAI profile”、“硬编码默认 assembly”作为产品目标形态。

范围收紧：本地运行包中的 `config/`、`config/agents/`、`workspaces/`、`data/system/`、`logs/`、`run/` 目录语义是后续打包 change 的目标边界，不代表本 change 要实现完整打包分发能力。本 change 只实现 Web 问答主流程直接经过的最小配置依赖：读取/校验内置默认系统配置、读取/校验内置默认 Agent 配置、选择 OpenAI model profile、提供 SQLite local gateway 目标路径、解析默认 Agent workspace，并把这些编译为 runtime-safe assembly 和注入参数。`config/application.yaml`、`config/agents/default-agent/agent.yaml`、`bin/` 启停脚本、zip/staging、前端静态资源托管、完整 runtime directory initialization、升级保留流程、附件/归档/upload-temp 产品能力、服务化运行包和远端 gateway profile 均不进入本 change。

## 变更范围（What Changes）

- 基于已实现的 TS 后端架构和核心契约，交付问答主流程的一层直接依赖：Web submit/session route、runtime-owned Agent Scope resolution、owner+agent scoped session preparation、message persistence、runtime lifecycle、Agent execution、context render、model invocation、通用 capability catalog/invocation 规格下的最小 read capability、canonical timeline、SSE stream projection、history read 和 terminal commit；同时对核心 user session contract 做最小 refinement，保证 public Web DTO alias 只存在于 channel 边界，gateway/session 使用 owner+agent scoped internal fields。
- SQLite gateway-local 是本 change 的唯一产品本地持久化实现，主路径 request run、session、message、active context、timeline event 和 checkpoint 必须使用专用业务表/store；不得以 generic `records(store,key,json)` 作为业务事实底座。所有幂等 write operation 默认将 key 放在锚点事实表，通过 trusted owner/agent/session/request/run scope 建立唯一约束；session create、accepted request run create、message append、timeline append 和 checkpoint save 均使用各自事实表锚点。RequestRun 的 executing、terminal pending 和 diagnostic failure 更新是同一 run 事实的 version CAS state transition，不声明独立幂等 key。message append 和 terminal commit 这类复合写入必须通过 gateway composite write 在一个 SQLite transaction 内完成，并用锚点事实、terminal state CAS 与 active-context uniqueness 保证重复 key 不重复 side effect。本 change 不引入领域外 `operationKind` 或 request hash conflict detection。
- Runtime 在 session/request admission 时拥有 trusted Agent Scope resolution。当前 single hosted Agent 产品路径可由 app composition 注入 active hosted Agent selection；后续 multi hosted Agents 的路由仍接入 runtime 内部 resolver。该 resolver 不进入 `agent-contracts` public contract，`agentId` 不得来自 Web request body、client metadata、模型输出或 capability 参数。Runtime 接受请求时通过 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.active(agentId)` 解析 active runtime-ready assembly，并把 resolved `agentId`、`agentVersion`、`agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`；接受后所有 core、context 和 capability routing 必须使用 `AgentAssemblyRegistry.require(agentId, agentVersion)` 或 runtime 传入的 accepted assembly facts 读取同一 assembly，不得再读取 active assembly。
- Runtime 必须保证同一 session 在本 change 范围内最多一个 active `RequestRun`；同 session 已有 active run 时，新 submit 必须返回 safe conflict/rejection，不创建 queued run，不引入 FIFO lane、scheduler queue、replacement 或 terminal-pending 保护；跨 session 并发不得串写 request/run/timeline/history 标识。
- Runtime single-run dispatcher/scheduler 属于当前主流程：它只调度已持久化、assembly 已固化且未进入 terminal 的 accepted run，使用 version CAS guard 防止同一 run 被重复启动，向 `Agent.execute(run, context, timeline, messages, signal): Promise<void>` 传入 runtime-owned timeline/message ports 和 `AbortSignal`，并把 Agent resolve/reject 归一化到 terminal commit 或 safe failure path；Agent 只能通过 `RunTimelineEventPort.emit(event): Promise<void>` 发布中间事件，通过 `RunMessagePort.appendMessage(run, context, draft): Promise<MessageId>` 追加执行中产生的 session message，terminal lifecycle event 由 runtime 发布。
- Terminal commit 属于主路径必须实现的终态一致性规格：使用 `PENDING -> COMMITTED` terminal commit state、CAS 和 idempotency 保证唯一终态；terminal durable commit failure 不发布用户可见 completed/failed terminal stream event，runtime 必须尝试把 `PENDING` 更新为内部 `FAILED`，该更新本身失败时保留 `PENDING` 作为可诊断状态；自动 terminal retry/recovery 和多实例 takeover 已由计划中的 `add-ts-local-runtime-recovery` / `add-ts-runtime-recovery-idempotency-guard` 承接，本 change 只保留可恢复所需事实和状态。
- `RequestContext` 按核心契约表达可恢复执行坐标，不重新引入 `attempt`、`deadlineAt` 或 `messageRefs`；主流程内 current-run tool state reconstruction 需要时从 `RequestRun`、ActiveContextView 或 `SessionMessageStoreGateway.listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)` 读取事实并由领域层映射，当前根用户消息统一使用核心契约中的 `requestId` 命名；process restart recovery、checkpoint lookup、`claimRun`/`listRecoverableRuns` 调度、tool replay 和多实例 takeover 后置。
- Context render 必须携带 request locale/language hint，并在最小默认 prompt/context 中包含保留电信术语原文的约束；本 change 只做轻量验收，不实现完整 glossary、语言检测或双语质量评测集。
- `agent-model` 提供最小真实 `OPENAI` provider 路径和测试替身；core/runtime 进入模型层前必须把 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`，字段包含 `requestId`、`stepId`、`providerKind=OPENAI`、`modelName`、`baseUrl`、`credentialRef`、`ChatMessage[]`、tools、`temperature`、`maxTokens`、`topP`、`thinking`、`providerOptions` 和 `timeoutMs`，且 `agent-model` 不接收 `ContextAssembly`、`RenderedModelInput`、provider SDK 对象、raw credential 或 runtime streaming context；OpenAI adapter 在 provider 边界内解析 `credentialRef`，并支持 read tool-use normalization。deterministic/test provider 只能用于 test composition；最小端到端发布验收必须使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint。
- 产品配置必须使用 `Config/Resources/ResourceProviders/Plugins -> AgentDefinition -> app-internal assembly compiler -> AgentAssemblyRegistry -> app composition` 的唯一启动路径。`SystemConfig` 只允许表达 NextAgent system 级选择和最小必要 deployment/auth/active-agent roots；SQLite、channel、no-op boundary、observability、provider adapter 等可以有组件内部配置参数，但内置 default-system 文件、env secret override 和默认值选择必须由 `agent-app` 完成；`AgentDefinition` 只表达单 Agent 业务装配：agent identity/version、workspace、model/prompt refs、capability bindings、runtime settings 和资源引用。runtime、core、context、model、capability、session 和 gateway 不得解析内置配置与 env secret，也不得消费 app raw config DTO 和 compiler input DTO。
- Web channel 最小支持已确认目标 route table 中的 session list/create/conversation/submit/SSE，并额外支持 TS convenience submit `POST /api/v1/requests`；channel 只负责 HTTP/SSE transport、Web schema/projection 和调用 runtime-facing ports，不直接调用 `agent-session`、gateway store，也不定义 channel-owned session abstraction such as `WebSessionPort`。convenience submit payload 可以不携带 `sessionId`，但 channel 必须先委托 runtime session facade 创建 owner+agent scoped session，再用核心契约必填的 `sessionId` 构造 `RuntimeCommandPort.submit` command；stream 通过 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence, requestId?, runId? })` 读取 runtime event stream 后投影为 shared canonical `StreamEventType` 子集，channel 不拥有 replay truth 或 request lifecycle，也不把 runtime timeline record 作为 Web DTO 暴露。
- 最小 history 由 runtime session facade 解析 trusted Agent Scope 后调用 `agent-session` 的领域 `UserSessionPort`。`agent-session` 将 domain `ListUserSessionsQuery` / `ListSessionMessagesQuery` 映射为 gateway-owned `SessionHistoryRecordQuery` 和 `ListSessionMessagesRecordQuery`，再分别调用 `SessionStoreGateway.listSessions(...)` 和 `SessionMessageStoreGateway.listMessages(...)`；session list public query 只允许 `offset?`/`limit?`，使用 `updatedAt desc, sessionId asc` 稳定排序，entry 只返回 `sessionId`、`displayTitle`、`lastActivityAt`，由 channel 从内部 `title?`/`updatedAt` 投影；conversation 默认返回最近 visible `SessionMessage` window，response items 按 `createdAt asc, messageId asc` 展示，并通过 public `cursor`/`nextCursor` 加载更早记录；Web API 不暴露 `includeHidden`，`includeCapabilityResults` 默认 `false`；public Web DTO 兼容字段隔离在 `agent-channel-web`，不进入 runtime/session/core/gateway contract。`agent-contracts/session` 不保留与 `UserSessionPort` 平行的 stale `SessionHistory*`/`SessionConversation*` API，也不保留重复 `UserSessionListEntry`。
- Capability loop 使用通用 catalog/invocation 规格：Agent core 根据模型 tool call 的 capability id/name 解析已启用 descriptor，并通过 `CapabilityInvocationPort` 调用；`CapabilityInvocationRequest` 字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`，不得包含 `workspaceDir` 或 `recoveryReplay`。当前产品 assembly 只启用内置 `read`，未启用或不可解析的 capability 必须 safe rejected，不在 core 中 hardcode 文件读取。模型可见 read schema 使用 canonical argument names：必填 `file_path`，可选 `offset`、`limit`，且 `file_path` 只支持 workspace-relative 单文件切片读取，不支持绝对路径、目录 listing 或 glob，也不接受 `path`/`filePath` alias；`offset`/`limit` 是 line-based slice，`offset` 默认 0 且表示 0-based 起始行，`limit` 默认 2000 且表示最大行数；同一模型响应中的多个 read tool calls 可按出现顺序串行执行，但并行调度、多 Skill source、远端 Agent 或复杂 capability governance 不展开。
- Stream delta、terminal assistant message 和 capability result message 的持久化内容必须有大小/长度 guard；除 read capability line-based bounded slice 外，硬上限命中时不得静默截断，必须发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。本 change 不新增或暗含自动 output continuation flow。
- Hook、CheckpointStoreGateway 和 AuditEventWriter 必须在主流程中被调用，并装配默认 no-op 实现；这些 no-op 是本 change 的显式产品 provider 配置，不是缺失依赖或 test-only stub。主流程必须真实调用，但 no-op 无产品副作用，不能影响 request 决策、不能写入可恢复 checkpoint 或 audit ring buffer，验收通过测试 spy/sink 断言调用；真实 policy hook execution、checkpoint persistence/recovery 和 durable audit store 后置。
- 本 change 覆盖的 runtime、core、model、capability 和 timeline stream 慢边界必须使用 async contract 并接收 `AbortSignal`；内部 cancellation propagation 触发源限定为内部 timeout、server shutdown、测试注入 abort 和 transport disconnect cleanup。Gateway public port 保持 async；当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort。远程、长耗时或可取消的 Gateway cancellation、用户可见 cancel route、cancel runtime command、持久化 canceled terminal state、`REQUEST_CANCELED` 产品路径投影和 request-control 状态机 deferred。
- 产品化源码结构进入本 change 范围：`agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app` 不得作为单文件实现交付；目标目录结构由 `designs/module-structure.md` 承载。
- Memory、Attachment、多 store 实现、多 provider、WebSocket、一致性 replay 完整语义、取消/重试/编辑完整用户能力、多实例 lease/recovery、远端 Agent、长期 checkpoint recovery、完整 glossary/双语评测集、自动 output continuation flow、容量/SLA benchmark、完整本地运行包打包/启动脚本/前端托管/升级保留能力不进入本变更。

BREAKING：无。当前 TS 最小内核尚未形成稳定运行行为；本变更实现已冻结核心契约。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-minimal-agent-kernel`: 定义并交付 TS 后端最小 Agent 问答内核的端到端行为，包括 Web submit/SSE/history、runtime lifecycle、Agent assembly 版本绑定、context/model/capability 主链路、timeline/stream、terminal commit、safe error、owner scope、agent scope 和 no-op 边界调用。

### 修改的 Capability
- `ts-core-contracts`: refinement user session contract，使 `UserSessionPort`、gateway owner+agent scoped internal fields 与 Web public DTO alias 隔离，并支持 conversation recent-window older-cursor 语义。

## 影响范围（Impact）

- 代码：影响 `agent-app`、`agent-channel-web`、`agent-runtime`、`agent-session`、`agent-core`、`agent-context-engine`、`agent-model`、`agent-capability`、gateway adapter/ports、`agent-observability` 和 `agent-test-kit`。
- API/事件：新增最小 Web session create/list、session-scoped submit、TS convenience submit、SSE stream、conversation history 行为；实现 `RequestAccepted`、shared canonical timeline 到 `StreamEnvelope` 的投影和 terminal stream/history 一致性。
- 配置：需要目标态 TS 配置所有权模型、AgentDefinition loader/parser、app-internal resource/provider registry、assembly compiler、runtime-safe `AgentAssemblyRegistry` from `agent-contracts/agent-assembly`、model profile registry、SQLite local gateway component config、默认 no-op hook/checkpoint/audit provider 和测试替身 provider 入口；产品配置不得选择 deterministic/test provider，产品 composition 不得绕过 compiler 注入硬编码默认 assembly。
- 数据和持久化：需要 session、message、RequestRun、timeline、active context read/append、terminal commit 所需 gateway 读写；SQLite gateway-local 必须使用专用业务表和锚点事实表幂等，不得让上层模块依赖具体 store driver、row schema 或 idempotency 索引实现。
- 测试：新增端到端问答、stream 到 terminal result 一致性、safe error、owner/agent scope、Agent assembly 固化、current request message query、no-op boundary 调用、architecture/private import negative case、产品化目录结构 guard、implementation package dependency firewall 和 contract subpath allowlist negative fixtures。
- 运维：最小内核必须产生可诊断的 safe error、低敏业务关联字段和 no-op 边界调用证据，但不要求真实审计落库或完整 metrics/tracing。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：新增最小 Agent 问答内核行为基线。

长期背景：
- `openspec/overview.md`：补充 TS 后端从核心契约进入最小可运行 Agent 内核的长期背景。

设计视图：
- `openspec/designs/architecture/runtime-boundaries.md`：提升最小内核主流程、runtime ownership、terminal commit、timeline/stream 和 no-op 边界事实。
- `openspec/designs/architecture/ts-backend-architecture.md`：补充最小内核在既有架构边界上的交付切片。
- `openspec/designs/domain/request-run.md`：提升 RequestRun、RequestContext、assembly 版本绑定和 terminal uniqueness 在最小内核中的成立事实。
- `openspec/designs/contracts/core-contracts.md`：补充最小 Web submit/SSE/history、RuntimeCommandPort、Agent、ContextEnginePort、ModelInvocationService、CapabilityInvocationPort 和 Gateway port 调用语义。
- `openspec/designs/modules/agent-app.md`、`agent-channel-web.md`、`agent-runtime.md`、`agent-session.md`、`agent-core.md`、`agent-context-engine.md`、`agent-model.md`、`agent-capability.md`、`agent-observability.md`：按实际实现提炼模块职责、非职责、依赖和 contract 消费关系。
- `openspec/designs/architecture/ts-backend-architecture.md` 或模块设计页：提升本 change 落实后的 package 内部目录结构、`index.ts` public barrel 约束、implementation package dependency firewall 和 contract subpath allowlist。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-minimal-agent-kernel` 到长期设计和验证入口的导航。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
- 最小端到端问答测试必须使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint；另需 stream/terminal/history 一致性测试、safe error 测试、owner/agent scope smoke test、no-op boundary 调用测试、SQLite 专用事实表和锚点幂等测试、architecture negative fixtures。新增两层架构门禁必须由 `npm run lint:architecture`、architecture tests/fixtures 和 package manifest assertions 实际触发并断言失败：第一层覆盖 implementation package 之间的源码和 `package.json` 依赖；第二层覆盖未授权 `agent-contracts` subpath、root aggregate import 和 app exception 边界。

归档前只提升仍成立的长期事实，不把临时任务状态或过期风险写入长期基线。
