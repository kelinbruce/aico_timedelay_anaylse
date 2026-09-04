# gateway-store-provider-ownership Specification Delta

## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Gateway stores have one capability provider owner

系统 SHALL 将持久化 gateway stores 分配给唯一 capability provider。StateStore provider MUST 完整提供 `requestRuns`、`memoryRecallAttempts`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations`、`conversationShares`、`questionRecommendations`。Long-term Memory provider MUST 完整提供 `longTermMemoryStore`、`longTermMemoryRetriever` 和 `longTermMemorySharing`。`blobStore` provider MUST 完整提供 `BlobStoreGateway`；`taskTrajectory` provider MUST 完整提供 `taskTrajectoryStore` 与 `taskTrajectoryQuery`；`user-interaction-stores` provider MUST 完整提供 `attachmentStore` 与 `userQuestionActivityStore`。系统 MUST NOT 提供 `TodoStateStoreGateway` 或其关联 Record/Request 类型；TodoWrite 进度状态不通过 gateway store 持久化。

每个能力组 MUST 由恰好一个 selected provider binding 提供；`audit` 以 provider-neutral 顶层 write-only binding 暴露，MUST NOT 归入任一能力组。系统 MUST NOT 让同一个 store 同时由多个 provider binding 提供，也 MUST NOT 把未明确归属的新 store 默认加入任一能力组。

**需求类别**：功能性需求

#### Scenario: 所有已选能力组有唯一 owner

- **WHEN** app composition 完成 gateway provider selection
- **THEN** 每个 app-required store MUST 由且仅由一个 selected provider binding 提供
- **AND** StateStore、Long-term Memory、blobStore、taskTrajectory 与 user-interaction-stores binding 任一必需字段缺失 MUST 阻断启动

#### Scenario: 多个 provider 声明同一 store

- **WHEN** 多个 selected provider bindings 声明同一个 store
- **THEN** app composition MUST 在 ready 前以安全的 binding conflict 阻断启动

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

StateStore、Long-term Memory、blobStore、taskTrajectory 和 user-interaction-stores 的 public bindings SHALL 使用完整、非 optional 的 capability-specific contract。领域 package MUST 只消费这些 public gateway ports，MUST NOT 感知 SQLite 文件、数据库连接、schema、远端 client 或 provider-private DTO。`agent-app` MAY 组装内部依赖对象，但 MUST NOT 将该内部聚合重新暴露为通用、全部 optional 的 public store provider contract。

**需求类别**：功能性需求

#### Scenario: 选择 StateStore provider

- **WHEN** selected StateStore provider 创建 binding
- **THEN** binding MUST 一次性提供 StateStore 的全部 stores
- **AND** downstream modules MUST NOT 通过类型断言补齐缺失 store

#### Scenario: 选择 blobStore provider

- **WHEN** selected blobStore provider 创建 binding
- **THEN** binding MUST 完整提供 `BlobStoreGateway`
- **AND** provider-private endpoint、credential、client 和 wire DTO MUST NOT 进入领域 package

#### Scenario: Local audit binding is selected

- **WHEN** LOCAL gateway composition completes
- **THEN** exactly one top-level GatewayBindings.audit MUST be provided by `agent-platform-gateway-local`
- **AND** SqliteGatewayStoreBindings MUST contain no audit member
- **AND** app observability wiring MUST depend only on the provider-neutral AuditEventStoreGateway

#### Scenario: Working Memory provider is selected

- **WHEN** selected Working Memory provider 创建 binding
- **THEN** binding MUST 一次性提供 Working Memory capability 的全部 stores
- **AND** downstream modules MUST NOT 通过类型断言补齐缺失 store

#### Scenario: Long-term Memory provider is remote

- **WHEN** Long-term Memory capability 选择 REMOTE provider
- **THEN** memory consumers MUST 继续通过相同 public store/retriever ports 工作
- **AND** provider-private endpoint、credential、client 和 wire DTO MUST NOT 进入领域 package

### Requirement: StateStore preserves request and session transaction boundaries

StateStore provider SHALL 作为 request/session 工作事实和必要恢复状态的单一事务 owner。terminal commit MUST 在一个 provider-local 原子事务中推进 RequestRun terminal state、写入 terminal message 并追加 terminal timeline event。session create、session fork 和 session cascade delete 等现有复合写 MUST 在 StateStore provider 内保持其规格定义的原子性；conversation annotations 和 shares MUST 与 session cascade delete 位于同一 provider ownership 中。

**需求类别**：功能性需求

#### Scenario: Terminal commit 成功

- **WHEN** runtime 提交一个 terminal result
- **THEN** RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部提交
- **AND** 任一写入失败 MUST 使该次 composite write 不产生部分可见结果

#### Scenario: 会话被删除

- **WHEN** session cascade delete 成功
- **THEN** StateStore provider MUST 在同一事务中删除该 session 归属的 conversation annotations、conversation shares 及其他既有 cascade facts
- **AND** 不得遗留仍可访问的 session share

### Requirement: Local capability providers use isolated SQLite ownership

LOCAL 部署 SHALL 为 StateStore、Long-term Memory 和 user-interaction-stores 使用三个独立 SQLite 文件。三个 provider MUST NOT 共享数据库连接、schema owner 或跨 provider 数据库事务；每个文件 MUST 只包含其 owner 所需的业务表、索引和 provider-private metadata。`blobStore` 大对象 bytes MUST 由 provider-owned 文件系统路径承载，其 SQLite metadata 归属与 `attachmentStore` 及用户问题活动一致；`task_trajectory` 表归属与 Long-term Memory 无关，独立位于 user-interaction-stores 或专属文件。当前版本 MUST 从空 schema 初始化，不得读取旧单库、执行数据迁移、双写或运行时 fallback。

**需求类别**：功能性需求

#### Scenario: 本地 provider 从空 workspace 启动

- **WHEN** LOCAL app 首次在空 workspace 启动
- **THEN** 系统 MUST 创建三个独立 SQLite 文件
- **AND** 每个文件的业务表 MUST 只属于对应 provider ownership

#### Scenario: 单个本地 provider 数据库不可用

- **WHEN** 任一 selected provider 的 SQLite 文件无法初始化或打开
- **THEN** startup MUST fail before ready
- **AND** 系统 MUST NOT fallback 到其他 SQLite 文件或合并 provider ownership

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

## ADDED Requirements

### Requirement: StateStore 支持同节点多进程共享 SQLite 数据文件

当同一节点上多个 NextAgent 进程共享同一 StateStore SQLite 数据文件时，系统 MUST 保证各进程对已提交持久化事实的查询结果一致，MUST NOT 出现部分可见写入、损坏行或丢失已提交事实。StateStore 写入与读取 MUST 在同一文件共享配置下并发安全；任一进程对已提交 session、message、timeline、checkpoint、pending input 或其他 StateStore 事实的读取 MUST 返回与其他进程一致的规范结果。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 两个进程读取同一已提交事实一致

- **GIVEN** 两个 NextAgent 进程使用同一 StateStore SQLite 数据文件启动
- **AND** 进程 A 已提交一条 session、message、timeline 或 checkpoint 事实
- **WHEN** 进程 B 查询同一 Owner + Agent + Session 坐标下的事实
- **THEN** 进程 B MUST 返回与进程 A 提交一致的持久化事实

#### Scenario: 两个进程并发写入各自事实互不丢失

- **WHEN** 进程 A 与进程 B 同时向同一 StateStore 数据文件提交不同 Session 的写入
- **THEN** 两个事实 MUST 均被持久化
- **AND** 两进程后续查询 MUST 同时看到两个已提交事实

#### Scenario: 单个文件无法并发打开时启动失败

- **WHEN** 共享 StateStore 数据文件无法被第二个进程以并发安全方式打开
- **THEN** 第二个进程 MUST 以安全诊断在 ready 前失败
- **AND** MUST NOT 静默降级为进程私有内存状态

### Requirement: Gateway store conformance 契约与实现无关且可复用

系统 MUST 提供实现无关的 StateStore conformance 契约，覆盖 StateStore、Long-term Memory、blobStore、taskTrajectory 与 user-interaction-stores 的持久化行为断言，且 MUST 不依赖具体存储实现（SQLite、远端服务或其他 provider）。LOCAL provider 与外部 REMOTE provider MUST 通过同一组 conformance 断言；外部团队 MUST 能复用该 conformance 契约验证其 REMOTE 实现，无需访问本仓 provider 私有实现。任一 provider 未通过断言时，conformance 结果 MUST 明确标识违反的契约点和可观察结果。

**需求类别**：系统质量属性

**质量属性**：可测试性

**适用范围**：该 Function

#### Scenario: LOCAL provider 通过 conformance 契约

- **WHEN** 使用 LOCAL provider 运行 StateStore conformance 契约
- **THEN** 全部持久化行为断言 MUST 通过
- **AND** 断言 MUST NOT 依赖 SQLite 文件路径、数据库连接或 provider-private DTO

#### Scenario: 外部 REMOTE 实现复用同一 conformance 契约

- **WHEN** 外部团队基于 `agent-contracts` 实现 REMOTE provider 并运行同一 StateStore conformance 契约
- **THEN** 同一组断言 MUST 可执行
- **AND** 断言结果 MUST 与 LOCAL 使用相同判定标准

#### Scenario: provider 违反 conformance 断言

- **WHEN** provider 对某个持久化行为不满足 conformance 断言
- **THEN** conformance 结果 MUST 明确标识违反的契约点和可观察结果
- **AND** 该 provider 不得被视为符合 StateStore 契约

## RENAMED Requirements

### Requirement: StateStore preserves request and session transaction boundaries

**FROM**: Working Memory preserves request and session transaction boundaries

StateStore provider SHALL 作为 request/session 工作事实和必要恢复状态的单一事务 owner。terminal commit MUST 在一个 provider-local 原子事务中推进 RequestRun terminal state、写入 terminal message 并追加 terminal timeline event。session create、session fork 和 session cascade delete 等现有复合写 MUST 在 StateStore provider 内保持其规格定义的原子性；conversation annotations 和 shares MUST 与 session cascade delete 位于同一 provider ownership 中。

#### Scenario: Terminal commit 成功

- **WHEN** runtime 提交一个 terminal result
- **THEN** RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部提交
- **AND** 任一写入失败 MUST 使该次 composite write 不产生部分可见结果

#### Scenario: 会话被删除

- **WHEN** session cascade delete 成功
- **THEN** StateStore provider MUST 在同一事务中删除该 session 归属的 conversation annotations、conversation shares 及其他既有 cascade facts
- **AND** 不得遗留仍可访问的 session share

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统把运行状态持久化从"Working Memory"概念重构为 `stateStore` 能力组聚合，`blobStore`、`taskTrajectory` 与 `user-interaction-stores` 各为独立接口组，并支持同节点多进程共享同一 SQLite 数据文件。TodoWrite 进度状态不再通过 gateway store 持久化，移除 `TodoStateStoreGateway` 及其全部关联类型。
- **依据 Requirements**：`Gateway stores have one capability provider owner`、`StateStore preserves request and session transaction boundaries`、`StateStore 支持同节点多进程共享 SQLite 数据文件`

### 输入

- **变更类型**：修改
- **目标内容**：持久化数据划分为五个能力组——StateStore（运行状态）、Long-term Memory、blobStore、taskTrajectory、user-interaction-stores（附件摄入 + 用户问题活动），`audit` 顶层独立；每个能力组由恰好一个 provider 提供。TodoWrite 进度状态不纳入任何能力组。
- **依据 Requirements**：`Gateway stores have one capability provider owner`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按能力组路由到对应 provider；StateStore 复合写在同一事务内完成；同节点多进程共享 StateStore 数据文件时并发安全。
- **依据 Requirements**：`Gateway stores have one capability provider owner`、`StateStore preserves request and session transaction boundaries`、`StateStore 支持同节点多进程共享 SQLite 数据文件`

### 规格

- **规格项**：运行状态存储聚合
- **变更类型**：修改
- **原规格值**：运行状态由 `workingMemory` 承载，业务语义与实现命名混用
- **目标规格值**：`stateStore` 承载请求、会话、消息、会话 fork、附件 metadata、active context、时间线、检查点、待输入、会话标注、会话分享与问题推荐
- **依据 Requirements**：`Gateway stores have one capability provider owner`

- **规格项**：对象存储接口组
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`blobStore` 为独立顶层接口组，完整提供 `BlobStoreGateway`
- **依据 Requirements**：`Gateway stores have one capability provider owner`

- **规格项**：任务轨迹接口组
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`taskTrajectory` 为独立顶层接口组，含 `taskTrajectoryStore` 与 `taskTrajectoryQuery`
- **依据 Requirements**：`Gateway stores have one capability provider owner`

- **规格项**：用户交互存储接口组
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`user-interaction-stores` 能力组含 attachmentStore 与 userQuestionActivityStore
- **依据 Requirements**：`Gateway stores have one capability provider owner`

- **规格项**：LOCAL 三库物理隔离
- **变更类型**：修改
- **原规格值**：Working Memory / Long-term Memory / 保留 SQLite 三个独立 SQLite 文件
- **目标规格值**：StateStore / Long-term Memory / user-interaction-stores 三个独立 SQLite 文件，blob 大对象走 provider 文件系统路径，schema owner 与事务隔离保持
- **依据 Requirements**：`Local capability providers use isolated SQLite ownership`

- **规格项**：LOCAL 多进程共享
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：同一节点多个进程可共享同一 StateStore SQLite 数据文件，已提交事实查询一致
- **依据 Requirements**：`StateStore 支持同节点多进程共享 SQLite 数据文件`

- **规格项**：StateStore conformance
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：提供实现无关的 StateStore conformance 契约，LOCAL 与外部 REMOTE provider 复用同一组断言
- **依据 Requirements**：`Gateway store conformance 契约与实现无关且可复用`

### 接口

- **变更类型**：修改
- **目标内容**：`GatewayBindings` 顶层以 `stateStore`、`longTermMemory`、`blobStore`、`taskTrajectory`、`userInteractionStores` 和 `audit` 暴露持久化 binding，不再暴露 `workingMemory` 与 `sqliteStores`。
- **依据 Requirements**：`Gateway stores have one capability provider owner`、`Provider bindings are capability-complete and implementation-neutral`
