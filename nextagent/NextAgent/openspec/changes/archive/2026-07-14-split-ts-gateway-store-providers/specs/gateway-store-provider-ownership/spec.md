## ADDED Requirements

### Requirement: Gateway stores have one capability provider owner

系统 SHALL 将持久化 gateway stores 分配给唯一 capability provider。Working Memory provider MUST 完整提供 `requestRuns`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations` 和 `conversationShares`。Long-term Memory provider MUST 完整提供 `longTermMemoryStore` 和 `longTermMemoryRetriever`。

保留 SQLite provider MUST 只提供 `attachmentReservations`、`blobs`、`taskTrajectoryStore`、`taskTrajectoryQuery`、`todoStateStore`、`userQuestionActivity` 和 `audit`。`audit` 必须使用 provider-neutral public port，使 app observability wiring 不依赖 local implementation type。系统 MUST NOT 让同一个 store 同时由多个 provider binding 提供，也 MUST NOT 将未明确归属的新 store 默认加入保留 SQLite provider。

#### Scenario: All selected store capabilities have one owner
- **WHEN** app composition 完成 gateway provider selection
- **THEN** 每个 app-required store MUST 由且仅由一个 selected provider binding 提供
- **AND** Working Memory 与 Long-term Memory binding 任一必需字段缺失 MUST 阻断启动

#### Scenario: Providers claim the same store
- **WHEN** 多个 selected provider bindings 声明同一个 store
- **THEN** app composition MUST 在 ready 前以安全的 binding conflict 阻断启动

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

Working Memory provider SHALL 作为 request/session 工作事实和必要恢复状态的单一事务 owner。terminal commit MUST 在一个 provider-local 原子事务中推进 RequestRun terminal state、写入 terminal message 并追加 terminal timeline event。session create、session fork 和 session cascade delete 等现有复合写 MUST 在 Working Memory provider 内保持其规格定义的原子性；conversation annotations 和 shares MUST 与 session cascade delete 位于同一 provider ownership 中。

#### Scenario: Terminal commit succeeds
- **WHEN** runtime 提交一个 terminal result
- **THEN** RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部提交
- **AND** 任一写入失败 MUST 使该次 composite write 不产生部分可见结果

#### Scenario: Session is deleted
- **WHEN** session cascade delete 成功
- **THEN** Working Memory provider MUST 在同一事务中删除该 session 归属的 conversation annotations、conversation shares 及其他既有 cascade facts
- **AND** 不得遗留仍可访问的 session share

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

#### Scenario: Local providers start from an empty workspace
- **WHEN** LOCAL app 首次在空 workspace 启动
- **THEN** 系统 MUST 创建三个独立 SQLite 文件
- **AND** 每个文件的业务表 MUST 只属于对应 provider ownership

#### Scenario: One local provider database is unavailable
- **WHEN** 任一 selected provider 的 SQLite 文件无法初始化或打开
- **THEN** startup MUST fail before ready
- **AND** 系统 MUST NOT fallback 到其他 SQLite 文件或合并 provider ownership
