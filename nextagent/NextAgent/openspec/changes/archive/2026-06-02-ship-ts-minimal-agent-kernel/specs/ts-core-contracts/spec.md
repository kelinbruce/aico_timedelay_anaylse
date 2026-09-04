## ADDED Requirements

### Requirement: Contract subpath 保持架构归属
TS core contracts SHALL 保持可通过架构拥有的 public subpath 消费。一个 contract subpath SHALL 表示由其模块职责拥有的稳定边界，而不是一个包罗万象的共享类型桶。

#### Scenario: 产品模块只消费经授权的 contract subpath
- **WHEN** 产品 package 导入 `agent-contracts`
- **THEN** 它们 MUST 从显式 subpath 导入，例如 `agent-contracts/runtime` 或 `agent-contracts/model`
- **AND** 产品 package MUST NOT 从 `agent-contracts` 根聚合导出导入
- **AND** 每个产品 package MUST 只消费 `designs/module-structure.md` 授权的 subpath
- **AND** 新的 subpath 消费 MUST 通过一个说明架构 owner 和循环依赖风险的 OpenSpec update 引入

#### Scenario: Agent assembly 事实使用窄契约 subpath
- **WHEN** runtime、core、context 或 capability 代码需要已接受的 Agent assembly 事实
- **THEN** 它 MUST 从 `agent-contracts/agent-assembly` 消费 `AgentAssembly`、`AgentCapabilityBinding`、`AgentRuntimeSettings` 和 `AgentAssemblyRegistry`
- **AND** `agent-contracts/agent-assembly` MUST NOT 导出 `Agent` 执行接口、raw `AgentDefinition`、AgentDefinition parser/loader 类型、`AgentAssemblyCompiler`、`ResourceInventory`、`SystemConfig`、provider credentials、gateway config 或 channel config
- **AND** `Agent` 执行接口 MUST 保留在 `agent-contracts/runtime`
- **AND** context 和 capability package MUST NOT 仅为获取 assembly 事实而导入 `agent-contracts/runtime`

#### Scenario: 契约不得编码便利性依赖
- **WHEN** 一个模块仅因当前实现便利而需要另一个架构边界拥有的类型
- **THEN** 该类型 MUST 移入拥有它的 contract subpath、通过更窄的 owning port 暴露，或由 `agent-app` composition 传递
- **AND** 实现便利 MUST NOT 成为添加宽泛 subpath import 的理由，例如 core 到 gateway 或 context 到 runtime 的 lifecycle 依赖

#### Scenario: 同类 case 使用同一策略
- **WHEN** 两个 contract、persistence 或 runtime 形状共享相同的语义类别、生命周期阶段、边界和安全/一致性不变量
- **THEN** 它们 MUST 使用相同的 owner、命名规则、contract shape 和校验策略
- **AND** 同类 case MUST NOT 引入具有相同语义的平行 DTO、Record、Request、enum、port、store 或 helper API
- **AND** 改变某一个同类 case 的策略 MUST 更新 OpenSpec design，并把同一策略应用到范围内所有同类 case
- **AND** 例外 MUST 在实现前于 OpenSpec design 中记录原因、owner、范围和验证路径

#### Scenario: 共享 durable vocabulary 保留在 common
- **WHEN** 一个 scalar vocabulary 被多个 contract subpath 使用，例如一个领域对象及其 gateway Record
- **THEN** 该 vocabulary MUST 在 `agent-common` 中只定义一次
- **AND** `agent-common` MUST NOT 定义 DO、DTO、Record、port 或 service 契约
- **AND** `agent-contracts/gateway` MUST NOT 仅为复用 enum 类 vocabulary 而导入同级业务 subpath，例如 `agent-contracts/session`、`agent-contracts/runtime` 或 `agent-contracts/attachment`
- **AND** gateway MUST NOT 为已存在于 `agent-common` 的 vocabulary 定义重复的 `*RecordRole`、`*RecordType`、`*RecordKind` 或 `*RecordStatus` 别名

#### Scenario: Runtime 拥有 run message append 边界
- **WHEN** Agent core 需要追加 assistant tool-use、capability result 或其他执行期 session message
- **THEN** 它 MUST 调用 `agent-contracts/runtime` 中由 runtime 拥有的 `RunMessagePort.appendMessage(run, context, draft)` 契约
- **AND** 追加的内容 MUST 表示为来自 `agent-contracts/session` 的 `SessionMessageDraft`
- **AND** `SessionMessageDraft` MUST 包含 message 内容字段，例如 role、content、contentType、visible、metadata 以及一个必填的 idempotency key，而不是完整的 owner/agent/session/run/timestamp 坐标
- **AND** runtime 实现在写入 gateway record 或追加 active context 之前，MUST 将可信 `RequestRun` 和 `RequestContext` 与该 draft 组合
- **AND** Agent core MUST NOT 导入 `agent-contracts/gateway` 来持久化中间消息

### Requirement: 最小内核的 App 配置契约精化
TS core contracts SHALL 只暴露稳定的、面向 runtime 的配置结果。raw 配置 DTO、组件 config DTO、AgentDefinition parser/loader 类型、resource inventory 和 assembly compiler 输入/输出 SHALL 保持 app 内部，除非下游 package 存在具体的 public contract 需要。

#### Scenario: App 契约不得成为配置总线
- **WHEN** `agent-contracts/app` 定义最小内核的 app 契约
- **THEN** 它 MUST NOT 导出一个把 gateway、channel、observability、provider adapter、prompt、capability provider 和 Agent 定义细节包含在同一个 public DTO 中的 catch-all `SystemConfig`
- **AND** 它 MUST NOT 把组件拥有的 adapter 配置 DTO（例如 SQLite driver config、Fastify listen config、OpenTelemetry/Pino wiring 或 no-op provider 实现配置）作为通用 app 契约导出
- **AND** 它 MUST NOT 要求 runtime、core、context、model、capability、session 或 gateway 的 public 契约接受 raw 配置输入类型
- **AND** app 内部的 `SystemConfig`、`AgentDefinition`、resource registry 和 compiler 输入/输出 MAY 在不被跨 package 边界消费时存在于 `agent-app` 内部

#### Scenario: 面向 runtime 的契约使用编译后的 assembly 和 registry
- **WHEN** `agent-app` 为 composition 编译产品配置
- **THEN** 面向 runtime 的输出 MUST 是来自 `agent-contracts/agent-assembly` 的 runtime-ready `AgentAssemblyRegistry`，加上下游 package 所需的类型化 registry 或 port
- **AND** 面向 runtime 的契约 MUST 在 acceptance 时使用 `AgentAssemblyRegistry.active(agentId)`，在 acceptance 之后使用 `AgentAssemblyRegistry.require(agentId, agentVersion)`
- **AND** runtime-safe 的 `AgentAssembly` MUST 排除 raw 配置、loader/parser 细节、provider 实现、datasource/channel 接线和 secret
- **AND** 产品代码 MUST NOT 用硬编码的默认 assembly 对象绕过 compiler 输出

### Requirement: 最小内核的用户 Session 契约精化
TS core contracts SHALL 精化用户 session 契约：public Web DTO 兼容名保持隔离在 `agent-channel-web`，runtime 拥有面向 session 的 Web 流程的 Agent Scope 解析，`agent-session` 暴露领域 `UserSessionPort`，并且 gateway 契约使用带有显式 owner scope 和 agent scope 的 canonical 内部 record 字段。

#### Scenario: Session 领域 port 使用领域对象
- **WHEN** `agent-contracts/session` 定义最小内核的用户 session 契约
- **THEN** 它 MUST 为 create、require、list 和 conversation history 操作定义领域 `UserSessionPort`
- **AND** `UserSessionPort` 的 command/query 类型 MUST 携带可信 `IdentityContext` 和可信 `agentId`
- **AND** `UserSession` MUST 包含 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选的 `title`、`createdAt` 和 `updatedAt`
- **AND** `UserSessionPort` MUST NOT 返回 gateway `*Record` 类型
- **AND** `UserSessionPort` MUST NOT 暴露 public Web 别名，例如 `displayTitle`、`lastActivityAt`、`cursor` 或 `nextCursor`
- **AND** 过时的 session read-model 名称（例如 `SessionHistoryQuery`、`SessionConversationQuery`、`CurrentRequestConversationQuery`、`ListUserSessionConversationQuery` 和 `UserSessionConversationPage`）MUST 被移除或替换为 `UserSessionPort` 的领域 command/query/page 名称，使 `agent-contracts/session` 不再定义第二条平行的 history API
- **AND** `UserSessionPage.entries` MUST 是 `UserSession[]`，而不是重复的 `UserSessionListEntry`

#### Scenario: Session list gateway 使用内部字段
- **WHEN** `agent-session` 通过 `SessionStoreGateway.listSessions` 列出 owner-scoped 和 agent-scoped 的 session
- **THEN** `SessionHistoryRecordQuery` MUST 包含 `tenantId`、`subjectId`、`agentId`、`offset` 和 `limit`
- **AND** gateway 契约 MAY 通过中性 owner-scoped 契约（例如 `OwnerScoped`）复用 owner scope 字段，但 `*Record` 类型 MUST NOT 继承 `*Request` 接口
- **AND** `SessionHistoryRecordQuery` MUST NOT 包含 public 或非最小化的查询字段，例如 `includeSuperseded`
- **AND** `SessionHistoryEntry` MUST 包含内部字段 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选的 `title`、`createdAt` 和 `updatedAt`
- **AND** `SessionHistoryEntry` MUST NOT 包含 public Web 别名字段 `displayTitle` 或 `lastActivityAt`
- **AND** `SessionHistoryEntry` MUST NOT 包含非最小化的 summary 字段，例如 `lastMessagePreview`、`lastRequestStatus` 或 `hasInFlightRequest`
- **AND** `agent-channel-web` MUST 是把内部 `title?` 和 `updatedAt` 投影为 public `displayTitle` 和 `lastActivityAt` 的边界

#### Scenario: Conversation gateway 使用 before-cursor 语义
- **WHEN** `agent-session` 通过 `SessionMessageStoreGateway.listMessages` 列出 conversation message
- **THEN** `ListSessionMessagesRecordQuery` MUST 包含 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选的 `requestId`、可选的 `locale`、`includeHidden`、`includeCapabilityResults`、可选的 `beforeCursor` 和 `limit`
- **AND** `ListSessionMessagesRecordQuery` MUST NOT 包含 public Web 别名 `cursor`
- **AND** `ListSessionMessagesRecordQuery` MUST NOT 在最小内核 conversation history 路径上使用 offset 分页
- **AND** `SessionMessageRecordPage` MUST 返回 items、limit、hasMore 以及可选的内部 `nextBeforeCursor`
- **AND** `SessionMessageRecordPage` MUST NOT 返回 public Web 别名 `nextCursor`
- **AND** `agent-channel-web` MUST 把 public `cursor` 映射为内部 `beforeCursor`，并把内部 `nextBeforeCursor` 映射为 public `nextCursor`

#### Scenario: Channel 消费 runtime session facade 而不是 session 实现
- **WHEN** `agent-channel-web` 处理 session create、list、conversation 或 submit 路由
- **THEN** 它 MUST 调用面向 runtime 的 port
- **AND** 它 MUST NOT 导入 `agent-session`
- **AND** 它 MUST NOT 定义 channel 拥有的 session 抽象，例如 `WebSessionPort`
- **AND** 面向 runtime 的 session 操作 MUST 在调用 `agent-session` 之前先在 runtime 内部解析可信 `agentId`
