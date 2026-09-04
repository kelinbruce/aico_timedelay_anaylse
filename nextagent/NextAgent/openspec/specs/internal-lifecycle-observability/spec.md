# internal-lifecycle-observability Specification

## Purpose
TBD - created by archiving change add-ts-internal-lifecycle-observability. Update Purpose after archive.

## Requirements
### Requirement: Scheduler State Transition Observation

`RequestLifecycleCoordinator` 在 run 从 QUEUED 状态过渡到 EXECUTING 状态时 SHALL 发射一条 `ObservabilityObservationEvent`，边界为 `system`，operation 为 `RUN_DISPATCHED`。

Observation SHALL 携带当前执行上下文的 `sessionId`、`requestRunId`、`requestContextId` 和 `agentId`。

Observation outcome SHALL 为 `success`。

#### Scenario: Run dispatched to executing state
- **WHEN** `drainLane` 成功调用 `startAcceptedRun` 将 run 状态从 QUEUED 转为 EXECUTING
- **THEN** 系统发射 `boundary: "system"`, `operation: "RUN_DISPATCHED"`, `outcome: "success"` 的 observation

### Requirement: Lane Drain Observation

`RequestLifecycleCoordinator` 的 `drainLane` 方法在以下时刻 SHALL 发射 observation：
- 进入 drain 循环时：`operation: "LANE_DRAIN_STARTED"`，携带当前 lane 排队深度
- 正常完成 drain 循环时：`operation: "LANE_DRAIN_COMPLETED"`
- 因取消或 lane 替换而提前结束 drain 时：`operation: "LANE_DRAIN_SUPERSEDED"`，`outcome: "canceled"`

所有 lane drain observation 的边界 SHALL 为 `system`。

#### Scenario: Lane drain starts with pending work
- **WHEN** `drainLane` 开始处理一个 lane 且发现有排队的工作
- **THEN** 系统发射 `operation: "LANE_DRAIN_STARTED"` 的 observation，diagnostic candidate 中包含 `pendingDepth`

#### Scenario: Lane drain completes normally
- **WHEN** `drainLane` 正常完成所有排队工作后退出
- **THEN** 系统发射 `operation: "LANE_DRAIN_COMPLETED"`, `outcome: "success"` 的 observation

#### Scenario: Lane drain superseded by newer request
- **WHEN** `drainLane` 因检测到 lane 中存在更新的 pending work 而提前退出（current work 不是队列头）
- **THEN** 系统发射 `operation: "LANE_DRAIN_SUPERSEDED"`, `outcome: "canceled"` 的 observation

### Requirement: Local Recovery Observation

`RequestLifecycleCoordinator.recoverLocalRuntime` SHALL 在恢复过程的关键阶段发射 observation：
- 恢复扫描开始时：`operation: "RECOVERY_SCAN_STARTED"`
- 恢复扫描完成时：`operation: "RECOVERY_SCAN_COMPLETED"`，携带 `scanned`、`rebuiltQueued`、`claimedExecuting`、`failed`、`skipped` 计数

所有恢复 observation 的边界 SHALL 为 `system`。

#### Scenario: Recovery scan starts
- **WHEN** `recoverLocalRuntime` 开始扫描 pending/executing run
- **THEN** 系统发射 `operation: "RECOVERY_SCAN_STARTED"`, `outcome: "success"` 的 observation

#### Scenario: Recovery scan completes with results
- **WHEN** 扫描完成且获得了恢复报告计数
- **THEN** 系统发射 `operation: "RECOVERY_SCAN_COMPLETED"` 的 observation，diagnostic candidates 包含 `scanned`、`rebuiltQueued`、`claimedExecuting`、`failed`、`skipped`

### Requirement: Terminal Commit Degradation Observation

`commitTerminalOutcome` 在 terminal commit 持久化返回非 COMMITTED 状态（非 ALREADY_COMMITTED 幂等路径）时 SHALL 发射一条 degradation observation，边界为 `request_lifecycle`，operation 为 `TERMINAL_COMMIT_DEGRADED`，outcome 为 `degraded`。

该 observation SHALL 携带当前 run 的 `sessionId`、`requestRunId`、`agentId` 和 `terminalStatus`。

Observation 发射失败 SHALL NOT 影响 terminal commit 的持久化降级逻辑。

#### Scenario: Terminal commit persistence fails
- **WHEN** `commitTerminalOutcome` 调用 `requestRunStore.commitTerminal` 返回的状态不是 `COMMITTED` 也不是 `ALREADY_COMMITTED`
- **THEN** 系统在进入降级 `saveRun` 之前发射 `operation: "TERMINAL_COMMIT_DEGRADED"`, `outcome: "degraded"` 的 observation

### Requirement: Health Probe Result Observation

`agent-app` 在每次完整健康探测完成后 SHALL 将汇总结果作为 observation 发射，边界为 `health_probe`，operation 为 `HEALTH_EVALUATED`。

Observation SHALL 携带每个探针的 `name`、`status` 和 `reasonCode` 作为 diagnostic candidates。

#### Scenario: Health evaluation completes
- **WHEN** `/health` 端点的健康探测完成
- **THEN** 系统发射 `boundary: "health_probe"`, `operation: "HEALTH_EVALUATED"` 的 observation，outcome 基于整体 health status（UP→success, DEGRADED→degraded, DOWN→failure）

### Requirement: Application Shutdown Observation

`agent-app` 的 `close()` 方法在开始关闭流程时 SHALL 发射一条 observation，边界为 `system`，operation 为 `APP_SHUTDOWN`，outcome 为 `success`。

#### Scenario: Application shuts down
- **WHEN** `NextAgentApp.close()` 被调用
- **THEN** 系统发射 `boundary: "system"`, `operation: "APP_SHUTDOWN"`, `outcome: "success"` 的 observation

### Requirement: Observation Non-blocking Contract

所有上述内部 lifecycle observation 的发射失败 SHALL NOT 阻断或改变主业务路径的执行结果。observation 发射 SHALL 使用 try/catch 包裹并静默处理任何错误。

#### Scenario: Observation emission fails during lane drain
- **WHEN** `drainLane` 中的 observation 发射抛出异常
- **THEN** lane drain 继续正常执行，该异常被静默忽略
