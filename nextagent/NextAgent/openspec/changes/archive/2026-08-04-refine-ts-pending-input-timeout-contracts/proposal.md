## 背景与问题（Why）

`PendingInputStoreGateway.listDuePendingInputs` 当前按全库 `PENDING + timeoutAt` 条件返回到期事实，请求不携带可信 `agentId`。该契约只适合提交请求或进程恢复时的偶发扫描；若 runtime 增加持续超时处理，它会让一个 Agent app instance 扫描并尝试处理其他 Agent Scope 的 pending input，违反主路径 Agent Scope 隔离。

当前查询还只返回 `PENDING` 事实。若 runtime 已将 pending input CAS 为 `TIMED_OUT`，但在发布 `USER_INPUT_TIMEOUT` 或 terminal commit 前失败，该事实不会再次进入查询，导致持久化状态、canonical event、RequestRun 终态和前端投影永久分裂。由于问题位于冻结的 `agent-contracts/gateway` 公共契约，必须先独立收敛 owner 与查询语义，再由后续生命周期 change 消费。

本 change 将“未完成 pending input timeout fact”定义为：属于一个可信 Agent Scope，且满足以下任一条件的 durable `PendingInputRecord`：

- 状态为 `PENDING`，并且已经接受并持久化 `timeoutAt`，无论当前是否到期；
- 状态为 `TIMED_OUT`，并且所属 RequestRun 尚未完成 terminal commit。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 为 runtime 提供 Agent-scoped、bounded、deterministic 的 unresolved timeout fact 查询契约。
- 让 runtime 同时发现未来 `PENDING` deadline、已经到期的 `PENDING` 事实和超时处理中遗留的 `TIMED_OUT` 事实，使 deadline 唤醒与后续生命周期处理能够从同一 durable truth 收敛。
- 保持 gateway 只拥有 durable fact 查询，不让 gateway 决定 timeout policy、状态转换、event 发布或 terminal commit。
- 迁移全部实现、测试替身与调用方，不保留语义重叠的旧查询。

**非目标：**

- 不启动定时 worker，不规定扫描周期、启动顺序、关闭顺序或重试调度。
- 不修改 pending input 状态 vocabulary、客户端 DTO、Web API、stream event 或 timeout policy。
- 不新增 pending input、observation、activity 或 recovery 数据表。
- 不把 Owner Scope 收窄为查询输入；一次 Agent-scoped 内部维护扫描允许返回该 Agent 下不同 Owner Scope 的事实，但每条返回记录仍必须保留完整可信 owner coordinates。

## 变更范围（What Changes）

- **BREAKING**：以 `AgentListUnresolvedPendingInputTimeoutFactsRequest` 替换 `ListDuePendingInputsRecordRequest`。新请求携带可信 `agentId`、`1..1000` 的 `limit`，以及可选的 `after: PendingInputTimeoutFactCursor` invocation-local keyset coordinate，不携带 `now`。
- **BREAKING**：以 `PendingInputStoreGateway.listUnresolvedPendingInputTimeoutFacts(...)` 替换 `listDuePendingInputs(...)`，不保留 alias 或双读兼容期。
- 查询返回该 Agent Scope 下所有带 accepted `timeoutAt` 的 `PENDING` 事实，以及已为 `TIMED_OUT` 但所属 RequestRun 尚未 terminal committed 的不完整事实。gateway 不按当前时钟判断到期，runtime 使用自身 lifecycle clock 区分 due 与 future。
- 保持返回 `PendingInputRecord` 的完整 tenant、subject、agent、session、run、checkpoint coordinates，并以 `timeoutAt`、`pendingInputId` 的稳定升序返回 bounded 结果。调用方仅从当前页最后一条 Record 派生下一页坐标；该坐标不持久化、不进入 Record，也不是 feed revision。
- 要求 local gateway 使用以 `agentId` 为前导条件的 adapter-private indexed query；索引字段不进入公共 Record。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.5 请求用户确认或授权` → canonical spec `human-pending-input-core`
  - 功能边界：系统只在可信 Agent Scope 内发现已接受 deadline 的未完成 timeout facts，既包含未来或已到期的 `PENDING`，也包含 terminal 尚未提交的 `TIMED_OUT`；事实发现不决定是否到期，不向浏览器或业务调用方暴露内部扫描能力。
  - 系统质量属性：安全（Agent Scope 隔离、Owner coordinates 保留、非法输入 fail closed）、性能/容量（`1..1000` 有界 keyset page 和稳定顺序）、可靠性/恢复（可重新发现半完成 `TIMED_OUT`）。
  - 映射说明：`ts-core-contracts` 的 legacy `Pending input gateway fact queries` Requirement 作为来源整体 REMOVED；timeout discovery 黑盒行为迁入 `human-pending-input-core`，active-pending 黑盒约束已由该主规格的既有 Requirement 承载，gateway request、port 与 SQLite 细节迁入 design，不建立新的 Function/spec 多对多关系。

## 影响范围（Impact）

- `packages/agent-contracts` 的 gateway public exports 和 contract tests。
- `packages/agent-platform-gateway-local` 的 SQLite 查询、索引、测试及 schema snapshot。
- `packages/agent-runtime` 中现有 timeout/recovery 调用点，以及 repository 内所有 `PendingInputStoreGateway` 测试替身。
- core-contract 与 architecture dependency gates。
