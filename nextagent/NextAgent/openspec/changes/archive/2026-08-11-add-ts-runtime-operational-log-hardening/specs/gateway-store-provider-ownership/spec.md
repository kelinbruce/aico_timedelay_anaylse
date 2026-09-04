## MODIFIED Requirements

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

#### Scenario: Local audit file is unavailable

- **WHEN** the selected LOCAL audit file gateway cannot initialize
- **THEN** audit projection/output state MUST expose bounded degraded evidence without creating an audit SQLite table
- **AND** business readiness and existing SQLite provider ownership MUST remain unchanged
