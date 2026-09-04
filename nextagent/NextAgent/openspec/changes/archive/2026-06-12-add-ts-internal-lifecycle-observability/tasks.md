## 1. StructuredLogProjector 扩展

- [x] 1.1 `StructuredLogEvent` 联合类型新增 `SCHEDULER_DIAGNOSTIC`、`RECOVERY_DIAGNOSTIC`、`HEALTH_PROBE_RESULT`、`APP_SHUTDOWN`
  验证：`npm run build` 通过，`npm test` 在 `agent-observability` 包通过
  来源：spec `internal-lifecycle-observability` requirements（所有）；design D3

- [x] 1.2 `mapEvent` 函数扩展映射规则：`boundary: "system"` + `operation: "RUN_DISPATCHED"` / `"LANE_DRAIN_*"` → `SCHEDULER_DIAGNOSTIC`；`operation: "RECOVERY_SCAN_*"` → `RECOVERY_DIAGNOSTIC`；`boundary: "health_probe"` + `operation: "HEALTH_EVALUATED"` → `HEALTH_PROBE_RESULT`；`operation: "APP_SHUTDOWN"` → `APP_SHUTDOWN`
  验证：`packages/agent-observability/tests/` 中 structured-log-projector 测试覆盖新 event type
  来源：design D3

## 2. Submit.ts 调度和恢复 observation

- [x] 2.1 `RequestLifecycleCoordinator` 新增可选依赖 `deps.projectorHost`，在 `drainLane` 中发射 RUN_DISPATCHED（QUEUED→EXECUTING 成功后）和 LANE_DRAIN_STARTED/COMPLETED/SUPERSEDED
  验证：`packages/agent-runtime/tests/` 中 submit test 用 mock projector host 断言 observation shape 和次数
  来源：spec `Scheduler State Transition Observation`、`Lane Drain Observation`；design D1、D4

- [x] 2.2 `recoverLocalRuntime` 在扫描开始和完成时发射 RECOVERY_SCAN_STARTED/COMPLETED observation
  验证：recovery unit test 验证 observation 携带 scanned/rebuiltQueued/claimedExecuting/failed/skipped 计数
  来源：spec `Local Recovery Observation`；design D1

- [x] 2.3 observation 发射失败不阻断调度或恢复路径（non-blocking contract）
  验证：contract test 使用 throwing projector host，断言 submit/recovery 正常完成
  来源：spec `Observation Non-blocking Contract`

## 3. Terminal commit degradation observation

- [x] 3.1 `commitTerminalOutcome` 的 `TerminalCommitHooks` 新增可选 `acceptObservation`，在持久化 commit 返回非 COMMITTED 且非 ALREADY_COMMITTED 时发射 TERMINAL_COMMIT_DEGRADED
  验证：`packages/agent-runtime/tests/` terminal-commit test 覆盖 commit 失败降级路径
  来源：spec `Terminal Commit Degradation Observation`；design D1、D2

## 4. App layer health and shutdown observation

- [x] 4.1 `createComposedApp` 在 health 探测回调中发射 HEALTH_EVALUATED observation（整体 health status 映射到 outcome）
  验证：integration test 通过 health endpoint 触发，验证 observation 写入 audit store 或 mock projector
  来源：spec `Health Probe Result Observation`；design D1

- [x] 4.2 `createComposedApp` 的 `close()` 方法在关闭流程开始前发射 APP_SHUTDOWN observation
  验证：unit test mock projector host 验证 close() 产生 observation
  来源：spec `Application Shutdown Observation`；design D1

## 5. 集成验证

- [x] 5.1 运行全量构建和测试：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：全部通过
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

归档前根据 proposal/design 的归档前更新基线：
- 同步 `openspec/specs/internal-lifecycle-observability/spec.md`（新增）。
- 新增 `openspec/designs/architecture/observability.md`，汇总所有 observation boundary 和 signal inventory。
