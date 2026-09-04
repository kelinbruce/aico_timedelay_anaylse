# gateway-store-provider-ownership Specification

## Purpose

Define the unique provider ownership, complete binding, transaction, storage/retrieval consistency and local physical isolation requirements for gateway stores.

## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Gateway stores have one capability provider owner

系统 SHALL 将持久化 gateway stores 分配给唯一 capability provider。Working Memory provider MUST 完整提供 `requestRuns`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations` 和 `conversationShares`。Long-term Memory provider MUST 完整提供 `longTermMemoryStore` 和 `longTermMemoryRetriever`。

保留 SQLite provider MUST 只提供 `attachmentReservations`、`blobs`、`taskTrajectoryStore`、`taskTrajectoryQuery`、`todoStateStore` 和 `userQuestionActivity`。Audit MUST NOT remain in `SqliteGatewayStoreBindings`; the deployment-selected provider SHALL expose the provider-neutral write-only `AuditEventStoreGateway` through top-level `GatewayBindings.audit`. LOCAL SHALL bind it to the file audit implementation in `agent-platform-gateway-local`; REMOTE/PaaS SHALL bind an audit-service adapter when that separately specified capability is available. 系统 MUST NOT 让同一个 store 同时由多个 provider binding 提供，也 MUST NOT 将未明确归属的新 store 默认加入保留 SQLite provider。

#### Scenario: All selected store capabilities have one owner

- **WHEN** app composition 完成 gateway provider selection
- **THEN** 每个 app-required store MUST 由且仅由一个 selected provider binding 提供
- **AND** Working Memory 与 Long-term Memory binding 任一必需字段缺失 MUST 阻断启动

#### Scenario: Providers claim the same store

- **WHEN** 多个 selected provider bindings 声明同一个 store
- **THEN** app composition MUST 在 ready 前以安全的 binding conflict 阻断启动

#### Scenario: Local audit binding is selected

- **WHEN** LOCAL gateway composition completes
- **THEN** exactly one top-level GatewayBindings.audit MUST be provided by `agent-platform-gateway-local`
- **AND** SqliteGatewayStoreBindings MUST contain no audit member
- **AND** app observability wiring MUST depend only on the provider-neutral AuditEventStoreGateway

### Requirement: Provider bindings are capability-complete and implementation-neutral

Working Memory 和 Long-term Memory public bindings SHALL 使用完整、非 optional 的 capability-specific contract。领域 package MUST 只消费这些 public gateway ports，MUST NOT 感知 SQLite 文件、数据库连接、schema、远端 client 或 provider-private DTO。`agent-app` MAY 组装内部依赖对象，但 MUST NOT 将该内部聚合重新暴露为通用、全部 optional 的 public store provider contract。

#### Scenario: Working Memory provider is selected

- **WHEN** selected Working Memory provider 创建 binding
- **THEN** binding MUST 一次性提供 Working Memory capability 的全部 stores
- **AND** downstream modules MUST NOT 通过类型断言补齐缺失 store

#### Scenario: Long-term Memory provider is remote

- **WHEN** Long-term Memory capability 选择 REMOTE provider
- **THEN** memory consumers MUST 继续通过相同 public store/retriever ports 工作
- **AND** provider-private endpoint、credential、client 和 wire DTO MUST NOT 进入领域 package

### Requirement: Working Memory preserves request and session transaction boundaries

Working Memory provider SHALL 作为 request/session 工作事实和必要恢复状态的单一一致性 owner。terminal commit 成功时，RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部可见；失败时三者 MUST 不产生部分结果。session create、session fork 和 session cascade delete 的既有复合结果 MUST 保持其规格定义的 all-or-nothing 可见性；session delete 成功后，conversation annotations、shares 及其他 cascade facts MUST 一并不可访问。

对于 session fork，selected provider MUST 通过 `SessionForkStoreGateway.prepareFork` 在其持有源事实的边界内读取完整 WorkingMemory source facts并返回受服务端预算约束的 required content refs。调用方 MUST NOT 取得完整 source prefix 或预构造 child records；它只能通过既有可信 content resolver 读取 prepare 清单中的规范化 execution-bound refs，并通过同一 gateway 的 `stageForkPromotion` 暂存对应 bytes。selected provider MUST 在 `forkSession` 中重新校验 source 坐标和 staged refs，产生全部 child facts，并把 matching promotions 与 child 结果原子提交。LOCAL provider 与外部 REMOTE AgentMemory MUST 实现同一个 `SessionForkStoreGateway` contract；系统 MUST NOT 为两种部署暴露平行 contract。

**需求类别**：功能性需求

#### Scenario: Terminal commit succeeds

- **WHEN** runtime 提交一个 terminal result
- **THEN** RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部提交
- **AND** 任一组成事实失败 MUST 使该次 terminal commit 不产生部分可见结果

#### Scenario: Session is deleted

- **WHEN** session cascade delete 成功
- **THEN** 该 session 归属的 conversation annotations、conversation shares 及其他既有 cascade facts MUST 全部不可访问
- **AND** 不得遗留仍可访问的 session share

#### Scenario: LOCAL provider 通过统一准备与创建操作完成派生

- **WHEN** LOCAL 部署依次调用 `prepareFork`、必要的 `stageForkPromotion` 和 `forkSession`
- **THEN** 调用方 MUST 通过 `forkSession` 获得完整、all-or-nothing 的 child 结果
- **AND** 调用方 MUST NOT 提交完整 prefix 或预构造 child records

#### Scenario: REMOTE AgentMemory 在服务端准备并派生

- **WHEN** REMOTE 部署调用 `SessionForkStoreGateway.prepareFork`
- **THEN** AgentMemory MUST 使用其持有的完整 source facts返回有界required content refs
- **AND** NextAgent MUST 只解析该清单并stage受预算约束的bytes，随后调用`forkSession`
- **AND** AgentMemory MUST 返回完整、all-or-nothing 的 child 结果
- **AND** NextAgent MUST NOT 回退到 LOCAL SQLite、传输完整 prefix 或选择另一套 fork contract

#### Scenario: REMOTE 不直接访问 NextAgent execution workspace

- **WHEN** source prefix 包含规范化 `tool-results/<refId>`
- **THEN** AgentMemory MUST 只把该ref及resolver所需可信坐标放入prepare清单
- **AND** NextAgent MUST 通过既有可信resolver读取内容并仅上传对应bytes，不上传路径或完整prefix
- **AND** source path、host path或未知execution-bound ref MUST 在child可见前返回canonical safe failure

### Requirement: Long-term Memory owns storage and retrieval consistency

Long-term Memory provider SHALL 同时拥有长期记忆写入与检索。一次长期记忆写入对调用方成功可见时，其 provider-local retrieval index MUST 与权威 memory record 保持现有 memory core 规格要求的一致性。系统 MUST NOT 将 store 和 retriever 选择到不同 provider。

#### Scenario: Long-term memory is written

- **WHEN** `longTermMemoryStore` 成功保存或更新一条长期记忆
- **THEN** 同一 provider 的 `longTermMemoryRetriever` MUST 按 memory core 规格检索到对应的最新可见状态

#### Scenario: Store and retriever come from different providers

- **WHEN** composition 无法从同一个 selected provider 获得 long-term memory store 和 retriever
- **THEN** startup MUST fail before ready

### Requirement: Local capability providers use isolated SQLite ownership

LOCAL 部署 SHALL 为 Working Memory、Long-term Memory 和保留 SQLite provider 使用三个独立 SQLite 文件。三个 provider MUST NOT 共享数据库连接、schema owner 或跨 provider 数据库事务；每个文件 MUST 只包含其 owner 所需的业务表、索引和 provider-private metadata。当前版本 MUST 从空 schema 初始化，不得读取旧单库、执行数据迁移、双写或运行时 fallback。

Audit output SHALL remain outside all three SQLite files. The residual SQLite schema MUST NOT create `audit_events` or an audit index. LOCAL audit SHALL instead be appended by top-level GatewayBindings.audit to its gateway-owned `nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson[.gz]` family under the trusted log directory, whose gateway privately owns fixed 7 elapsed-day aging. The audit gateway MUST NOT migrate existing SQLite audit rows or dual-write SQLite and file output.

#### Scenario: Local providers start from an empty workspace

- **WHEN** LOCAL app 首次在空 workspace 启动
- **THEN** 系统 MUST 创建三个独立 SQLite 文件
- **AND** 每个文件的业务表 MUST 只属于对应 provider ownership
- **AND** no SQLite file may contain an audit_events table
- **AND** audit evidence MUST use only the separately owned audit file family

#### Scenario: One local provider database is unavailable

- **WHEN** 任一 selected provider 的 SQLite 文件无法初始化或打开
- **THEN** startup MUST fail before ready
- **AND** 系统 MUST NOT fallback 到其他 SQLite 文件或合并 provider ownership

### Requirement: 结构化增量记录在统一timeline gateway前有界

系统 MUST 在调用 `RunTimelineEventStoreGateway.appendEvent` 前确保每条非 Workflow `TOOL_STRUCTURED_DELTA` record 及每条 Workflow `NODE_COMPLETED` structured product record 的 `inlinePayload` 经 `JSON.stringify` 后不超过 49,000 UTF-8 bytes。该上限 MUST 同时适用于非 Workflow 聚合到界分批提交、显式 flush、`accumulated=true` direct write、run 终止兜底 flush，以及 Workflow `NODE_COMPLETED` structured product；local 与 remote binding MUST 接收同一 shape 和同一容量边界的 record。

超限内容经过有界归一化后，系统 MUST 继续使用既有 timeline gateway 持久化，并在确有内容丢失时设置 `truncated=true`。容量归一化 MUST NOT 产生 `DEGRADATION_NOTICE`、MUST NOT 产生新的 request-level terminal fact 或 annotation、MUST NOT 自行改变 request terminal status。真实 serialization、认证、连接或 storage failure MUST 按既有 gateway 失败语义传播，系统 MUST NOT 捕获并忽略该失败。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 显式flush在gateway前满足容量上限

- **GIVEN** 聚合后的 `TOOL_STRUCTURED_DELTA.inlinePayload` 原始大小超过 49,000 UTF-8 bytes
- **WHEN** 系统执行显式 flush
- **THEN** 传给 `appendEvent` 的 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** 该 record MUST 携带 `truncated=true`

#### Scenario: run终止兜底flush使用相同容量规则

- **GIVEN** run 终止时仍有超限的未提交结构化增量
- **WHEN** 系统执行兜底 flush
- **THEN** 传给 `appendEvent` 的每条 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** 其 shape 与显式 flush 对相同输入产生的 shape MUST 相同

#### Scenario: 50,000-byte拒绝型gateway不会收到超限record

- **GIVEN** timeline gateway 会拒绝任一不小于 50,000 UTF-8 bytes 的 `inlinePayload`
- **WHEN** runtime 提交任一受支持的结构化增量
- **THEN** runtime 交给 gateway 的 record MUST 小于该拒绝边界
- **AND** 请求 MUST NOT 因可预防的 inline payload 超限而失败

#### Scenario: Workflow completed product通过同一gateway边界

- **GIVEN** 一个 Workflow `NODE_COMPLETED` structured product 的原始 `inlinePayload` 超过 49,000 UTF-8 bytes
- **WHEN** runtime 调用 timeline gateway
- **THEN** 传入 record 的 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** record MUST 携带 `truncated=true` 与 Workflow product identity
- **AND** append 成功后的 canonical live record MUST 与 durable history record 同形

#### Scenario: 真实timeline存储失败继续传播

- **GIVEN** 已满足容量上限的结构化增量 record
- **AND** `appendEvent` 因连接、认证或存储故障失败
- **WHEN** runtime 等待该写入
- **THEN** 该失败 MUST 按既有 gateway failure contract 向上传播
- **AND** 系统 MUST NOT 把该失败伪装成成功或仅记录截断

### Requirement: RequestRun 批量分页查询

Working Memory gateway MUST 通过必需的 `RequestRunStoreGateway.listRuns` 操作提供 RequestRun 批量分页查询。`RequestRunListQuery` MUST 包含可信 `tenantId`、`subjectId`、`agentId`、必需的 `offset` 和 `limit`，并 MUST 包含非空 `sessionIds`、非空 `runIds` 或二者；当二者同时存在时，结果 MUST 同时匹配两个集合。重复的过滤 ID MUST NOT 使同一 `RequestRunRecord` 在结果中重复出现。

`RequestRunRecordPage` MUST 包含 `items`、`offset`、`limit` 和 `hasMore`。`items` MUST 只包含匹配查询 scope 和过滤条件的记录，MUST 按 `createdAt` 降序、再按 `runId` 降序稳定排序。`offset` 和 `limit` MUST 回显已接受查询的同名值；仅当过滤后的稳定结果序列在当前页之后仍有至少一条记录时，`hasMore` MUST 为 `true`。

**需求类别**：功能性需求

#### Scenario: 按多个 sessionId 查询

- **WHEN** 查询在 scope `(T1, U1, A1)` 下传入 `sessionIds=[S1,S2]`、省略 `runIds`、`offset=0`、`limit=100`
- **THEN** `items` MUST 只包含该 scope 下属于 `S1` 或 `S2` 的 RequestRun
- **AND** 每条记录 MUST 至多出现一次

#### Scenario: 按多个 runId 查询

- **WHEN** 查询在 scope `(T1, U1, A1)` 下传入 `runIds=[R1,R2]`、省略 `sessionIds`、`offset=0`、`limit=100`
- **THEN** `items` MUST 只包含该 scope 下存在的 `R1` 和 `R2`
- **AND** 不存在或不属于该 scope 的 ID MUST 不出现在结果中

#### Scenario: sessionId 与 runId 同时过滤

- **WHEN** 查询传入 `sessionIds=[S1]` 和 `runIds=[R1,R2]`
- **AND** `R1` 属于 `S1`，`R2` 属于 `S2`
- **THEN** `items` MUST 包含 `R1`
- **AND** `items` MUST 不包含 `R2`

#### Scenario: 稳定分页并指示下一页

- **GIVEN** scope 和过滤条件匹配 3 条记录，稳定顺序依次为 `R3,R2,R1`
- **WHEN** 查询使用 `offset=1`、`limit=1`
- **THEN** `items` MUST 只包含 `R2`
- **AND** 结果 MUST 为 `{ items: [R2], offset: 1, limit: 1, hasMore: true }`

### Requirement: RequestRun 批量查询有界且隔离 scope

Working Memory gateway MUST 只返回与查询中可信 `tenantId`、`subjectId` 和 `agentId` 全部相等的 RequestRun。`offset` MUST 是大于或等于 `0` 的安全整数；`limit` MUST 是 `1..100` 的安全整数。`sessionIds` 和 `runIds` 在出现时 MUST 是非空数组，且两个字段 MUST 至少有一个出现。违反任一约束时，gateway MUST 以 `AgentError` 显式失败且不得返回 RequestRun records，其中 `code="REQUEST_RUN_QUERY_INVALID"`、`category="VALIDATION"`、`retryable=false`。

LOCAL 和 REMOTE Working Memory provider MUST 实现相同查询契约。REMOTE provider MUST NOT 通过逐个 `runId` 调用单记录查询来实现 `listRuns`；一次 `listRuns` 调用 MUST 对部署方表现为一次批量 gateway 操作。

**需求类别**：系统质量属性

**质量属性**：安全、性能/容量

**适用范围**：该 Function

#### Scenario: 单页达到最大值

- **WHEN** 查询使用 `limit=100`
- **THEN** gateway MUST 接受该分页参数
- **AND** `items` 的长度 MUST 不超过 `100`

#### Scenario: limit 超过最大值

- **WHEN** 查询使用 `limit=101`
- **THEN** gateway MUST 抛出 `REQUEST_RUN_QUERY_INVALID`
- **AND** MUST NOT 返回 RequestRun records

#### Scenario: 未提供有效过滤集合

- **WHEN** 查询同时省略 `sessionIds` 和 `runIds`，或任一已提供字段为空数组
- **THEN** gateway MUST 抛出 `REQUEST_RUN_QUERY_INVALID`
- **AND** MUST NOT 将该输入解释为无条件全量查询

#### Scenario: 相同 ID 存在于其他 scope

- **GIVEN** `(T1,U1,A1)` 与 `(T2,U2,A2)` 下存在相同字符串值的 `runId`
- **WHEN** `(T1,U1,A1)` 查询该 `runId`
- **THEN** 结果 MUST 只包含 `(T1,U1,A1)` 的记录
- **AND** 其他 scope 的记录 MUST 不可见

#### Scenario: REMOTE provider 执行批量查询

- **WHEN** 调用方对 REMOTE Working Memory binding 调用一次 `listRuns` 并传入多个 `runIds`
- **THEN** provider MUST 执行一次批量 gateway 操作
- **AND** MUST NOT 对每个 `runId` 分别调用 `loadRun`
