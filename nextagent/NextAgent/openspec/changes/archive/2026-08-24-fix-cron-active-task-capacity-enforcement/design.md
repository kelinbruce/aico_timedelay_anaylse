## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
| --- | --- | --- | --- |
| `FN-10.9 Cron 工具` | 为 Cron Tool 与 Web management 的 durable create 增加每个 trusted scope 最多 50 个 ACTIVE task 的容量治理，并补充 Tool 指导与 409 API 错误 | `cron-tools`、`cron-task-management-api` | `FN-10.9 Cron 工具` |

## `FN-10.9 Cron 工具`

### 目标与规范依据

当前规格只要求模型描述说明 scope 容量，没有把容量定义为 durable create 的系统不变量。本 change 将模型描述的“50 个任务”收敛为“50 个 ACTIVE task”，并让所有主路径 create 共享同一可观察拒绝语义。

本 Function 的目标 Requirements：

- canonical spec：`cron-tools`
  - `ADDED`：`Cron 创建执行 ACTIVE 任务容量限制`
  - `MODIFIED`：`Cron Tool 调用指导`
- 关联 Web API spec：`cron-task-management-api`
  - `ADDED`：`Cron task 管理 API 执行 ACTIVE 任务容量限制`

### 当前实现

| 层 | 当前事实 |
| --- | --- |
| 内存 Tool store | 已按 `tenantId + subjectId + agentId` 限制 50 条，但 product composition 不使用该实现 |
| `createGatewayCronTaskPort.addTask` | 完成 schedule validation 后直接调用 `CronTaskGatewayPort.createTask`，无容量预检 |
| `cronTaskManagement.createCronTask` | 完成输入验证后直接构造 Record 并调用 `createTask`，无容量预检 |
| `SqliteCronTaskGateway.createTask` | 直接 `INSERT OR IGNORE`，无事务内容量判定 |
| `countTasksForAgent` | 默认排除 `DELETED`，但包含 `COMPLETED`，不能直接表达 active capacity |
| remote reference adapter | 原样转发 vendor `createTask`；vendor 抛出的业务 AgentError 会被归一化为 remote unavailable |

### GAP 分析

| 规范目标 | 当前事实 | GAP |
| --- | --- | --- |
| ACTIVE task 容量必须由 durable create 权威保证 | `createTask` 不计数，service/Tool 也不预检 | 本地需要事务内计数 + INSERT；remote 需要 backend `createTask` 权威拒绝 |
| COMPLETED/DELETED 不占额度 | `countTasksForAgent` 把 COMPLETED 计入 | 需要精确的 ACTIVE count 查询 |
| 幂等重放优先于容量 | 当前幂等查询发生在 INSERT 后 | 容量检查必须先解析 replay |
| 409 公共错误投影 | channel 没有 capacity error 测试或 API 文档 | 复用现有 `CONFLICT -> 409` 映射并补文档 |
| Tool 描述与实际语义一致 | 描述仍说“50 个任务” | 更新为 ACTIVE task 并说明非 ACTIVE 不占用 |

### 修改方案

**容量不变量**

容量 scope 为 `tenantId + subjectId + agentId`，计数条件为 `status='ACTIVE'`，上限为 50。`COMPLETED` 和 `DELETED` 不占用额度。one-shot task claim 后变为 `COMPLETED`，容量自然释放。

**共享常量**

`CRON_MAX_TASKS_PER_SCOPE = 50` 移入 `agent-common`，由 capability、app 和 gateway-local 共用。`agent-capability` 继续从 public index 导出原名称，保持调用方兼容。

容量冲突也由 `agent-common` 提供唯一 `cronTaskLimitReachedError(cause?)` 工厂，固定 code、category、retryable 和 safe message，避免 capability、app、local gateway 与 remote adapter 各自维护同形错误。

**LOCAL 权威 enforcement**

`SqliteCronTaskGateway.createTask` 改为单个 SQLite transaction：

1. 校验 target 字段。
2. 如果存在 `idempotencyKey`，先按 scoped idempotency key 查询 replay；命中则直接返回首次结果。
3. 如果没有 idempotency key，按 `taskId` 查询已有 fact；命中则保持当前返回已有事实语义。
4. 如果新 Record 是 `ACTIVE`，统计 scope 内 `status='ACTIVE'` 数量；达到 50 时抛 `CRON_TASK_LIMIT_REACHED`。
5. 执行 INSERT。
6. 返回已持久化 Record。

`BEGIN IMMEDIATE` 保证 count 与 INSERT 之间没有同进程写入，形成本地权威边界。

**可选 active-count 预检**

`CronTaskGatewayPort` 增加可选方法：

```ts
countActiveTasksForAgent?(
  request: CronTaskAgentScopeQuery,
  signal?: AbortSignal,
): Promise<number>;
```

Tool adapter 和 management service 在 schedule/input validation 后调用该方法。方法存在且计数达到 50 时提前返回稳定容量错误。该方法不是并发安全边界；旧 remote client 可以不实现，`createTask` 仍必须提供权威拒绝。

**REMOTE 权威边界与兼容**

`ReferenceRemoteCronTaskClient.countActiveTasksForAgent` 同样为 optional，避免破坏既有外部实现。remote reference adapter：

- 只有 client 实现该 optional method 时才暴露 count 预检。
- 将 vendor `createTask` 的 `CRON_TASK_LIMIT_REACHED` `AgentError` 或稳定 code 统一重建为固定 safe `AgentError`，不直接透传 vendor message，也不归一化为 `CRON_REMOTE_UNAVAILABLE`。
- remote backend 必须在自身 durable create 边界原子拒绝第 51 个 ACTIVE task；reference adapter 的预检只提供早期失败反馈。

**错误与 Web 投影**

稳定错误 shape：

```ts
AgentError {
  code: 'CRON_TASK_LIMIT_REACHED',
  message: 'Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.',
  category: 'CONFLICT',
  retryable: false,
}
```

`agent-channel-web` 既有 `statusFor` 把 `CONFLICT` 映射为 HTTP 409。公共响应 envelope 仍只包含 `error.code` 与 `error.message`。

**Tool 指导**

Cron Tool description 更新为最多 50 个 ACTIVE task，并明确 COMPLETED/DELETED 不占用容量。

### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 局部机制 | 验证关注点 |
| --- | --- | --- | --- |
| 容量 | `Cron 创建执行 ACTIVE 任务容量限制` | 每个 trusted scope 最多 50 个 ACTIVE task；COMPLETED/DELETED 不占额度 | 边界、scope 隔离、状态释放测试 |
| 可靠性/恢复 | `Cron 创建执行 ACTIVE 任务容量限制` | LOCAL count + INSERT 在同一事务；幂等重放优先于容量 | replay/overflow 组合测试 |
| 安全 | `Cron 创建执行 ACTIVE 任务容量限制` | scope 只来自 trusted owner/agent；错误不泄漏内部实现 | channel negative test |

## 需群内确认

- `CronTaskGatewayPort.countActiveTasksForAgent?` 为 optional extension：既有实现无需新增 required method，不构成编译期破坏。
- `ReferenceRemoteCronTaskClient.countActiveTasksForAgent?` 同为 optional，旧 remote client 保持兼容。
- remote backend `createTask` 必须作为容量权威边界返回或抛出稳定 `CRON_TASK_LIMIT_REACHED`；reference adapter 透传该结果。该外部集成约束已收敛为本 change 的契约要求，不保留待确认实现方案。

## 长期基线刷新计划

- `openspec/specs/cron-tools/spec.md`：合并 ACTIVE 容量 Requirement 和更新后的 Tool 指导。
- `openspec/specs/cron-task-management-api/spec.md`：合并 Web create 409 容量契约。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.9-Cron工具.md`：更新描述、处理过程、结果和规格表。
- `openspec/designs/modules/agent-platform-gateway-local.md`：记录 active capacity 事务不变量。
- `openspec/designs/spec-to-design-map.md`：补充容量测试入口。
