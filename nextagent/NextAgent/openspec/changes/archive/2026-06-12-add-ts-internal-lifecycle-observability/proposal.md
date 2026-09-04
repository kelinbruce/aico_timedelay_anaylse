## 背景与问题（Why）

当前 `add-ts-trace-log-linking` 和 `add-ts-structured-logging` 已建立观察机制，覆盖了模型调用、runtime 命令拒绝、HTTP 网关调用和请求生命周期端点（REQUEST_ACCEPTED > terminal）。但内部调度状态机转换、lane 行为、持久化层降级、恢复操作和健康探测的执行事实未被纳入观察面，导致以下问题：

1. **排队长不可见**：run 从 QUEUED 到 EXECUTING 的过渡全程无声，scheduler 延迟、lane 堆积无法通过结构化日志追踪。
2. **lane 调度行为不可审计**：同一 session 的 lane drain 开始/结束、排队深度、取消触发 lane 清理等关键调度事件缺失。
3. **本地恢复操作无观察**：`recoverLocalRuntime` 扫描、重建队列、claim 执行中 run 等操作只有计数返回值，无结构化事件。
4. **terminal commit 持久化降级无声**：`commitTerminalOutcome` 在持久化事务失败（非幂等路径）时静默回退，不产生 observation。
5. **健康探测结果仅 HTTP 响应**：gateway、model_provider、capability 三个探针结果未作为 observation 发射，无法进入审计和日志聚合。
6. **应用关闭无信号**：`close()` 不被观察，优雅退出无法追踪。

## 变更范围（What Changes）

- `agent-runtime` 的 `RequestLifecycleCoordinator` 在关键调度和恢复点发射 `ObservabilityObservationEvent`：
  - `BOUNDARY.SCHEDULER`：QUEUED→EXECUTING 过渡、lane drain 开始/结束/取消、lane 排队深度饱和
  - `BOUNDARY.RECOVERY`：恢复扫描开始/结束、单个 run 重建、claim、跳过、失败
- `agent-runtime` 的 `commitTerminalOutcome` 在持久化降级时发射 degradation observation。
- `agent-app` 的 `createComposedApp` 在健康探测完成后和 `close()` 时发射 observation。
- `StructuredLogProjector` 新增 event 映射：`SCHEDULER_DIAGNOSTIC`、`RECOVERY_DIAGNOSTIC`、`HEALTH_PROBE_RESULT`、`APP_SHUTDOWN`。
- 不改变任何对外 API、gateway contract、persistence owner 或安全边界。

## Capability 影响（Capabilities）

### 新增 Capability
- `internal-lifecycle-observability`：定义 runtime 内部调度、恢复、持久化降级、健康探测和关闭的观察信号边界和结构化日志投影规则。

### 修改的 Capability
- `structured-logging`：`StructuredLogProjector` 的 event 映射表和 `StructuredLogEvent` 联合类型新增 `SCHEDULER_DIAGNOSTIC`、`RECOVERY_DIAGNOSTIC`、`HEALTH_PROBE_RESULT`、`APP_SHUTDOWN`。

## 影响范围（Impact）

- `agent-runtime/src/lifecycle/submit.ts`：`drainLane`、`submit`、`cancel`、`recoverLocalRuntime` 方法增加 observation 发射
- `agent-runtime/src/terminal/terminal-commit.ts`：`commitTerminalOutcome` 持久化降级路径增加 observation 发射
- `agent-observability/src/logging/structured-log-projector.ts`：`StructuredLogEvent` 联合类型和 `mapEvent` 函数扩展
- `agent-app/src/composition/create-app.ts`：健康探测回调、`start`、`close` 增加 observation 发射
- 测试：调度 observation 的 contract 测试、terminal commit 降级测试、恢复测试

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/internal-lifecycle-observability/spec.md`：新增
- `openspec/specs/structured-logging/spec.md`：修改 event 枚举

设计视图：
- `openspec/designs/architecture/observability.md`：新增跨模块观察信号汇总

验证入口：
- `npm run build`、`npm test`、`npm run test:contract` 通过
