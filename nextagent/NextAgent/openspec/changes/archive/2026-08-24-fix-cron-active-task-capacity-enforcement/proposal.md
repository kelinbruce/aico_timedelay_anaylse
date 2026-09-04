## 背景与问题（Why）

Cron task 当前在 durable 产品路径上没有容量上限。虽然内存测试实现已经执行每 scope 50 条限制，但以下产品路径可以直接无限创建任务：

- `createGatewayCronTaskPort.addTask` 在调用 gateway 前不检查容量。
- `cronTaskManagement.createCronTask` 在调用 gateway 前不检查容量。
- `SqliteCronTaskGateway.createTask` 直接执行 `INSERT OR IGNORE`，没有任何事务内计数约束。

这会造成同一 trusted scope 下 `ACTIVE` Cron task 无界增长，进而影响调度扫描、trigger 表、管理查询和恢复时间。现有 `cron-tools` 规格只要求 Tool 描述说明容量，尚未把 50 条容量定义为持久化不变量。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 每个 trusted Cron task scope（`tenantId + subjectId + agentId`）最多保存 50 个 `ACTIVE` task。
- `COMPLETED` 和 `DELETED` task 不占用额度。
- Cron Tool 创建路径和 Web management 创建路径在 durable write 前执行同语义 active-count 预检。
- LOCAL 与 REMOTE deployment 都必须在 durable create 边界权威拒绝第 51 个 ACTIVE task，并发创建不得突破 50。
- 超限统一返回 `CRON_TASK_LIMIT_REACHED`，category 为 `CONFLICT`，Web API 投影为 HTTP `409`。
- 已持久化的幂等重放仍然优先于容量检查，返回首次结果。

**非目标：**

- 不新增配置项或动态调整上限。
- 不改变管理列表 `total` 的语义，`countTasksForAgent` 仍用于非删除 task 分页总数。
- 不自动删除、完成或淘汰已存在 task。
- 不修改 frontend/agent-web 业务代码；本次错误通过既有 API 安全错误投影返回。
- 不为存量数据增加配额修复或迁移。

## 变更范围（What Changes）

- 两个主路径 create 都使用同一 ACTIVE 容量不变量，并提供 early capacity feedback。
- `CronTaskGatewayPort` 新增 optional active-count query；既有 remote client 不新增 required method。
- remote backend `createTask` 的容量拒绝使用稳定 `CRON_TASK_LIMIT_REACHED` 信号，并由 reference adapter 归一化为固定 safe error。
- `POST /api/v1/cron-tasks` 在满额时返回 409 并保持既有 public safe error envelope。
- Cron Tool 描述更新为 50 个 ACTIVE task。
- 测试：SQLite 边界/隔离/幂等测试，capability adapter 预检测试，management service 预检测试，remote adapter 转发测试，Web route 409 测试。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-10.9 Cron 工具`
  - canonical spec：`cron-tools`
  - 新增 durable create active-task capacity requirement，并修正模型可见容量描述为 ACTIVE task。
  - 关联 Web API spec：`cron-task-management-api`，新增创建容量拒绝和 409 安全错误投影。

## 影响范围（Impact）

- **行为：** 同一 owner + Agent scope 下第 51 个 ACTIVE task 创建失败；一次性任务完成后释放额度。
- **Gateway contract：** `CronTaskGatewayPort` 新增 optional `countActiveTasksForAgent`，LOCAL 实现并提供，REMOTE 按 vendor 能力可选实现；既有 remote client 无需新增 method 才能编译。
- **公共 API：** `POST /api/v1/cron-tasks` 新增 `409 CRON_TASK_LIMIT_REACHED` 错误响应。
- **持久化：** `createTask` 的容量检查和 INSERT 合并到同一 SQLite transaction。
- **测试：** 现有 52-task 分页测试需要调整为不超过容量上限，并新增容量边界测试。
